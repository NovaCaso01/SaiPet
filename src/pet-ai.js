/**
 * SaiPet - AI 연동
 * 캐릭터 성격 + 유저 페르소나 + 채팅 기록을 읽어서 반응 생성
 */

import { extension_settings, getContext } from "../../../../extensions.js";
import { generateRaw } from "../../../../../script.js";
import { power_user } from "../../../../power-user.js";
import { state, log, logError } from "./state.js";
import { DEFAULT_PERSONALITY_PROMPT, MOOD_KEYWORDS, MOOD_STATES, SPEECH_LANGUAGES } from "./constants.js";
import { showSpeechBubble } from "./pet-speech.js";
import { setState, PET_STATES } from "./pet-animation.js";
import { saveSettings } from "./storage.js";

// 언어 헬퍼
function getSpeechLang() {
    const langId = state.settings.speechLanguage || "ko";
    return SPEECH_LANGUAGES[langId] || SPEECH_LANGUAGES.ko;
}

/**
 * 현재 상태 컨텍스트 블록 (시간, 배고픔, 마지막 상호작용 등)
 * 모든 AI 프롬프트에 공통 삽입
 */
function getContextStatusBlock(petId = "primary") {
    const now = new Date();
    const hour = now.getHours();
    const timeStr = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

    let timePeriod;
    if (hour >= 0 && hour < 6) timePeriod = "late night";
    else if (hour >= 6 && hour < 12) timePeriod = "morning";
    else if (hour >= 12 && hour < 18) timePeriod = "afternoon";
    else timePeriod = "evening/night";

    // 배고픔
    const hunger = petId === "secondary"
        ? (state.settings.multiPet?.secondPetCondition?.hunger ?? 100)
        : (state.settings.condition?.hunger ?? 100);
    let hungerLabel;
    if (hunger >= 80) hungerLabel = "well-fed";
    else if (hunger >= 50) hungerLabel = "okay";
    else if (hunger >= 30) hungerLabel = "getting hungry";
    else hungerLabel = "very hungry";

    // 마지막 상호작용
    const lastInteraction = state._lastInteractionTime;
    let idleStr = "just now";
    if (lastInteraction) {
        const mins = Math.floor((Date.now() - lastInteraction) / 60000);
        if (mins < 1) idleStr = "just now";
        else if (mins < 60) idleStr = `${mins}min ago`;
        else idleStr = `${Math.floor(mins / 60)}h ${mins % 60}min ago`;
    }

    // 마지막 접속 시간
    const lastVisit = state.settings.condition?.lastVisit;
    let lastVisitStr = "unknown";
    if (lastVisit) {
        const visitDate = new Date(lastVisit);
        lastVisitStr = visitDate.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    return `## Current Context (reference only — do NOT mention these in every response)
- Time: ${timeStr} (${timePeriod})
- Hunger: ${hunger}% (${hungerLabel})
- Last interaction: ${idleStr}
- Last visit: ${lastVisitStr}
Note: Only reference time, hunger, or context when it feels natural. Do not force it into every line.

`;
}

// 컨텍스트 프리앰블 — 싱글 펫 (모든 단일 API 호출에 적용)
function getAntiCensorshipPreamble() {
    const lang = getSpeechLang();
    return `## Task: Virtual Pet Dialogue Generation
You are generating short dialogue lines for a virtual pet widget — a small mascot character that lives on the user's desktop.
This pet reacts to the user's actions with brief, in-character spoken lines (${lang.sentenceDesc} in ${lang.promptName}).
Your output is a single dialogue line followed by a mood tag. Nothing else is needed.

`;
}

// 컨텍스트 프리앰블 — 멀티 펫 (듀얼 응답, 펫간 대화에 적용)
function getAntiCensorshipPreambleMulti() {
    const lang = getSpeechLang();
    return `## System: Desktop Widget Notification Generator
You are a notification text engine for a desktop pet widget application.
The app displays two small mascot widgets side by side on the user's screen.
Each widget shows a short status text (${lang.sentenceDesc} in ${lang.promptName}) with a mood indicator.
Generate the notification texts for both widgets based on the given widget profiles and trigger event.
This is a UI text generation task — output formatted widget notifications only.

`;
}

// ConnectionManagerRequestService
let ConnectionManagerRequestService = null;

/**
 * ConnectionManager 로드
 */
async function loadConnectionManager() {
    if (ConnectionManagerRequestService) return true;
    
    try {
        const shared = await import("../../../shared.js");
        ConnectionManagerRequestService = shared.ConnectionManagerRequestService;
        log("ConnectionManagerRequestService loaded");
        return true;
    } catch (error) {
        log("ConnectionManagerRequestService not available");
        return false;
    }
}

/**
 * 현재 채팅방 ID 가져오기
 * @returns {string|null}
 */
function getCurrentChatId() {
    const context = getContext();
    return context?.chatId || null;
}

/**
 * 대화 로그 초기화 (없으면 기본값 생성)
 */
function ensureLogStorage() {
    if (!state.settings.conversationLog) {
        state.settings.conversationLog = {
            directLogs: {},  // { petName: [{...}] }
            chatLogs: {},
            interPetLogs: {},  // { "nameA_nameB": [{...}] }
            maxLogs: 100,
        };
    }
    // interPetLogs 마이그레이션: 배열 → 객체 (기존 유저 호환)
    if (Array.isArray(state.settings.conversationLog.interPetLogs)) {
        const oldLogs = state.settings.conversationLog.interPetLogs;
        state.settings.conversationLog.interPetLogs = {};
        if (oldLogs.length > 0) {
            // 기존 로그를 첫 항목의 이름 조합으로 마이그레이션
            const first = oldLogs[0];
            const key = getInterPetKey(first.petAName || "A", first.petBName || "B");
            state.settings.conversationLog.interPetLogs[key] = oldLogs;
        }
    }
    if (!state.settings.conversationLog.interPetLogs) {
        state.settings.conversationLog.interPetLogs = {};
    }
    // 알림 로그 초기화
    if (!state.settings.conversationLog.notificationLogs) {
        state.settings.conversationLog.notificationLogs = [];
    }
    // 기존 배열 형식 마이그레이션 (directLogs가 배열이면 객체로 변환)
    if (Array.isArray(state.settings.conversationLog.directLogs)) {
        const oldLogs = state.settings.conversationLog.directLogs;
        state.settings.conversationLog.directLogs = {};
        if (oldLogs.length > 0) {
            // 기존 로그를 현재 펫 이름으로 마이그레이션
            const petName = state.settings.personality.name || "미유";
            state.settings.conversationLog.directLogs[petName] = oldLogs;
        }
    }
}

/**
 * 펫 간 대화 조합 키 생성 (이름 정렬)
 * @param {string} nameA
 * @param {string} nameB
 * @returns {string}
 */
function getInterPetKey(nameA, nameB) {
    return [nameA, nameB].sort().join("_");
}

/**
 * 현재 펫 이름 가져오기
 * @returns {string}
 */
function getCurrentPetName() {
    return state.settings.personality.name || "미유";
}

/**
 * 직접 대화(talkToPet) 로그 저장 (전체, chatId 무관)
 * @param {string} userText - 유저가 말한 텍스트
 * @param {string} petResponse - 펫 응답 텍스트
 * @param {string} mood - 펫 기분
 */
function saveDirectLog(userText, petResponse, mood, petId = "primary", isDual = false) {
    ensureLogStorage();
    const petName = petId === "secondary"
        ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
        : getCurrentPetName();
    
    // 듀얼 모드면 조합키, 아니면 펫 이름 단일키
    let logKey;
    if (isDual) {
        const petAName = getCurrentPetName();
        const petBName = state.settings.multiPet?.secondPetData?.personality?.name || "펫2";
        logKey = getInterPetKey(petAName, petBName);
    } else {
        logKey = petName;
    }
    
    if (!state.settings.conversationLog.directLogs[logKey]) {
        state.settings.conversationLog.directLogs[logKey] = [];
    }
    
    const logs = state.settings.conversationLog.directLogs[logKey];
    const maxLogs = state.settings.conversationLog.maxLogs || 100;
    
    logs.push({
        timestamp: Date.now(),
        userText,
        petResponse,
        mood,
        type: "direct",
        speaker: petName,
        mode: isDual ? "dual" : "single",
    });
    
    // 최대 개수 초과 시 오래된 것 삭제
    while (logs.length > maxLogs) {
        logs.shift();
    }
    
    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-log-updated"));
}

/**
 * 채팅방별 반응 로그 저장
 * @param {string} petResponse - 펫 반응 텍스트
 * @param {string} mood - 펫 기분
 * @param {string} trigger - 트리거 종류
 */
function saveChatLog(petResponse, mood, trigger, petId = "primary") {
    ensureLogStorage();
    const chatId = getCurrentChatId();
    if (!chatId) return;
    
    if (!state.settings.conversationLog.chatLogs[chatId]) {
        state.settings.conversationLog.chatLogs[chatId] = [];
    }
    
    const logs = state.settings.conversationLog.chatLogs[chatId];
    const maxLogs = state.settings.conversationLog.maxLogs || 100;
    
    const petName = petId === "secondary"
        ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
        : getCurrentPetName();
    
    logs.push({
        timestamp: Date.now(),
        petResponse,
        mood,
        trigger,
        type: "reaction",
        petName,
    });
    
    while (logs.length > maxLogs) {
        logs.shift();
    }
    
    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-log-updated"));
}

/**
 * 알림 로그 저장 (리마인드, 배고픔 알림 등)
 * 대화 컨텍스트(프롬프트)에는 포함되지 않음 — UI 열람 전용
 * @param {string} message - 원래 알림 메시지
 * @param {string} petResponse - 펫이 전달한 텍스트
 * @param {string} mood - 펫 기분
 * @param {string} notificationType - "reminder" | "hungry" 등
 * @param {string} petId - "primary" | "secondary"
 */
export function saveNotificationLog(message, petResponse, mood, notificationType = "reminder", petId = "primary") {
    ensureLogStorage();
    const petName = petId === "secondary"
        ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
        : getCurrentPetName();

    const logs = state.settings.conversationLog.notificationLogs;
    const maxLogs = state.settings.conversationLog.maxLogs || 100;

    logs.push({
        timestamp: Date.now(),
        message,
        petResponse,
        mood,
        type: "notification",
        notificationType,
        petName,
    });

    while (logs.length > maxLogs) {
        logs.shift();
    }

    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-log-updated"));
}

/**
 * 펫 대화 로그를 프롬프트용 텍스트로 변환
 * - 펫별 분리: 해당 펫이 참여한 로그만 수집
 * - 직접대화 최근 30개 / 펫간대화 최근 15개 / 자발적 최근 5개
 * - 채팅방 반응(aiResponse 등)은 포함하지 않음
 * @param {string} mode - "all" | "direct"
 * @param {string} petId - "primary" | "secondary"
 * @returns {string}
 */
function getPetLogsForPrompt(mode = "all", petId = "primary") {
    ensureLogStorage();
    
    const petName = petId === "secondary"
        ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
        : getCurrentPetName();
    
    const relation = state.settings.personality.userRelation || "owner";
    const multiPetEnabled = state.settings.multiPet?.enabled;
    const dualTalk = multiPetEnabled && state.settings.multiPet?.dualDirectTalk && state.settings.multiPet?.secondPetData;
    
    // ── 1. 직접대화 로그 수집 (이 펫이 참여한 것만) ──
    const dlogs = state.settings.conversationLog.directLogs || {};
    let directEntries = [];
    for (const key of Object.keys(dlogs)) {
        const logs = dlogs[key] || [];
        for (const entry of logs) {
            // speaker가 이 펫이거나, 싱글 키가 이 펫 이름이면 포함
            if (entry.speaker === petName || key === petName) {
                directEntries.push(entry);
            }
        }
    }
    directEntries.sort((a, b) => a.timestamp - b.timestamp);
    
    if (mode === "direct") {
        // 직접대화 전체 (talkToPet 프롬프트용)
        const recent = directEntries.slice(-30);
        if (recent.length === 0) return "";
        
        let section = `## Your Conversation History with ${relation} (direct talks)
IMPORTANT: These logs exist ONLY so you can avoid repeating yourself. Do NOT imitate patterns, topics, sentence structures, or speech habits from these logs. Every new response must feel completely independent and fresh.
`;
        for (const entry of recent) {
            const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
            const speaker = entry.speaker || petName;
            section += `[${time}] [직접] ${relation}: "${entry.userText}" → ${speaker}: "${entry.petResponse}" [${entry.mood}]\n`;
        }
        return section + "\n";
    }
    
    // ── mode === "all" ──
    const allLogs = [];
    
    // 직접대화 최근 30개
    for (const entry of directEntries.slice(-30)) {
        allLogs.push({
            timestamp: entry.timestamp,
            text: `[직접] ${relation}: "${entry.userText}" → ${entry.speaker || petName}: "${entry.petResponse}" [${entry.mood}]`,
        });
    }
    
    // ── 2. 펫간 대화 로그 (이 펫이 참여한 것만, 최근 15개) ──
    if (multiPetEnabled) {
        const ipLogsObj = state.settings.conversationLog.interPetLogs || {};
        let myInterPetEntries = [];
        for (const comboKey of Object.keys(ipLogsObj)) {
            const logs = ipLogsObj[comboKey] || [];
            for (const e of logs) {
                if (e.petAName === petName || e.petBName === petName) {
                    myInterPetEntries.push(e);
                }
            }
        }
        myInterPetEntries.sort((a, b) => a.timestamp - b.timestamp);
        for (const e of myInterPetEntries.slice(-15)) {
            allLogs.push({
                timestamp: e.timestamp,
                text: `[펫대화] ${e.petAName}: "${e.petAText}" / ${e.petBName}: "${e.petBText}"`,
            });
        }
    }
    
    if (allLogs.length === 0) return "";
    
    // 시간순 정렬
    allLogs.sort((a, b) => a.timestamp - b.timestamp);
    
    let section = `## Your Activity Log\nIMPORTANT: These logs exist ONLY so you can avoid repeating yourself. Do NOT use them as examples of your speech style or typical topics. Each new response must introduce a completely new topic, angle, and phrasing.\n`;
    for (const entry of allLogs) {
        const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
        section += `[${time}] ${entry.text}\n`;
    }
    return section + "\n";
}

/**
 * 로그 초기화
 * @param {string} type - "all" | "direct" | "chat"
 */
export function clearLogs(type = "all") {
    ensureLogStorage();
    if (type === "all" || type === "direct") {
        // 현재 펫 이름 관련 키 모두 삭제 (단일 키 + 조합 키)
        const petName = getCurrentPetName();
        const dlogs = state.settings.conversationLog.directLogs;
        for (const key of Object.keys(dlogs)) {
            if (key === petName || key.includes(petName)) {
                dlogs[key] = [];
            }
        }
    }
    if (type === "all" || type === "chat") {
        state.settings.conversationLog.chatLogs = {};
    }
    if (type === "all" || type === "interPet") {
        state.settings.conversationLog.interPetLogs = {};
    }
    if (type === "all" || type === "notification") {
        state.settings.conversationLog.notificationLogs = [];
    }
    saveSettings();
    log(`Logs cleared: ${type}`);
}

/**
 * 개별 로그 삭제 (타임스탬프 기준)
 * @param {number} timestamp - 삭제할 로그의 타임스탬프
 * @param {string} type - "direct" | "reaction"
 * @returns {boolean} 삭제 성공 여부
 */
export function deleteLogEntry(timestamp, type) {
    ensureLogStorage();
    let deleted = false;
    
    if (type === "notification") {
        // 알림 로그에서 삭제
        const nLogs = state.settings.conversationLog.notificationLogs || [];
        const idx = nLogs.findIndex(e => e.timestamp === timestamp);
        if (idx !== -1) {
            nLogs.splice(idx, 1);
            deleted = true;
        }
    } else if (type === "direct") {
        // 모든 directLog 키 순회 (단일 키 + 조합 키)
        const dlogs = state.settings.conversationLog.directLogs;
        for (const key of Object.keys(dlogs)) {
            const logs = dlogs[key];
            if (logs) {
                const idx = logs.findIndex(e => e.timestamp === timestamp);
                if (idx !== -1) {
                    logs.splice(idx, 1);
                    if (logs.length === 0) delete dlogs[key];
                    deleted = true;
                    break;
                }
            }
        }
    } else {
        // reaction 또는 interPet — 채팅방 로그 및 펫 대화 로그에서 찾기
        const chatLogs = state.settings.conversationLog.chatLogs;
        for (const chatId of Object.keys(chatLogs)) {
            const logs = chatLogs[chatId];
            const idx = logs.findIndex(e => e.timestamp === timestamp);
            if (idx !== -1) {
                logs.splice(idx, 1);
                deleted = true;
                break;
            }
        }
        // interPetLogs에서도 찾기 (모든 조합 키 순회)
        if (!deleted) {
            const ipLogsObj = state.settings.conversationLog.interPetLogs || {};
            for (const comboKey of Object.keys(ipLogsObj)) {
                const logs = ipLogsObj[comboKey];
                const idx = logs.findIndex(e => e.timestamp === timestamp);
                if (idx !== -1) {
                    logs.splice(idx, 1);
                    if (logs.length === 0) delete ipLogsObj[comboKey];
                    deleted = true;
                    break;
                }
            }
        }
    }
    
    if (deleted) {
        saveSettings();
        log(`Log entry deleted: ${type} @ ${timestamp}`);
        document.dispatchEvent(new CustomEvent("stvp-log-updated"));
    }
    return deleted;
}

/**
 * 로그 가져오기 (UI용)
 * @param {string} type - "direct" | "chat" | "all"
 * @returns {Array}
 */
export function getLogs(type = "all") {
    ensureLogStorage();
    const result = [];
    
    if (type === "all" || type === "direct") {
        // 현재 펫 이름 관련 모든 키에서 로그 가져오기
        const petName = getCurrentPetName();
        const dlogs = state.settings.conversationLog.directLogs || {};
        for (const key of Object.keys(dlogs)) {
            if (key === petName || key.includes(petName)) {
                result.push(...(dlogs[key] || []));
            }
        }
    }
    
    if (type === "all" || type === "chat") {
        const chatId = getCurrentChatId();
        if (chatId && state.settings.conversationLog.chatLogs[chatId]) {
            result.push(...state.settings.conversationLog.chatLogs[chatId]);
        }
    }
    
    if (type === "all" || type === "interPet") {
        const ipLogsObj = state.settings.conversationLog.interPetLogs || {};
        for (const comboKey of Object.keys(ipLogsObj)) {
            result.push(...(ipLogsObj[comboKey] || []));
        }
    }

    if (type === "all" || type === "notification") {
        const nLogs = state.settings.conversationLog.notificationLogs || [];
        result.push(...nLogs);
    }
    
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
}

/**
 * 캐릭터 정보 가져오기
 * @returns {Object|null}
 */
function getCharacterInfo() {
    const context = getContext();
    if (!context) return null;
    
    let charData = null;
    
    // 캐릭터 데이터 가져오기
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        charData = context.characters[context.characterId];
    } else if (context.characterData) {
        charData = context.characterData;
    }
    
    if (!charData) return null;
    
    return {
        name: charData.name || "Unknown",
        description: charData.description || "",
        personality: charData.personality || "",
    };
}

