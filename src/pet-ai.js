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
 * 펫 대화 로그를 프롬프트용 텍스트로 변환
 * @param {string} mode - "all" (직접대화 전체 + 채팅방 최근 5개) | "direct" (직접대화 전체만)
 * @returns {string}
 */
function getPetLogsForPrompt(mode = "all", petId = "primary") {
    ensureLogStorage();
    
    const petName = petId === "secondary"
        ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
        : getCurrentPetName();
    
    // 듀얼 모드 여부 판단
    const multiPetEnabled = state.settings.multiPet?.enabled;
    const dualTalk = multiPetEnabled && state.settings.multiPet?.dualDirectTalk && state.settings.multiPet?.secondPetData;
    
    // 직접대화 로그: 듀얼이면 조합키, 아니면 단일키
    let directLogKey;
    if (dualTalk) {
        const petAName = getCurrentPetName();
        const petBName = state.settings.multiPet?.secondPetData?.personality?.name || "펫2";
        directLogKey = getInterPetKey(petAName, petBName);
    } else {
        directLogKey = petName;
    }
    const directLogs = state.settings.conversationLog.directLogs[directLogKey] || [];
    
    if (mode === "direct") {
        // 직접 대화 전체 (시간순)
        if (directLogs.length === 0) return "";
        
        const relation = state.settings.personality.userRelation || "owner";
        let section = `## Your Conversation History with ${relation} (all direct talks)
IMPORTANT: These are past responses. Do NOT repeat or closely paraphrase any of them. Always say something new and different.
`;
        for (const entry of directLogs) {
            const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
            const speaker = entry.speaker || petName;
            section += `[${time}] ${relation}: "${entry.userText}" → ${speaker}: "${entry.petResponse}" [${entry.mood}]\n`;
        }
        return section + "\n";
    }
    
    // mode === "all": 직접대화 전체 + 채팅방 최근 5개
    const allLogs = [];
    allLogs.push(...directLogs);
    
    // 멀티펫 켜져있으면 펫 간 대화 로그도 포함
    if (multiPetEnabled) {
        const petAName = state.settings.personality.name || "미유";
        const petBName = state.settings.multiPet?.secondPetData?.personality?.name || "펫2";
        const comboKey = getInterPetKey(petAName, petBName);
        const interPetLogs = state.settings.conversationLog.interPetLogs?.[comboKey] || [];
        const recentInter = interPetLogs.slice(-5).map(e => ({
            timestamp: e.timestamp,
            petResponse: `${e.petAName}: "${e.petAText}" / ${e.petBName}: "${e.petBText}"`,
            mood: e.petAMood,
            trigger: "interPet",
            type: "reaction",
        }));
        allLogs.push(...recentInter);
    }
    
    const chatId = getCurrentChatId();
    if (chatId && state.settings.conversationLog.chatLogs[chatId]) {
        const chatLogs = state.settings.conversationLog.chatLogs[chatId];
        allLogs.push(...chatLogs.slice(-5));
    }
    
    if (allLogs.length === 0) return "";
    
    allLogs.sort((a, b) => a.timestamp - b.timestamp);
    
    const relation = state.settings.personality.userRelation || "owner";
    let section = `## Your Activity Log (conversation history with ${relation} + recent reactions)
IMPORTANT: These are your past responses. Do NOT repeat or closely paraphrase any of them. Always come up with something fresh.
`;
    for (const entry of allLogs) {
        const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
        if (entry.type === "direct") {
            section += `[${time}] ${relation} said: "${entry.userText}" → You replied: "${entry.petResponse}" [${entry.mood}]\n`;
        } else {
            section += `[${time}] You reacted (${entry.trigger}): "${entry.petResponse}" [${entry.mood}]\n`;
        }
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
    
    if (type === "direct") {
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
            
            const lang = getSpeechLang();
            const dualPrompt = getAntiCensorshipPreambleMulti() + `## Trigger Event: User Input Received
The user sent a message to Widget A (${petName}). Widget B (${otherPetName}) also displays a status update.

## Widget A Profile — ${petName}
${personality}

## Widget B Profile — ${otherPetName}
${otherPersonality}

${userSection}

${petLogSection}## User Input (directed at Widget A)
"${userText}"

## Output Requirements
- Widget A: Generate a notification text responding to the user's input. ${lang.promptName}, 1-2 sentences. Max 3 sentences.
- Widget B: Generate an independent status text. Widget B is aware of the input but responds from its own perspective. ${lang.promptName}, 1-2 sentences. Max 3 sentences.
- Each widget has its own distinct profile. Reflect the personality described in each profile.
- Do NOT repeat any text from the notification history above.
- Output ONLY the notification texts. No explanations, labels, quotes, or actions.
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

${petLogSection}## ${relationLabel}'s message to you
"${userText}"

## Response rules
- Respond in ${lang.promptName}, 1-2 sentences. No single-word answers. No more than 3 sentences.
- Stay in character — react naturally based on your personality.
- Consider your mood, your relationship, and the context of what they said.
- NEVER repeat a previous response from the conversation history. Always say something different.
- Output ONLY the dialogue. No quotes, labels, explanations, or action descriptions.
- Append a mood tag at the very end: [MOOD:xxx]
  Valid moods: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Example outputs:
- 왜 불러, 할 일 없어? ...옆에 있어줄게. [MOOD:shy]
- 뭐야 갑자기, 놀랐잖아! 다음엔 미리 말해. [MOOD:surprised]
- 흥, 그런 말 해봤자 안 통한다고. ...근데 고마워. [MOOD:happy]

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
            } else {
                setState(PET_STATES.HAPPY, bubbleDuration, petId);
                showSpeechBubble(fallback.noResponse || "...뭐라고?", null, true, petId);
            }
        }
    } catch (error) {
        logError("talkToPet error:", error);
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
        return; // finally에서 중복 해제 방지
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
        logError("Failed to generate pet reaction:", error);
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
        logError("getWorldInfoSection error:", error);
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
${petLogSection}${chatSection}
## Instructions
React to the chat above as "${name}".
As an observer, freely express your impressions, commentary, analysis, quips, surprise, empathy, or reactions to the conversation — especially the [LATEST MESSAGE].

Rules:
- Write in ${lang.promptName}, ${lang.sentenceDesc}. Single-word responses (e.g. "\ud765", "\ubb50\uc57c") are forbidden. More than 3 sentences is also forbidden.
- Stay in character — maintain your personality and speech patterns.
- You are a THIRD-PARTY OBSERVER. Never speak as if you are the AI character. Always treat the conversation as something you are watching, not participating in.
- NEVER repeat a previous response from the activity log. Always say something different and fresh.
- Output ONLY the dialogue text. No quotes, labels, explanations, parenthetical actions, or prefixes.
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
${petLogSection}${chatSection}
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
- Output ONLY the dialogue text. No quotes, labels, explanations, parenthetical actions, or prefixes.
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
    
    // thinking 모드 감안, 넉넉하게 3000 토큰 보장
    const maxTokens = Math.max(state.settings.api.maxTokens || 3000, 3000);
    
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
        logError(`ConnectionManager error: ${error.message}`);
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
    text = text.replace(/\*\*.*?\*\*/g, "").trim();           // **Roleplay Mode Engaged.** 등
    text = text.replace(/^\[시스템[^\]]*\]\s*/gi, "").trim(); // [시스템 알림] 등
    text = text.replace(/^\[System[^\]]*\]\s*/gi, "").trim(); // [System ...] 등
    text = text.replace(/^(System|시스템):\s*/gi, "").trim();   // System: ... 등
    text = text.replace(/^Roleplay Mode.*$/gim, "").trim();    // Roleplay Mode 줄
    
    // 5단계: 기타 잔여 태그/따옴표 정리
    text = text.replace(/^\[\w+\]\s*/g, "").trim();
    text = text.replace(/^\[[^\]]*$/g, "").trim();
    text = text.replace(/^["'*]+|["'*]+$/g, "").trim();
    
    // 6단계: 너무 길면 자르기
    if (text.length > 150) {
        text = text.substring(0, 147) + "...";
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
        logError("showAIReaction error:", error);
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
        logSection = "## Previous conversations between you two\nIMPORTANT: Do NOT repeat these topics. Always say something new.\n";
        for (const e of interLogs.slice(-8)) {
            logSection += `${e.petAName}: "${e.petAText}" / ${e.petBName}: "${e.petBText}"\n`;
        }
        logSection += "\n";
    }
    
    const lang = getSpeechLang();
    const prompt = getAntiCensorshipPreambleMulti() + `## Trigger Event: Periodic Status Update
Both widgets are idle. Generate a paired status notification — each widget displays a short text reflecting its own perspective.
The two widgets are aware of each other and their texts may relate to each other naturally.

## Widget A Profile — ${firstName}
${firstPersonality}

## Widget B Profile — ${secondName}
${secondPersonality}

${logSection}## Output Requirements
- Generate 2 notification texts — one per widget. ${lang.promptName}, ${lang.sentenceDesc} each.
- Topics can be anything: idle observations, casual remarks, reactions to each other, random thoughts, etc.
- Each widget's text should reflect the personality described in its profile.
- Do NOT repeat topics from the notification history above. Always generate fresh content.
- Output ONLY the notification texts. No explanations, labels, quotes, or actions.
- Append a mood indicator at the end of each line.
  Valid indicators: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Output format:
${firstName}: 텍스트 [MOOD:xxx]
${secondName}: 텍스트 [MOOD:yyy]

Widget notifications:`;
    
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
        logError("generateInterPetDialogue error:", error);
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
    }
    
    return true;
}