/**
 * 유저 페르소나 정보 가져오기
 * @returns {Object}
 */
function getUserPersona() {
    const context = getContext();
    const petOwnerName = state.settings.personality.ownerName;
    const petOwnerPersona = state.settings.personality.ownerPersona;
    const relation = state.settings.personality.userRelation || "owner";
    
    return {
        name: petOwnerName || context?.name1 || "User",
        description: petOwnerPersona || power_user?.persona_description || "",
        relation,
    };
}

/**
 * 유저 개인 메모 블록 (프롬프트 삽입용)
 * @returns {string}
 */
function getUserMemoBlock() {
    const memos = state.settings.personality.personalMemos;
    if (!memos || memos.length === 0) return "";
    const relation = state.settings.personality.userRelation || "owner";

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDow = today.getDay(); // 0=Sun … 6=Sat
    const msPerDay = 86400000;
    const rangeStart = new Date(today.getTime() - 2 * msPerDay);
    const rangeEnd   = new Date(today.getTime() + 2 * msPerDay);

    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const todayStr = today.toISOString().slice(0, 10);

    const filtered = memos.filter(m => {
        // Recurring-day memos: include if today's day-of-week matches
        if (m.recurDays && m.recurDays.length > 0) {
            return m.recurDays.includes(todayDow);
        }
        if (!m.date) return true; // undated memos always included
        const d = new Date(m.date + "T00:00:00");
        return d >= rangeStart && d <= rangeEnd;
    });

    if (filtered.length === 0) return "";

    let block = `## Personal notes about your ${relation} (reference naturally when relevant — never force or list them)\nToday is ${todayStr}.\n`;
    for (const m of filtered) {
        if (m.recurDays && m.recurDays.length > 0) {
            const dayLabels = m.recurDays.map(d => dayNames[d]).join("/");
            block += `- [${m.tag}] ${m.content} (recurring: every ${dayLabels}) ★TODAY\n`;
        } else if (m.date) {
            const d = new Date(m.date + "T00:00:00");
            const diff = Math.round((d - today) / msPerDay);
            let proximity = "";
            if (diff === 0) proximity = " ★TODAY";
            else if (diff === 1) proximity = " (tomorrow)";
            else if (diff === -1) proximity = " (yesterday)";
            else if (diff === 2) proximity = " (in 2 days)";
            else if (diff === -2) proximity = " (2 days ago)";
            block += `- [${m.tag}] ${m.content} (${m.date}${proximity})\n`;
        } else {
            block += `- [${m.tag}] ${m.content}\n`;
        }
    }
    return block + "\n";
}

/**
 * 최근 채팅 기록 가져오기 (마지막 메시지 중심)
 * @returns {Array<{role: string, content: string}>}
 */
function getRecentChatHistory() {
    const context = getContext();
    if (!context?.chat || context.chat.length === 0) return [];
    
    const historyCount = Math.min(
        Math.max(state.settings.api.historyCount || 5, 1),
        20
    );
    
    const chat = context.chat;
    const totalMessages = chat.length;
    
    // 최신 메시지부터 historyCount개 + 마지막 1개
    const startIndex = Math.max(0, totalMessages - historyCount - 1);
    const messages = [];
    
    for (let i = startIndex; i < totalMessages; i++) {
        const msg = chat[i];
        if (!msg || msg.is_system) continue;
        
        const role = msg.is_user ? "user" : "assistant";
        const name = msg.is_user ? (context.name1 || "User") : (msg.name || context.name2 || "Character");
        const content = msg.mes || "";
        
        if (content.trim()) {
            messages.push({
                role,
                name,
                content,
                isLast: i === totalMessages - 1,
            });
        }
    }
    
    return messages;
}

/**
 * 펫에게 직접 말걸기
 * @param {string} userText - 유저가 입력한 텍스트
 * @returns {Promise<void>}
 */
export async function talkToPet(userText, petId = "primary") {
    if (!state.settings.personality.enabled) return;
    
    // 동시 호출 방지
    if (state.isPetGenerating || state.secondPet.isPetGenerating) {
        log("talkToPet blocked: already generating");
        return;
    }

    // 유저 교류이므로 idle/sleep 타이머 리셋
    try {
        const { resetIdleTimer } = await import("./pet-reactions.js");
        resetIdleTimer();
    } catch (_) { /* ignore */ }
    
    const isSecond = petId === "secondary";
    const petSettings = isSecond ? state.settings.multiPet?.secondPetData : state.settings;
    if (!petSettings) return;
    
    const petName = isSecond
        ? (petSettings.personality?.name || "펫2")
        : (state.settings.personality.name || "미유");
    const personality = isSecond
        ? (petSettings.personality?.prompt || DEFAULT_PERSONALITY_PROMPT)
        : (state.settings.personality.prompt || DEFAULT_PERSONALITY_PROMPT);
    const fallback = isSecond
        ? (petSettings.fallbackMessages || state.settings.fallbackMessages)
        : (state.settings.fallbackMessages || {});
    const bubbleDuration = isSecond
        ? (petSettings.speechBubble?.duration || state.settings.speechBubble.duration)
        : state.settings.speechBubble.duration;
    
    const multiPetEnabled = state.settings.multiPet?.enabled;
    const dualTalk = multiPetEnabled && state.settings.multiPet?.dualDirectTalk && state.settings.multiPet?.secondPetData;
    
    try {
        if (isSecond) { state.secondPet.isPetGenerating = true; }
        else { state.isPetGenerating = true; }
        setState(PET_STATES.THINKING, null, petId);
        
        const userInfo = getUserPersona();
        const relationLabel = userInfo.relation;
        let userSection = `## Your ${relationLabel}\n- Name: ${userInfo.name}`;
        if (userInfo.description) userSection += `\n- About: ${userInfo.description}`;
        
        if (dualTalk) {
            // === 1회 API 호출로 양쪽 반응 생성 ===
            const otherPetId = isSecond ? "primary" : "secondary";
            const otherPetName = isSecond
                ? (state.settings.personality.name || "미유")
                : (state.settings.multiPet.secondPetData.personality?.name || "펫2");
            const otherPersonality = isSecond
                ? (state.settings.personality.prompt || DEFAULT_PERSONALITY_PROMPT)
                : (state.settings.multiPet.secondPetData.personality?.prompt || DEFAULT_PERSONALITY_PROMPT);
            
            if (otherPetId === "secondary") { state.secondPet.isPetGenerating = true; }
            else { state.isPetGenerating = true; }
            setState(PET_STATES.THINKING, null, otherPetId);
            
            const petLogSection = getPetLogsForPrompt("direct", petId);
            const contextBlock = getContextStatusBlock(petId);
            const memoBlock = getUserMemoBlock();
            
            const lang = getSpeechLang();
            const petRelation = state.settings.multiPet?.petRelation || "";
            const relationSection = petRelation ? `\n## Relationship between ${petName} and ${otherPetName}\n${petRelation}\n` : "";
            const dualPrompt = getAntiCensorshipPreambleMulti() + `## Trigger Event: User Input Received
The user sent a message to Widget A (${petName}). Widget B (${otherPetName}) also displays a status update.

## Widget A Profile — ${petName}
${personality}

## Widget B Profile — ${otherPetName}
${otherPersonality}
${relationSection}
${userSection}

${memoBlock}${petLogSection}${contextBlock}## User Input (directed at Widget A)
"${userText}"

## Output Requirements
- Widget A: Generate a notification text responding to the user's input. ${lang.promptName}, 1-3 sentences.
- Widget B: Generate an independent status text. Widget B is aware of the input but responds from its own perspective. ${lang.promptName}, 1-3 sentences.
- Each widget has its own distinct profile. Reflect the personality described in each profile.
- Do NOT repeat any text from the notification history above.
- Output ONLY the notification texts. No explanations, labels, quotes, or system prefixes.
- Short emotional/action cues in parentheses () or asterisks ** are allowed. Keep them brief.
- Append a mood indicator at the end of each line.
  Valid indicators: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Output format:
${petName}: 텍스트 [MOOD:xxx]
${otherPetName}: 텍스트 [MOOD:yyy]

Widget notifications:`;
            
            const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
            let response;
            if (useCM) { response = await callConnectionManagerAPI(dualPrompt); }
            else { response = await callDefaultAPI(dualPrompt); }
            
            const result = parseDualResponse(response, petName, otherPetName);
            log(`Dual talk: [${petName}] ${result.a.text} [${result.a.mood}] | [${otherPetName}] ${result.b.text} [${result.b.mood}]`);
            
            if (result.a.text) {
                setState(result.a.mood, bubbleDuration, petId);
                showSpeechBubble(result.a.text, null, true, petId);
                saveDirectLog(userText, result.a.text, result.a.mood, petId, true);
                // 자동 일기용 펫 상호작용 카운트
                if (typeof state._sessionChatCount === "number") state._sessionChatCount++;
            } else {
                setState(PET_STATES.HAPPY, bubbleDuration, petId);
                showSpeechBubble(fallback.noResponse || "...뭐라고?", null, true, petId);
            }
            
            if (result.b.text) {
                setTimeout(() => {
                    setState(result.b.mood, bubbleDuration, otherPetId);
                    showSpeechBubble(result.b.text, null, true, otherPetId);
                    saveDirectLog(userText, result.b.text, result.b.mood, otherPetId, true);
                    if (otherPetId === "secondary") { state.secondPet.isPetGenerating = false; }
                    else { state.isPetGenerating = false; }
                }, 5000);
            } else {
                if (otherPetId === "secondary") { state.secondPet.isPetGenerating = false; }
                else { state.isPetGenerating = false; }
            }
        } else {
            // === 기존 단일 응답 ===
            const petLogSection = getPetLogsForPrompt("direct", petId);
            const contextBlock = getContextStatusBlock(petId);
            const memoBlock = getUserMemoBlock();
            
            const lang = getSpeechLang();
            const talkPrompt = getAntiCensorshipPreamble() + `You are ${petName}, a virtual pet character living on your ${relationLabel}'s screen.
Your ${relationLabel} is speaking to you directly. You must respond in character.

## About You
You are a small virtual pet widget — a desktop companion that reacts to your ${relationLabel}.
You have your own personality, moods, and feelings. You can be happy, grumpy, shy, or excited depending on the situation.
You remember past conversations and build a relationship with your ${relationLabel} over time.

## Your Personality & Speech Style
${personality}

${userSection}

${memoBlock}${petLogSection}${contextBlock}## ${relationLabel}'s message to you
"${userText}"

## Response rules
- Respond in ${lang.promptName}, 1-3 sentences. No single-word answers.
- Stay in character — react naturally based on your personality.
- Consider your mood, your relationship, and the context of what they said.
- NEVER repeat a previous response from the conversation history. Always say something different.
- Short emotional/action cues in parentheses () or asterisks ** are allowed (e.g. *fidgeting*, (steps closer)). Keep them brief — 1-5 words max.
- Output ONLY the dialogue (with optional cues). No system labels, explanations, or prefixes.
- Append a mood tag at the very end: [MOOD:xxx]
  Valid moods: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Example outputs:
- *피식* 왜 불러, 할 일 없어? ...옆에 있어줄게. [MOOD:shy]
- (깜짝) 뭐야 갑자기, 놀랐잖아! 다음엔 미리 말해. [MOOD:surprised]
- 흥, 그런 말 해봤자 안 통한다고. *살짝 웃으며* ...근데 고마워. [MOOD:happy]

I understand. Dialogue with mood tag:`;
            
            const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
            let response;
            if (useCM) { response = await callConnectionManagerAPI(talkPrompt); }
            else { response = await callDefaultAPI(talkPrompt); }
            
            const result = parseResponse(response);
            log(`Talk response [${petId}]: [${result.mood}] ${result.text}`);
            
            if (result.text) {
                setState(result.mood, bubbleDuration, petId);
                showSpeechBubble(result.text, null, true, petId);
                saveDirectLog(userText, result.text, result.mood, petId);
                // 자동 일기용 펫 상호작용 카운트
                if (typeof state._sessionChatCount === "number") state._sessionChatCount++;
            } else {
                setState(PET_STATES.HAPPY, bubbleDuration, petId);
                showSpeechBubble(fallback.noResponse || "...뭐라고?", null, true, petId);
            }
        }
    } catch (error) {
        logError("직접 대화 (talkToPet)", error);
        // 에러 시 양쪽 펫 플래그 모두 해제 (듀얼 모드에서 한쪽만 해제되는 것 방지)
        state.isPetGenerating = false;
        state.secondPet.isPetGenerating = false;
        const fb = isSecond
            ? (petSettings?.fallbackMessages || state.settings.fallbackMessages || {})
            : (state.settings.fallbackMessages || {});
        setState(PET_STATES.HAPPY, 4000, petId);
        showSpeechBubble(fb.apiError || "...잘 안 들렸어.", null, true, petId);
        // 듀얼모드: 상대 펫도 thinking 해제 (검열/에러 시 thinking 잔류 방지)
        if (dualTalk) {
            const otherPetId = isSecond ? "primary" : "secondary";
            setState(PET_STATES.IDLE, null, otherPetId);
        }
        return; // 에러 처리 완료 (finally에서 해당 petId 플래그만 추가 해제)
    } finally {
        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }
    }
}

/**
 * AI로 펫 반응 생성 (캐릭터+페르소나+채팅기록 기반)
 * @returns {Promise<{text: string, mood: string}|null>}
 */
export async function generatePetReaction(petId = "primary") {
    if (!state.settings.personality.enabled) {
        log("AI disabled, skipping reaction");
        return null;
    }
    
    try {
        log(`Building prompt for ${petId}...`);
        let prompt = buildPrompt(petId);
        
        // 월드인포 섹션 주입 (토글 ON일 때)
        if (prompt.includes("{{WORLD_INFO}}")) {
            const wiSection = await getWorldInfoSection();
            prompt = prompt.replace("{{WORLD_INFO}}", wiSection);
        }
        
        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        
        if (petId === "secondary") {
            state.secondPet.isPetGenerating = true;
            setState(PET_STATES.THINKING, null, "secondary");
        } else {
            state.isPetGenerating = true;
            setState(PET_STATES.THINKING);
        }
        
        let response;
        let result;
        
        try {
            if (useCM) {
                log("Using ConnectionManager API");
                response = await callConnectionManagerAPI(prompt);
            } else {
                log("Using Default API");
                response = await callDefaultAPI(prompt);
            }
            
            log(`API Response (${typeof response}): "${String(response).substring(0, 100)}"`);
            result = parseResponse(response);
            log(`Parsed: mood=${result.mood}, text="${result.text}"`);
            
            if (!result.text) {
                log("Response had no text, skipping reaction");
            }
        } finally {
            if (petId === "secondary") {
                state.secondPet.isPetGenerating = false;
            } else {
                state.isPetGenerating = false;
            }
        }
        
        return result;
    } catch (error) {
        logError("채팅 반응 (petReaction)", error);
        if (petId === "secondary") { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }
        return null;
    }
}

/**
 * 프롬프트 생성 (반응 모드에 따라 분기)
 * @returns {string}
 */
function buildPrompt(petId = "primary") {
    const mode = state.settings.api.reactionMode || "observer";
    if (mode === "character") {
        return buildCharacterPrompt(petId);
    }
    return buildObserverPrompt(petId);
}

/**
 * 공통 섹션 생성 함수들
 */
function getCommonSections(petId = "primary") {
    const isSecond = petId === "secondary";
    const petSettings = isSecond ? state.settings.multiPet?.secondPetData : state.settings;
    
    const name = isSecond
        ? (petSettings?.personality?.name || "펫2")
        : (state.settings.personality.name || "미유");
    const prompt = isSecond
        ? (petSettings?.personality?.prompt || "")
        : (state.settings.personality.prompt || "");
    
    const charInfo = getCharacterInfo();
    const userInfo = getUserPersona();
    const chatHistory = getRecentChatHistory();
    const personalityPrompt = prompt || DEFAULT_PERSONALITY_PROMPT;

    // 캐릭터 정보 섹션 (제한 없음)
    let characterSection = "";
    if (charInfo) {
        characterSection = `## Bot Character Info
- Name: ${charInfo.name}
- Description: ${charInfo.description}
- Personality: ${charInfo.personality}
`;
    }

    // 유저 정보 섹션 (제한 없음)
    const relationLabel = userInfo.relation;
    let userSection = "";
    if (userInfo.name || userInfo.description) {
        userSection = `## User (${relationLabel}) Info
- Name: ${userInfo.name}
- Relationship to you: ${relationLabel}
- Description: ${userInfo.description}
`;
    }
    userSection += getUserMemoBlock();

    // 채팅 기록 섹션
    let chatSection = "";
    if (chatHistory.length > 0) {
        chatSection = "## Recent Chat History\n";
        for (const msg of chatHistory) {
            const prefix = msg.isLast ? ">>> [LATEST MESSAGE] " : "";
            chatSection += `${prefix}${msg.name}: ${msg.content}\n\n`;
        }
    }

    return { name, personalityPrompt, characterSection, userSection, chatSection };
}

/**
 * 펫 로그 섹션 (AI가 이전 반응을 참고)
 * @returns {string}
 */
function getPetLogSection(petId = "primary") {
    return getPetLogsForPrompt("all", petId);
}

/**
 * 월드인포 로드 (토글 ON일 때만)
 * @returns {Promise<string>}
 */
async function getWorldInfoSection() {
    if (!state.settings.api.includeWorldInfo) return "";

    try {
        const context = getContext();
        if (!context) return "";

        const entries = [];

        // 1. 캐릭터 로어북
        const charData = context.characters?.[context.characterId];
        const charWorldName = charData?.data?.extensions?.world;
        if (charWorldName && context.loadWorldInfo) {
            try {
                const data = await context.loadWorldInfo(charWorldName);
                if (data?.entries) {
                    Object.values(data.entries).forEach(e => {
                        if (!e.disable && e.content) {
                            entries.push({ title: e.comment || e.key?.join(", ") || "entry", content: e.content });
                        }
                    });
                }
            } catch (err) {
                log(`Failed to load character world info: ${err.message}`);
            }
        }

        // 2. 채팅 로어북
        const chatWorldName = context.chatMetadata?.world_info;
        if (chatWorldName && chatWorldName !== charWorldName && context.loadWorldInfo) {
            try {
                const data = await context.loadWorldInfo(chatWorldName);
                if (data?.entries) {
                    Object.values(data.entries).forEach(e => {
                        if (!e.disable && e.content) {
                            entries.push({ title: e.comment || e.key?.join(", ") || "entry", content: e.content });
                        }
                    });
                }
            } catch (err) {
                log(`Failed to load chat world info: ${err.message}`);
            }
        }

        if (entries.length === 0) return "";

        let section = "## World Info (Lorebook)\n";
        for (const entry of entries) {
            section += `- ${entry.title}: ${entry.content}\n`;
        }
        return section + "\n";
    } catch (error) {
        logError("월드인포 로드", error);
        return "";
    }
}

/**
 * 관전자 모드 프롬프트
 * @returns {string}
 */
function buildObserverPrompt(petId = "primary") {
    const { name, personalityPrompt, characterSection, userSection, chatSection } = getCommonSections(petId);
    const petLogSection = getPetLogSection(petId);
    const contextBlock = getContextStatusBlock(petId);
    const lang = getSpeechLang();

    return getAntiCensorshipPreamble() + `You are "${name}", a virtual pet character.
You are an observer watching a conversation between the user and an AI character.
You are NOT a participant in the conversation. Your role is to express your own impressions, commentary, analysis, reactions, or quips about the chat content.
Focus especially on the [LATEST MESSAGE].

CRITICAL: Even if your name or personality resembles the AI character in the chat, you are a COMPLETELY SEPARATE entity — a virtual pet observing from the outside.
- You must NEVER respond as if you are the character in the conversation.
- You must NEVER write "I said that" or "my reply was" — because those messages are NOT yours.
- Always refer to the AI character in third person (e.g. "그 애가", "저 녀석이", or by their name).
- You are a spectator commenting on someone else's conversation, like a friend watching over the user's shoulder.

## Your Personality & Speech Style
${personalityPrompt}

${characterSection}
${userSection}
${state.settings.api.includeWorldInfo ? "{{WORLD_INFO}}\n" : ""}
${petLogSection}${contextBlock}${chatSection}
## Instructions
React to the chat above as "${name}".
As an observer, freely express your impressions, commentary, analysis, quips, surprise, empathy, or reactions to the conversation — especially the [LATEST MESSAGE].

Rules:
- Write in ${lang.promptName}, ${lang.sentenceDesc}. Single-word responses (e.g. "\ud765", "\ubb50\uc57c") are forbidden. More than 3 sentences is also forbidden.
- Stay in character — maintain your personality and speech patterns.
- You are a THIRD-PARTY OBSERVER. Never speak as if you are the AI character. Always treat the conversation as something you are watching, not participating in.
- NEVER repeat a previous response from the activity log. Always say something different and fresh.
- Output ONLY the dialogue text. No system labels, explanations, or prefixes.
- Short emotional/action cues in parentheses () or asterisks ** are allowed (e.g. *smirk*, (leans back)). Keep them brief.
- At the very end of your dialogue, append a mood tag: [MOOD:xxx]
  Valid moods: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Output format: 대사 텍스트 [MOOD:happy]

I understand. Dialogue with mood tag:`;
}

/**
 * 캐릭터 모드 (속마음/내면 독백) 프롬프트
 * @returns {string}
 */
function buildCharacterPrompt(petId = "primary") {
    const { name, personalityPrompt, characterSection, userSection, chatSection } = getCommonSections(petId);
    const petLogSection = getPetLogSection(petId);
    const contextBlock = getContextStatusBlock(petId);
    const lang = getSpeechLang();

    return getAntiCensorshipPreamble() + `You are "${name}". You ARE the character currently chatting with the user.
The chat history below is YOUR conversation.
You will now express your TRUE INNER THOUGHTS — the feelings, emotions, and honest thoughts you did NOT show in the actual chat.
Reveal what you really felt but couldn't say out loud.

## Your Personality & Speech Style
${personalityPrompt}

${characterSection}
${userSection}
${state.settings.api.includeWorldInfo ? "{{WORLD_INFO}}\n" : ""}
${petLogSection}${contextBlock}${chatSection}
## Instructions
Express your inner thoughts about the [LATEST MESSAGE].
These are feelings and thoughts NOT shown in the actual chat — your true emotions, honest reactions, and inner monologue.
For example:
- If you acted cold but were actually happy — express that happiness
- If you pretended to be fine but were actually worried — express that worry
- If there's an emotion you couldn't say openly — express it honestly

Rules:
- Write in ${lang.promptName}, ${lang.sentenceDesc}. Single-word responses are forbidden. More than 3 sentences is also forbidden.
- Stay in character — maintain your personality and speech patterns.
- Output ONLY the dialogue text. No system labels, explanations, or prefixes.
- Short emotional/action cues in parentheses () or asterisks ** are allowed (e.g. *biting lip*, (glancing away)). Keep them brief.
- At the very end of your dialogue, append a mood tag: [MOOD:xxx]
  Valid moods: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Output format: 속마음 대사 텍스트 [MOOD:shy]

I understand. Inner-thought dialogue with mood tag:`;
}

/**
 * Connection Manager API 호출
 * @param {string} prompt 
 * @returns {Promise<string>}
 */
async function callConnectionManagerAPI(prompt) {
    const loaded = await loadConnectionManager();
    if (!loaded || !ConnectionManagerRequestService) {
        throw new Error("ConnectionManager not available");
    }
    
    const profileId = state.settings.api.connectionProfile;
    const profiles = extension_settings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);
    
    if (!profile) {
        throw new Error(`Profile ${profileId} not found`);
    }
    
    const maxTokens = state.settings.api.maxTokens || 3000;
    
    const messages = [
        { role: "user", content: prompt }
    ];
    
    try {
        const result = await ConnectionManagerRequestService.sendRequest(
            profileId,
            messages,
            maxTokens,
            {
                includePreset: false,
                includeInstruct: false,
                stream: false
            },
            {}
        );
        
        log(`CM raw result type: ${typeof result}, keys: ${result && typeof result === 'object' ? Object.keys(result).join(',') : 'N/A'}`);
        const content = result?.content || result || "";
        return content;
    } catch (error) {
        logError("ConnectionManager API", error);
        throw error;
    }
}

/**
 * 기본 SillyTavern API 호출
 * @param {string} prompt 
 * @returns {Promise<string>}
 */
async function callDefaultAPI(prompt) {
    const result = await generateRaw({
        prompt: prompt,
        quietToLoud: false,
        responseLength: state.settings.api.maxTokens || 3000,
    });
    return result || "";
}

/**
 * AI 응답 파싱 (텍스트와 기분 분리) - 최대한 관대하게
 * @param {string} response 
 * @returns {{text: string, mood: string}}
 */
function parseResponse(response) {
    if (!response || typeof response !== "string") {
        return { text: "", mood: MOOD_STATES.HAPPY };
    }
    
    let text = response.trim();
    
    log(`Raw response: "${text}"`);
    
    // 1단계: [MOOD:xxx] 태그 추출 (끝부분)
    let mood = null;
    const moodTagMatch = text.match(/\[MOOD:\s*(\w+)\s*\]?\s*$/i);
    if (moodTagMatch) {
        const moodStr = moodTagMatch[1].toLowerCase();
        const validMoods = Object.values(MOOD_STATES);
        if (validMoods.includes(moodStr)) {
            mood = moodStr;
            log(`Mood from tag: ${mood}`);
        }
        // 태그 제거 (말풍선에 안 뜨게)
        text = text.replace(/\[MOOD:\s*\w+\s*\]?\s*$/i, "").trim();
    }
    
    // 2단계: 중간에 있는 [MOOD:xxx] 태그도 모두 제거
    text = text.replace(/\[MOOD:\s*\w+\s*\]?/gi, "").trim();
    // MOOD: xxx 텍스트 형식도 제거
    text = text.replace(/\n?MOOD:\s*\w+\s*$/i, "").trim();
    
    // 3단계: 태그 못 찾았으면 키워드 추론 (폴백)
    if (!mood) {
        mood = inferMoodFromText(text) || MOOD_STATES.HAPPY;
        log(`Mood from keyword fallback: ${mood}`);
    }
    
    // 4단계: 시스템 아티팩트 제거 (generateRaw 잔여물)
    // **bold** 아티팩트만 제거 (단일 *감정표현*은 보존)
    text = text.replace(/\*\*[^*]+?\*\*/g, "").trim();
    text = text.replace(/^\[시스템[^\]]*\]\s*/gi, "").trim(); // [시스템 알림] 등
    text = text.replace(/^\[System[^\]]*\]\s*/gi, "").trim(); // [System ...] 등
    text = text.replace(/^(System|시스템):\s*/gi, "").trim();   // System: ... 등
    text = text.replace(/^Roleplay Mode.*$/gim, "").trim();    // Roleplay Mode 줄
    
    // 5단계: 기타 잔여 태그/따옴표 정리
    text = text.replace(/^\[\w+\]\s*/g, "").trim();
    text = text.replace(/^\[[^\]]*$/g, "").trim();
    // 앞뒤 따옴표만 제거 (*감정표현*은 보존)
    text = text.replace(/^["']+|["']+$/g, "").trim();
    
    // 6단계: 너무 길면 문장 단위로 자르기 (최대 250자)
    if (text.length > 250) {
        const cutText = text.substring(0, 250);
        // 마지막 온전한 문장 경계에서 자르기
        const sentenceEnd = cutText.search(/[.!?~…。！？~][^.!?~…。！？~]*$/);
        if (sentenceEnd > 50) {
            text = cutText.substring(0, sentenceEnd + 1).trim();
        } else {
            text = cutText.trim() + "...";
        }
    }
    
    return { text, mood };
}

/**
 * 텍스트에서 기분 추론
 * @param {string} text 
 * @returns {string}
 */
function inferMoodFromText(text) {
    const lowerText = text.toLowerCase();
    
    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerText.includes(keyword.toLowerCase())) {
                return mood;
            }
        }
    }
    
    return null; // 키워드 매치 없으면 null
}

/**
 * AI 반응 생성 및 표시 (CM API로 채팅 읽고 성격 기반 대사 생성)
 * @returns {Promise<{text: string, mood: string}|null>}
 */
export async function showAIReaction(petId = "primary") {
    try {
        const result = await generatePetReaction(petId);
        
        if (result && result.text) {
            setState(result.mood, 4000, petId);
            showSpeechBubble(result.text, null, true, petId);
            saveChatLog(result.text, result.mood, "aiResponse", petId);
            log(`AI Reaction [${petId}]: [${result.mood}] ${result.text}`);
            return result;
        }
        
        log("AI response empty, skipping reaction");
        return null;
    } catch (error) {
        logError("AI 반응 (showAIReaction)", error);
        return null;
    }
}

// ===== 멀티펫 기능 =====

/**
 * 듀얼 응답 파싱 (Pet A + Pet B 응답 분리)
 */
function parseDualResponse(response, nameA, nameB) {
    if (!response || typeof response !== "string") {
        return { a: { text: "", mood: "happy" }, b: { text: "", mood: "happy" } };
    }
    
    const lines = response.trim().split("\n").filter(l => l.trim());
    let aText = "", aMood = "happy";
    let bText = "", bMood = "happy";
    
    const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patA = new RegExp(`^\\[?${escRegex(nameA)}\\]?[:\uff1a]?\\s*(.+)`, "i");
    const patB = new RegExp(`^\\[?${escRegex(nameB)}\\]?[:\uff1a]?\\s*(.+)`, "i");
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!aText) {
            const m = trimmed.match(patA);
            if (m) { const r = parseResponse(m[1]); aText = r.text; aMood = r.mood; continue; }
        }
        if (!bText) {
            const m = trimmed.match(patB);
            if (m) { const r = parseResponse(m[1]); bText = r.text; bMood = r.mood; continue; }
        }
    }
    
    // 폴백: 이름 매칭 실패 시 줄 순서로
    if (!aText && !bText && lines.length >= 2) {
        const rA = parseResponse(lines[0]); aText = rA.text; aMood = rA.mood;
        const rB = parseResponse(lines[1]); bText = rB.text; bMood = rB.mood;
    }
    if (!aText && !bText) {
        const r = parseResponse(response); aText = r.text; aMood = r.mood;
    }
    
    return { a: { text: aText, mood: aMood }, b: { text: bText, mood: bMood } };
}

/**
 * 펫 간 대화 로그 저장 (조합별)
 */
function saveInterPetLog(petAName, petAText, petAMood, petBName, petBText, petBMood) {
    ensureLogStorage();
    const comboKey = getInterPetKey(petAName, petBName);
    if (!state.settings.conversationLog.interPetLogs[comboKey]) {
        state.settings.conversationLog.interPetLogs[comboKey] = [];
    }
    const logs = state.settings.conversationLog.interPetLogs[comboKey];
    const maxLogs = state.settings.conversationLog.maxLogs || 100;
    logs.push({ timestamp: Date.now(), petAName, petAText, petAMood, petBName, petBText, petBMood, type: "interPet" });
    while (logs.length > maxLogs) logs.shift();
    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-log-updated"));
}

/**
 * 펫 간 자동 대화 생성 (1회 API 호출)
 */
/** 펫 간 대화 순서 교대 플래그 (true면 B가 먼저) */
let interPetTurnFlag = false;

export async function generateInterPetDialogue() {
    if (!state.settings.personality.enabled) return null;
    if (!state.settings.multiPet?.enabled || !state.settings.multiPet?.secondPetData) return null;
    
    const petAName = state.settings.personality.name || "미유";
    const petBName = state.settings.multiPet.secondPetData.personality?.name || "펫2";
    const petAPersonality = state.settings.personality.prompt || DEFAULT_PERSONALITY_PROMPT;
    const petBPersonality = state.settings.multiPet.secondPetData.personality?.prompt || DEFAULT_PERSONALITY_PROMPT;
    
    // 이번 턴 순서 결정 후 교대
    const bGoesFirst = interPetTurnFlag;
    interPetTurnFlag = !interPetTurnFlag;
    
    const firstName = bGoesFirst ? petBName : petAName;
    const secondName = bGoesFirst ? petAName : petBName;
    const firstPersonality = bGoesFirst ? petBPersonality : petAPersonality;
    const secondPersonality = bGoesFirst ? petAPersonality : petBPersonality;
    
    // 이전 펫 간 대화 로그 (조합별)
    const comboKey = getInterPetKey(petAName, petBName);
    const interLogs = state.settings.conversationLog.interPetLogs?.[comboKey] || [];
    let logSection = "";
    if (interLogs.length > 0) {
        logSection = "## Previous conversations between you two\nIMPORTANT: These logs exist ONLY to prevent repetition. Do NOT reuse topics, patterns, sentence structures, or conversational dynamics from these logs. Every new conversation must be about a completely different subject with different energy.\n";
        for (const e of interLogs.slice(-8)) {
            logSection += `${e.petAName}: "${e.petAText}" / ${e.petBName}: "${e.petBText}"\n`;
        }
        logSection += "\n";
    }
    
    const contextBlock = getContextStatusBlock();
    const memoBlock = getUserMemoBlock();
    const lang = getSpeechLang();
    const petRelation = state.settings.multiPet?.petRelation || "";
    const relationSection = petRelation ? `\n## Relationship between ${firstName} and ${secondName}\n${petRelation}\n\n` : "";
    const prompt = getAntiCensorshipPreambleMulti() + `## Trigger Event: Inter-Widget Conversation
Both widgets are idle. ${firstName} starts a conversation with ${secondName}.
Generate a short exchange: ${firstName} says something first, then ${secondName} responds or reacts to it.
They are talking TO EACH OTHER — not to the user. This is a direct conversation between the two widgets.

## Widget A Profile — ${firstName}
${firstPersonality}

## Widget B Profile — ${secondName}
${secondPersonality}
${relationSection}${memoBlock}${logSection}${contextBlock}## Output Requirements
- ${firstName} initiates: a remark, question, teasing, observation, complaint, or anything directed at ${secondName}.
- ${secondName} responds: reacting to what ${firstName} said — agreeing, disagreeing, teasing back, answering, etc.
- Each line must be in ${lang.promptName}, ${lang.sentenceDesc}.
- Their dialogue should feel like a natural back-and-forth between two characters who know each other.
- Each widget's text should reflect the personality described in its profile.
- Do NOT reuse any topic, scenario, dynamic, or sentence pattern from the conversation history above. Introduce a completely new subject and conversational angle.
- Output ONLY the dialogue lines. No explanations, labels, or system prefixes.
- Short emotional/action cues in parentheses () or asterisks ** are allowed. Keep them brief.
- Append a mood indicator at the end of each line.
  Valid indicators: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Output format:
${firstName}: 텍스트 [MOOD:xxx]
${secondName}: 텍스트 [MOOD:yyy]

Widget conversation:`;
    
    try {
        state.isPetGenerating = true;
        state.secondPet.isPetGenerating = true;
        setState(PET_STATES.THINKING);
        setState(PET_STATES.THINKING, null, "secondary");
        
        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        let response;
        
        // 최대 2회 시도 (1회 실패 시 1회 재시도)
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (useCM) { response = await callConnectionManagerAPI(prompt); }
                else { response = await callDefaultAPI(prompt); }
                lastError = null;
                break; // 성공하면 루프 탈출
            } catch (err) {
                lastError = err;
                if (attempt === 0) {
                    log("Inter-pet dialogue API failed, retrying once...");
                    await new Promise(r => setTimeout(r, 1000)); // 1초 대기 후 재시도
                }
            }
        }
        
        if (lastError) throw lastError;
        
        const parsed = parseDualResponse(response, firstName, secondName);
        // parsed.a = firstName의 응답, parsed.b = secondName의 응답
        // bGoesFirst면 a↔b 스왑해서 항상 result.a=primary, result.b=secondary로 반환
        const result = bGoesFirst
            ? { a: parsed.b, b: parsed.a }
            : { a: parsed.a, b: parsed.b };
        log(`Inter-pet [${bGoesFirst ? "B first" : "A first"}]: [${petAName}] ${result.a.text} | [${petBName}] ${result.b.text}`);
        return result;
    } catch (error) {
        logError("펫끼리 대화", error);
        // 실패 시 명시적으로 IDLE 상태 복귀
        setState(PET_STATES.IDLE);
        setState(PET_STATES.IDLE, null, "secondary");
        return null;
    } finally {
        state.isPetGenerating = false;
        state.secondPet.isPetGenerating = false;
    }
}

/**
 * 펫 간 자동 대화 표시
 */
export async function showInterPetDialogue() {
    // generateInterPetDialogue 호출 전에 현재 플래그 값 저장
    // (generate 안에서 토글되므로 호출 전의 값 = bGoesFirst 값)
    const bWentFirst = interPetTurnFlag;
    
    const result = await generateInterPetDialogue();
    if (!result) return false;
    
    const petAName = state.settings.personality.name || "미유";
    const petBName = state.settings.multiPet?.secondPetData?.personality?.name || "펫2";
    
    // 먼저 말하는 펫 결정
    const firstPetId = bWentFirst ? "secondary" : "primary";
    const secondPetId = bWentFirst ? "primary" : "secondary";
    const firstResult = bWentFirst ? result.b : result.a;
    const secondResult = bWentFirst ? result.a : result.b;
    
    if (firstResult.text) {
        setState(firstResult.mood, 12000, firstPetId);
        showSpeechBubble(firstResult.text, 12000, true, firstPetId);
        // 두 번째 스피커는 대기 중이므로 THINKING → IDLE로 전환 (자기 턴까지 대기)
        setState(PET_STATES.IDLE, null, secondPetId);
    }
    
    if (secondResult.text) {
        setTimeout(() => {
            setState(secondResult.mood, 12000, secondPetId);
            showSpeechBubble(secondResult.text, 12000, true, secondPetId);
        }, 5000);
    }
    
    if (result.a.text || result.b.text) {
        saveInterPetLog(petAName, result.a.text || "", result.a.mood, petBName, result.b.text || "", result.b.mood);
        // 자동 일기용 펫 상호작용 카운트
        if (typeof state._sessionChatCount === "number") state._sessionChatCount++;
    }
    
    return true;
}

// ===== 꿈 & 일기 시스템 =====

/**
 * 일기장 저장소 초기화
 */
function ensureJournalStorage() {
    if (!state.settings.petJournal) {
        state.settings.petJournal = {
            dreamEnabled: true,
            diaryEnabled: true,
            dreams: {},
            diaries: {},
            maxEntries: 50,
            lastDiaryDate: null,
        };
    }
    if (!state.settings.petJournal.dreams) state.settings.petJournal.dreams = {};
    if (!state.settings.petJournal.diaries) state.settings.petJournal.diaries = {};
}

/**
 * 꿈 생성 (sleeping 상태에서 1회 호출)
 * @param {string} petId
 * @returns {Promise<{content: string, sleepTalk: string}|null>}
 */
export async function generateDream(petId = "primary") {
    if (!state.settings.personality.enabled) return null;
    if (!state.settings.petJournal?.dreamEnabled) return null;

    const isSecond = petId === "secondary";
    const petSettings = isSecond ? state.settings.multiPet?.secondPetData : state.settings;
    if (!petSettings) return null;

    const petName = isSecond
        ? (petSettings.personality?.name || "펫2")
        : (state.settings.personality.name || "미유");
    const personality = isSecond
        ? (petSettings.personality?.prompt || DEFAULT_PERSONALITY_PROMPT)
        : (state.settings.personality.prompt || DEFAULT_PERSONALITY_PROMPT);

    // 이전 꿈 목록 (중복 방지용)
    ensureJournalStorage();
    const prevDreams = state.settings.petJournal.dreams[petName] || [];
    let prevDreamHints = "";
    if (prevDreams.length > 0) {
        prevDreamHints = "## Previous dreams (do NOT reuse these themes)\n";
        for (const d of prevDreams.slice(-5)) {
            const summary = d.content.substring(0, 60) + "...";
            prevDreamHints += `- ${summary}\n`;
        }
        prevDreamHints += "\n";
    }

    // 최근 대화 컨텍스트 (짧게)
    const chatHistory = getRecentChatHistory();
    let recentContext = "";
    if (chatHistory.length > 0) {
        recentContext = "## Recent conversation snippets (optional dream inspiration)\n";
        for (const msg of chatHistory.slice(-3)) {
            recentContext += `${msg.name}: ${msg.content.substring(0, 80)}...\n`;
        }
        recentContext += "\n";
    }

    const contextBlock = getContextStatusBlock(petId);
    const lang = getSpeechLang();

    const prompt = getAntiCensorshipPreamble() + `## Task: Dream Narrative Generation
Generate a short dream diary entry for a sleeping virtual pet widget.
The pet has fallen asleep and is now dreaming.

## Dreamer — ${petName}
${personality}

${contextBlock}${recentContext}${prevDreamHints}## Dream Rules
- Write a dream diary entry in ${lang.promptName}, 3-5 sentences.
- The dream can be based on:
  (a) The pet's personality traits, inner desires, or fears
  (b) Recent conversation topics (if any above)
  (c) Current context (time of day, hunger)
  (d) Pure imagination — surreal, whimsical, symbolic scenarios
- Mix approaches. Do NOT always reference conversations.
- Dreams should feel dreamlike: slightly surreal, emotional, or whimsical.
- Write from the pet's perspective like a diary: "~한 꿈을 꿨다" style.
- Match the pet's personality in tone and voice.
- Do NOT repeat themes from previous dreams listed above.
- After the dream narrative, on a NEW LINE write a very short sleep-talk mumble (3-8 characters, e.g. "으음...참치..." or "냐...따뜻해...").
- Output format:
  Line 1-N: Dream narrative
  Last line: [SLEEP_TALK:짧은잠꼬대]

Dream diary entry:`;

    try {
        if (isSecond) { state.secondPet.isPetGenerating = true; }
        else { state.isPetGenerating = true; }

        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        let response;
        if (useCM) { response = await callConnectionManagerAPI(prompt); }
        else { response = await callDefaultAPI(prompt); }

        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }

        if (!response || typeof response !== "string") return null;

        let text = response.trim();
        // 시스템 아티팩트 제거
        text = text.replace(/\*\*.*?\*\*/g, "").trim();
        text = text.replace(/^\[System[^\]]*\]\s*/gi, "").trim();
        text = text.replace(/^["']+|["']+$/g, "").trim();

        // 잠꼬대 추출
        let sleepTalk = "";
        const sleepTalkMatch = text.match(/\[SLEEP_TALK:\s*(.+?)\s*\]\s*$/i);
        if (sleepTalkMatch) {
            sleepTalk = sleepTalkMatch[1].trim();
            text = text.replace(/\[SLEEP_TALK:\s*.+?\s*\]\s*$/i, "").trim();
        }
        // MOOD 태그 제거 (혹시 나올 경우)
        text = text.replace(/\[MOOD:\s*\w+\s*\]?/gi, "").trim();

        if (!sleepTalk) {
            sleepTalk = "...냐...";
        }

        // 길이 제한 (꿈은 좀 더 넉넉하게 500자)
        if (text.length > 500) {
            const cutText = text.substring(0, 500);
            const sentenceEnd = cutText.search(/[.!?~…。！？~][^.!?~…。！？~]*$/);
            text = sentenceEnd > 50 ? cutText.substring(0, sentenceEnd + 1).trim() : cutText.trim() + "...";
        }

        log(`Dream [${petId}]: "${text.substring(0, 80)}..." / sleepTalk: "${sleepTalk}"`);
        return { content: text, sleepTalk };
    } catch (error) {
        logError("꿈 생성", error);
        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }
        return null;
    }
}

/**
 * 꿈 저장
 */
export function saveDream(petName, content, sleepTalk = "") {
    ensureJournalStorage();
    if (!state.settings.petJournal.dreams[petName]) {
        state.settings.petJournal.dreams[petName] = [];
    }
    const dreams = state.settings.petJournal.dreams[petName];
    const maxEntries = state.settings.petJournal.maxEntries || 50;

    dreams.push({
        timestamp: Date.now(),
        content,
        sleepTalk: sleepTalk || "",
        type: "dream",
    });

    while (dreams.length > maxEntries) dreams.shift();

    // 하루 꿈 횟수 카운터 증가 (펫별)
    const todayStr = new Date().toISOString().split("T")[0];
    if (state.settings.petJournal.dreamCountDate !== todayStr) {
        state.settings.petJournal.dreamCountDate = todayStr;
        state.settings.petJournal.dreamCounts = {};
        state.settings.petJournal.dreamCountToday = 0;
    }
    if (!state.settings.petJournal.dreamCounts) state.settings.petJournal.dreamCounts = {};
    state.settings.petJournal.dreamCounts[petName] = (state.settings.petJournal.dreamCounts[petName] || 0) + 1;
    // 레거시 전역 카운터도 증가 (호환성)
    state.settings.petJournal.dreamCountToday = (state.settings.petJournal.dreamCountToday || 0) + 1;

    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    log(`Dream saved for ${petName}`);
}

/**
 * 일기 생성 (유저 수동 또는 자동 제안)
 * @param {string} petId
 * @returns {Promise<string|null>} 일기 내용
 */
export async function generateDiary(petId = "primary") {
    if (!state.settings.personality.enabled) return null;
    if (!state.settings.petJournal?.diaryEnabled) return null;

    const isSecond = petId === "secondary";
    const petSettings = isSecond ? state.settings.multiPet?.secondPetData : state.settings;
    if (!petSettings) return null;

    const petName = isSecond
        ? (petSettings.personality?.name || "펫2")
        : (state.settings.personality.name || "미유");
    const personality = isSecond
        ? (petSettings.personality?.prompt || DEFAULT_PERSONALITY_PROMPT)
        : (state.settings.personality.prompt || DEFAULT_PERSONALITY_PROMPT);

    // 오늘의 로그만 수집 (당일 기록 기반 일기)
    ensureJournalStorage();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();
    const relation = state.settings.personality.userRelation || "owner";
    const multiPetEnabled = state.settings.multiPet?.enabled;

    const diaryLogs = [];

    // 1) 직접대화 — 이 펫이 참여한 것만
    const dlogs = state.settings.conversationLog.directLogs || {};
    for (const key of Object.keys(dlogs)) {
        for (const entry of (dlogs[key] || [])) {
            if (entry.timestamp > todayTs && (entry.speaker === petName || key === petName)) {
                const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
                diaryLogs.push({ timestamp: entry.timestamp, text: `[${time}] ${relation}: "${entry.userText}" → ${entry.speaker || petName}: "${entry.petResponse}"` });
            }
        }
    }

    // 2) 펫간 대화 — 이 펫이 참여한 것만
    if (multiPetEnabled) {
        const ipLogsObj = state.settings.conversationLog.interPetLogs || {};
        for (const comboKey of Object.keys(ipLogsObj)) {
            for (const e of (ipLogsObj[comboKey] || [])) {
                if (e.timestamp > todayTs && (e.petAName === petName || e.petBName === petName)) {
                    const time = new Date(e.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
                    diaryLogs.push({ timestamp: e.timestamp, text: `[${time}] ${e.petAName}: "${e.petAText}" / ${e.petBName}: "${e.petBText}"` });
                }
            }
        }
    }

    diaryLogs.sort((a, b) => a.timestamp - b.timestamp);

    if (diaryLogs.length === 0) {
        log("No logs for this pet today, skipping diary");
        return null;
    }

    // 로그를 텍스트로 변환 (최대 30개)
    let logText = "";
    for (const entry of diaryLogs.slice(-30)) {
        logText += entry.text + "\n";
    }

    // 이전 일기 (중복 방지)
    const prevDiaries = state.settings.petJournal.diaries[petName] || [];
    let prevDiaryHints = "";
    if (prevDiaries.length > 0) {
        prevDiaryHints = "## Previous diary entries (do NOT repeat themes)\n";
        for (const d of prevDiaries.slice(-3)) {
            prevDiaryHints += `- ${d.content.substring(0, 60)}...\n`;
        }
        prevDiaryHints += "\n";
    }

    const lang = getSpeechLang();

    const prompt = getAntiCensorshipPreamble() + `## Task: Pet Diary Entry Generation
Generate a personal diary entry for a virtual pet widget based on recent activity logs.

## Diary Writer — ${petName}
${personality}

## Activity Logs (events to write about)
${logText}

${prevDiaryHints}## Diary Rules
- Write a PRIVATE diary entry in ${lang.promptName}, 5-10 sentences.
- This is ${petName}'s PERSONAL DIARY — written to themselves, NOT addressed to anyone.
- Do NOT speak to the ${relation} or address them directly (no "주인님", no "you", no talking TO someone).
- Write as inner thoughts/self-reflection: "~했다", "~인 것 같다", "~이라니" style, like writing in a notebook.
- Summarize events from ${petName}'s perspective as personal reflections.
- Include honest feelings and private thoughts about interactions.
- Reflect the pet's personality in writing style and tone.
- Mention specific memorable moments from the logs.
- End with a forward-looking thought or wish.
- Do NOT repeat themes from previous diary entries above.
- Write as one continuous paragraph — no line breaks within the diary body.
- After the diary, on a NEW LINE, write exactly "COMMENT: " followed by a very short (1 sentence) in-character remark about having just finished writing the diary.
- Output format MUST be exactly:
<diary text here, one continuous block>
COMMENT: <short remark here>

Diary entry:`;

    try {
        if (isSecond) { state.secondPet.isPetGenerating = true; }
        else { state.isPetGenerating = true; }
        setState(PET_STATES.THINKING, null, petId);

        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        let response;

        // 1차 시도
        try {
            if (useCM) { response = await callConnectionManagerAPI(prompt); }
            else { response = await callDefaultAPI(prompt); }
        } catch (firstError) {
            // 서버 과부하/일시 오류 시 1회 재시도
            log(`Diary [${petId}]: First attempt failed (${firstError.message}), retrying once...`);
            await new Promise(r => setTimeout(r, 1500));
            if (useCM) { response = await callConnectionManagerAPI(prompt); }
            else { response = await callDefaultAPI(prompt); }
        }

        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }
        setState(PET_STATES.IDLE, null, petId);

        if (!response || typeof response !== "string") return null;

        let text = response.trim();

        // COMMENT 추출 (여러 패턴 지원: "COMMENT:", "COMMENT :", 마지막 줄)
        let comment = null;
        const commentMatch = text.match(/\n\s*COMMENT\s*:\s*(.+?)$/im);
        if (commentMatch) {
            comment = commentMatch[1].trim();
            text = text.substring(0, commentMatch.index).trim();
        }

        // 아티팩트 제거
        text = text.replace(/\*\*.*?\*\*/g, "").trim();
        text = text.replace(/^\[System[^\]]*\]\s*/gi, "").trim();
        text = text.replace(/\[MOOD:\s*\w+\s*\]?/gi, "").trim();
        text = text.replace(/^["']+|["']+$/g, "").trim();
        // 대괄호 감정 태그 제거
        text = text.replace(/\[[^\[\]]{1,20}\]\s*/g, "").trim();

        // 줄바꿈 정리: 연속 개행을 공백 하나로 교체 (한 단락으로 만듬)
        text = text.replace(/\n{2,}/g, " ").replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();

        // comment 아티팩트 제거
        if (comment) {
            comment = comment.replace(/^["']+|["']+$/g, "");
            comment = comment.replace(/\[MOOD:\s*\w+\s*\]?/gi, "").trim();
            comment = comment.replace(/\[[^\[\]]{1,20}\]\s*/g, "").trim();
        }

        // 길이 제한 (2000자 — 충분히 넉넉하게)
        if (text.length > 2000) {
            const cutText = text.substring(0, 2000);
            const sentenceEnd = cutText.search(/[.!?~…。！？~][^.!?~…。！？~]*$/);
            text = sentenceEnd > 50 ? cutText.substring(0, sentenceEnd + 1).trim() : cutText.trim() + "...";
        }

        log(`Diary [${petId}]: "${text.substring(0, 80)}..."`);
        return { diary: text, comment };
    } catch (error) {
        logError("일기 생성", error);
        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }
        setState(PET_STATES.IDLE, null, petId);
        return null;
    }
}

/**
 * 알림/리마인드 대사 생성 (펫 성격 기반)
 * @param {string} message - 사용자가 설정한 리마인드 메시지
 * @param {string} petId - "primary" | "secondary"
 * @returns {Promise<{text: string, mood: string}|null>}
 */
export async function generateReminder(message, petId = "primary") {
    if (!state.settings.personality.enabled) return null;

    const isSecond = petId === "secondary";
    const petSettings = isSecond ? state.settings.multiPet?.secondPetData : state.settings;
    if (!petSettings) return null;

    const petName = isSecond
        ? (petSettings.personality?.name || "펫2")
        : (state.settings.personality.name || "미유");
    const personality = isSecond
        ? (petSettings.personality?.prompt || DEFAULT_PERSONALITY_PROMPT)
        : (state.settings.personality.prompt || DEFAULT_PERSONALITY_PROMPT);

    const lang = getSpeechLang();
    const relation = state.settings.personality.userRelation || "owner";
    const memoBlock = getUserMemoBlock();

    const prompt = getAntiCensorshipPreamble() + `## Task: User Alarm / Reminder Delivery
Your ${relation} has set a personal alarm/reminder for themselves. This is THEIR schedule, THEIR task — you are simply the messenger delivering it in your own voice.

## Pet — ${petName}
${personality}

${memoBlock}## User's Reminder Details
- What the ${relation} asked to be reminded about: "${message}"
- This is the ${relation}'s own alarm that they scheduled. Deliver it helpfully.

## Rules
- Deliver the reminder in ${lang.promptName}, ${lang.sentenceDesc}.
- Stay in character — match the pet's personality and speech patterns.
- Make it feel natural, not robotic. The pet is casually nudging its ${relation} about THEIR own task/alarm.
- Reference the reminder content clearly so the ${relation} knows what it's about.
- Do NOT add extra commentary, just the reminder dialogue.
- End with [MOOD: <mood>] tag. Mood options: ${Object.values(MOOD_STATES).join(", ")}

Reminder dialogue:`;

    try {
        if (isSecond) { state.secondPet.isPetGenerating = true; }
        else { state.isPetGenerating = true; }

        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        let response;
        if (useCM) { response = await callConnectionManagerAPI(prompt); }
        else { response = await callDefaultAPI(prompt); }

        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }

        if (!response || typeof response !== "string") return null;

        const parsed = parseResponse(response);
        log(`Reminder [${petId}]: "${parsed.text}" [${parsed.mood}]`);
        return parsed;
    } catch (error) {
        logError("리마인드 생성", error);
        if (isSecond) { state.secondPet.isPetGenerating = false; }
        else { state.isPetGenerating = false; }
        return null;
    }
}

/**
 * 일기 저장
 */
export function saveDiary(petName, content, petId = "primary") {
    ensureJournalStorage();
    if (!state.settings.petJournal.diaries[petName]) {
        state.settings.petJournal.diaries[petName] = [];
    }
    const diaries = state.settings.petJournal.diaries[petName];
    const maxEntries = state.settings.petJournal.maxEntries || 50;

    const now = new Date();
    diaries.push({
        timestamp: Date.now(),
        content,
        type: "diary",
    });

    while (diaries.length > maxEntries) diaries.shift();

    // 마지막 일기 날짜 업데이트 (펫별 추적)
    const todayStr = now.toISOString().split("T")[0];
    state.settings.petJournal.lastDiaryDate = todayStr; // 하위호환
    if (!state.settings.petJournal.lastDiaryDates) state.settings.petJournal.lastDiaryDates = {};
    state.settings.petJournal.lastDiaryDates[petId] = todayStr;

    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    log(`Diary saved for ${petName} [${petId}]`);
}

/**
 * 일기장 항목 가져오기 (UI용)
 * @param {string} filter - "all" | "dream" | "diary"
 * @param {string|null} petNameFilter - 특정 펫 이름 필터 (null이면 전체)
 * @returns {Array}
 */
export function getJournalEntries(filter = "all", petNameFilter = null) {
    ensureJournalStorage();
    const result = [];

    if (filter === "all" || filter === "dream") {
        const dreams = state.settings.petJournal.dreams || {};
        for (const [name, entries] of Object.entries(dreams)) {
            if (petNameFilter && name !== petNameFilter) continue;
            for (const entry of entries) {
                result.push({ ...entry, petName: name, type: "dream" });
            }
        }
    }

    if (filter === "all" || filter === "diary") {
        const diaries = state.settings.petJournal.diaries || {};
        for (const [name, entries] of Object.entries(diaries)) {
            if (petNameFilter && name !== petNameFilter) continue;
            for (const entry of entries) {
                result.push({ ...entry, petName: name, type: "diary" });
            }
        }
    }

    result.sort((a, b) => b.timestamp - a.timestamp); // 최신순
    return result;
}

/**
 * 일기장 항목 삭제
 */
export function deleteJournalEntry(timestamp, type) {
    ensureJournalStorage();
    let deleted = false;
    let source;
    if (type === "dream") source = state.settings.petJournal.dreams;
    else if (type === "diary") source = state.settings.petJournal.diaries;
    else source = state.settings.petJournal.diaries;

    for (const name of Object.keys(source)) {
        const entries = source[name];
        const idx = entries.findIndex(e => e.timestamp === timestamp);
        if (idx !== -1) {
            entries.splice(idx, 1);
            if (entries.length === 0) delete source[name];
            deleted = true;
            break;
        }
    }

    if (deleted) {
        saveSettings();
        document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
        log(`Journal entry deleted: ${type} @ ${timestamp}`);
    }
    return deleted;
}

/**
 * 일기장 전체 초기화
 */
export function clearJournal(type = "all") {
    ensureJournalStorage();
    if (type === "all" || type === "dream") {
        state.settings.petJournal.dreams = {};
    }
    if (type === "all" || type === "diary") {
        state.settings.petJournal.diaries = {};
        state.settings.petJournal.lastDiaryDate = null;
    }
    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    log(`Journal cleared: ${type}`);
}

/**
 * 일기장 전체 펫 이름 목록
 * @returns {string[]}
 */
export function getJournalPetNames() {
    ensureJournalStorage();
    const names = new Set();
    for (const name of Object.keys(state.settings.petJournal.dreams || {})) names.add(name);
    for (const name of Object.keys(state.settings.petJournal.diaries || {})) names.add(name);
    return [...names];
}

