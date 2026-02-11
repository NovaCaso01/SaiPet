/**
 * SaiPet - AI 연동
 * 캐릭터 성격 + 유저 페르소나 + 채팅 기록을 읽어서 반응 생성
 */

import { extension_settings, getContext } from "../../../../extensions.js";
import { generateRaw } from "../../../../../script.js";
import { power_user } from "../../../../power-user.js";
import { state, log, logError } from "./state.js";
import { DEFAULT_PERSONALITY_PROMPT, MOOD_KEYWORDS, MOOD_STATES } from "./constants.js";
import { showSpeechBubble } from "./pet-speech.js";
import { setState, PET_STATES } from "./pet-animation.js";
import { saveSettings } from "./storage.js";

// 컨텍스트 프리앰블 (모든 API 호출에 적용)
const ANTI_CENSORSHIP_PREAMBLE = `## Task: Virtual Pet Dialogue Generation
You are generating short dialogue lines for a virtual pet widget — a small mascot character that lives on the user's desktop.
This pet reacts to the user's actions with brief, in-character spoken lines (1-2 sentences in Korean).
Your output is a single dialogue line followed by a mood tag. Nothing else is needed.

`;

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
            maxLogs: 100,
        };
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
function saveDirectLog(userText, petResponse, mood) {
    ensureLogStorage();
    const petName = getCurrentPetName();
    
    if (!state.settings.conversationLog.directLogs[petName]) {
        state.settings.conversationLog.directLogs[petName] = [];
    }
    
    const logs = state.settings.conversationLog.directLogs[petName];
    const maxLogs = state.settings.conversationLog.maxLogs || 100;
    
    logs.push({
        timestamp: Date.now(),
        userText,
        petResponse,
        mood,
        type: "direct",
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
function saveChatLog(petResponse, mood, trigger) {
    ensureLogStorage();
    const chatId = getCurrentChatId();
    if (!chatId) return;
    
    if (!state.settings.conversationLog.chatLogs[chatId]) {
        state.settings.conversationLog.chatLogs[chatId] = [];
    }
    
    const logs = state.settings.conversationLog.chatLogs[chatId];
    const maxLogs = state.settings.conversationLog.maxLogs || 100;
    
    logs.push({
        timestamp: Date.now(),
        petResponse,
        mood,
        trigger,
        type: "reaction",
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
function getPetLogsForPrompt(mode = "all") {
    ensureLogStorage();
    
    const petName = getCurrentPetName();
    const directLogs = state.settings.conversationLog.directLogs[petName] || [];
    
    if (mode === "direct") {
        // 직접 대화 전체 (시간순)
        if (directLogs.length === 0) return "";
        
        const relation = state.settings.personality.userRelation || "owner";
        let section = `## Your Conversation History with ${relation} (all direct talks)
IMPORTANT: These are past responses. Do NOT repeat or closely paraphrase any of them. Always say something new and different.
`;
        for (const entry of directLogs) {
            const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
            section += `[${time}] ${relation}: "${entry.userText}" → You: "${entry.petResponse}" [${entry.mood}]\n`;
        }
        return section + "\n";
    }
    
    // mode === "all": 직접대화 전체 + 채팅방 최근 5개
    const allLogs = [];
    allLogs.push(...directLogs);
    
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
        const petName = getCurrentPetName();
        state.settings.conversationLog.directLogs[petName] = [];
    }
    if (type === "all" || type === "chat") {
        state.settings.conversationLog.chatLogs = {};
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
        const petName = getCurrentPetName();
        const logs = state.settings.conversationLog.directLogs[petName];
        if (logs) {
            const idx = logs.findIndex(e => e.timestamp === timestamp);
            if (idx !== -1) {
                logs.splice(idx, 1);
                deleted = true;
            }
        }
    } else {
        // reaction — 모든 채팅방 로그에서 찾기
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
        const petName = getCurrentPetName();
        result.push(...(state.settings.conversationLog.directLogs[petName] || []));
    }
    
    if (type === "all" || type === "chat") {
        const chatId = getCurrentChatId();
        if (chatId && state.settings.conversationLog.chatLogs[chatId]) {
            result.push(...state.settings.conversationLog.chatLogs[chatId]);
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
export async function talkToPet(userText) {
    if (!state.settings.personality.enabled) return;
    
    try {
        state.isPetGenerating = true;
        setState(PET_STATES.THINKING);
        
        const { name, prompt: personalityPrompt } = state.settings.personality;
        const personality = personalityPrompt || DEFAULT_PERSONALITY_PROMPT;
        const userInfo = getUserPersona();
        
        const relationLabel = userInfo.relation;
        let userSection = `## Your ${relationLabel}\n- Name: ${userInfo.name}`;
        if (userInfo.description) {
            userSection += `\n- About: ${userInfo.description}`;
        }
        
        const petLogSection = getPetLogsForPrompt("direct");
        
        const talkPrompt = ANTI_CENSORSHIP_PREAMBLE + `You are ${name}, a virtual pet character living on your ${relationLabel}'s screen.
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
- Respond in Korean, 1-2 sentences. No single-word answers. No more than 3 sentences.
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
        if (useCM) {
            response = await callConnectionManagerAPI(talkPrompt);
        } else {
            response = await callDefaultAPI(talkPrompt);
        }
        
        const result = parseResponse(response);
        log(`Talk response: [${result.mood}] ${result.text}`);
        
        if (result.text) {
            setState(result.mood, 5000);
            showSpeechBubble(result.text, 5000, true);
            saveDirectLog(userText, result.text, result.mood);
        } else {
            const msg = state.settings.fallbackMessages?.noResponse || "...뭐라고?";
            setState(PET_STATES.HAPPY, 2000);
            showSpeechBubble(msg, 2000, true);
        }
    } catch (error) {
        logError("talkToPet error:", error);
        const msg = state.settings.fallbackMessages?.apiError || "...잘 안 들렸어.";
        setState(PET_STATES.HAPPY, 2000);
        showSpeechBubble(msg, 2000, true);
    } finally {
        state.isPetGenerating = false;
    }
}

/**
 * AI로 펫 반응 생성 (캐릭터+페르소나+채팅기록 기반)
 * @returns {Promise<{text: string, mood: string}|null>}
 */
export async function generatePetReaction() {
    if (!state.settings.personality.enabled) {
        log("AI disabled, skipping reaction");
        return null;
    }
    
    try {
        log("Building prompt...");
        let prompt = buildPrompt();
        
        // 월드인포 섹션 주입 (토글 ON일 때)
        if (prompt.includes("{{WORLD_INFO}}")) {
            const wiSection = await getWorldInfoSection();
            prompt = prompt.replace("{{WORLD_INFO}}", wiSection);
        }
        
        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        
        // 펫 자체 API 호출 플래그 설정
        state.isPetGenerating = true;
        setState(PET_STATES.THINKING);
        
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
            state.isPetGenerating = false;
        }
        
        return result;
    } catch (error) {
        logError("Failed to generate pet reaction:", error);
        state.isPetGenerating = false;
        return null;
    }
}

/**
 * 프롬프트 생성 (반응 모드에 따라 분기)
 * @returns {string}
 */
function buildPrompt() {
    const mode = state.settings.api.reactionMode || "observer";
    if (mode === "character") {
        return buildCharacterPrompt();
    }
    return buildObserverPrompt();
}

/**
 * 공통 섹션 생성 함수들
 */
function getCommonSections() {
    const { name, prompt } = state.settings.personality;
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
function getPetLogSection() {
    return getPetLogsForPrompt("all");
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
function buildObserverPrompt() {
    const { name, personalityPrompt, characterSection, userSection, chatSection } = getCommonSections();
    const petLogSection = getPetLogSection();

    return ANTI_CENSORSHIP_PREAMBLE + `You are "${name}", a virtual pet character.
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
- Write in Korean, 1-2 sentences long. Single-word responses (e.g. "\ud765", "\ubb50\uc57c") are forbidden. More than 3 sentences is also forbidden.
- Stay in character — maintain your personality and speech patterns.- You are a THIRD-PARTY OBSERVER. Never speak as if you are the AI character. Always treat the conversation as something you are watching, not participating in.- NEVER repeat a previous response from the activity log. Always say something different and fresh.- Output ONLY the dialogue text. No quotes, labels, explanations, parenthetical actions, or prefixes.
- At the very end of your dialogue, append a mood tag: [MOOD:xxx]
  Valid moods: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking

Output format: 대사 텍스트 [MOOD:happy]

I understand. Dialogue with mood tag:`;
}

/**
 * 캐릭터 모드 (속마음/내면 독백) 프롬프트
 * @returns {string}
 */
function buildCharacterPrompt() {
    const { name, personalityPrompt, characterSection, userSection, chatSection } = getCommonSections();
    const petLogSection = getPetLogSection();

    return ANTI_CENSORSHIP_PREAMBLE + `You are "${name}". You ARE the character currently chatting with the user.
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
- Write in Korean, 1-2 sentences long. Single-word responses are forbidden. More than 3 sentences is also forbidden.
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
    
    // thinking 모드 감안, 넉넉하게 2000 토큰 보장
    const maxTokens = Math.max(state.settings.api.maxTokens || 2000, 2000);
    
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
        responseLength: 150,
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
 * @returns {Promise<boolean>} - 성공 여부
 */
export async function showAIReaction() {
    try {
        const result = await generatePetReaction();
        
        if (result && result.text) {
            setState(result.mood, 4000);
            showSpeechBubble(result.text, null, true);
            saveChatLog(result.text, result.mood, "aiResponse");
            log(`AI Reaction: [${result.mood}] ${result.text}`);
            return true;
        }
        
        log("AI response empty, skipping reaction");
        return false;
    } catch (error) {
        logError("showAIReaction error:", error);
        return false;
    }
}

/**
 * 자발적 말걸기 (펫이 스스로 말을 검)
 * @param {Object} context - { hunger, hour, minutesSinceInteraction }
 */
export async function generateSpontaneousSpeech({ hunger, hour, minutesSinceInteraction }) {
    if (!state.settings.personality.enabled) return;
    if (state.isPetGenerating || state.isGenerating) return;
    
    try {
        state.isPetGenerating = true;
        setState(PET_STATES.THINKING);
        
        const { name, prompt } = state.settings.personality;
        const personality = prompt || DEFAULT_PERSONALITY_PROMPT;
        const userInfo = getUserPersona();
        const petLogSection = getPetLogsForPrompt("direct");
        
        // 상황 묘사
        const timeDesc = hour >= 0 && hour <= 5 ? "새벽" :
                         hour >= 6 && hour <= 10 ? "아침" :
                         hour >= 11 && hour <= 13 ? "점심" :
                         hour >= 14 && hour <= 17 ? "오후" :
                         hour >= 18 && hour <= 21 ? "저녁" : "밤";
        
        const hungerDesc = hunger <= 10 ? "매우 배고프다 (거의 굶고 있음)" :
                           hunger <= 30 ? "배가 꽤 고프다" :
                           hunger <= 60 ? "약간 허기가 있다" : "배부르다";
        
        const idleDesc = minutesSinceInteraction <= 1 ? "방금 대화했다" :
                         minutesSinceInteraction <= 5 ? "잠시 전에 대화했다" :
                         minutesSinceInteraction <= 15 ? "한동안 조용하다" :
                         minutesSinceInteraction <= 30 ? "꽤 오래 아무 일도 없었다" :
                         "아주 오랫동안 혼자 있었다";
        
        const spontaneousPrompt = ANTI_CENSORSHIP_PREAMBLE + `You are "${name}", a virtual pet character living on your ${userInfo.relation}'s screen.

## Trigger Event
[System notification] The pet has been idle for a few minutes.
Generate the pet's reaction to this idle timeout event.

## About You
You are a small virtual pet widget — a desktop companion.
You have your own personality, moods, hunger level, and sense of time.
You notice when your ${userInfo.relation} has been away, and you react to the time of day and your physical state.

## Character Voice Reference (tone & speech patterns only)
${personality}

Note: Use the above as reference for your speech style and tone only. Your comment must stay on an everyday topic.

## Your ${userInfo.relation}
- Name: ${userInfo.name}
${userInfo.description ? `- About: ${userInfo.description}` : ""}

${petLogSection}## Current Situation
- Time: ${timeDesc} (${hour}시)
- Hunger: ${hungerDesc} (${hunger}/100)
- Interaction: ${idleDesc} (마지막 상호작용 ${minutesSinceInteraction}분 전)

## Instructions
Generate a short, casual comment. The topic MUST be one of these everyday subjects:
- Your hunger level or wanting food/snacks
- The time of day, weather, or sleepiness
- Being bored or wanting attention from your ${userInfo.relation}
- A random cute or funny thought about daily life
- Commenting on how long it's been since you last talked
- Stretching, yawning, or other idle actions

Express your unique character through your TONE and SPEECH PATTERNS (the way you talk), not through the topic itself.
Keep the topic lighthearted and everyday.

Rules:
- Korean, 1-2 sentences. No single-word responses. Max 3 sentences.
- Stay in character voice. Be natural — don't feel forced.
- NEVER repeat a previous response from the activity log. Always say something different.
- Output ONLY the dialogue. No quotes, labels, explanations, or actions.
- Append mood tag: [MOOD:xxx]
  Valid: happy, sad, excited, surprised, nervous, confident, shy, angry, thinking, idle, sleeping

Example outputs:
- 배고파... 밥 언제 주는 거야, 진짜. [MOOD:sad]
- 이 시간까지 뭐 하는 거야? 나도 졸린데. [MOOD:nervous]
- 흥, 심심하다고 말한 거 아니거든. 그냥 하품 난 거야. [MOOD:idle]
- 아무도 없나... 나 여기 있거든? 무시하지 마. [MOOD:sad]
- 오늘 뭐 먹지... 아, 나는 밥이나 줘. [MOOD:thinking]

I understand. Dialogue with mood tag:`;

        const useCM = state.settings.api.useConnectionManager && state.settings.api.connectionProfile;
        
        let response;
        if (useCM) {
            response = await callConnectionManagerAPI(spontaneousPrompt);
        } else {
            response = await callDefaultAPI(spontaneousPrompt);
        }
        
        const result = parseResponse(response);
        log(`Spontaneous speech: [${result.mood}] ${result.text}`);
        
        if (result.text) {
            setState(result.mood, 5000);
            showSpeechBubble(result.text, null, true);
            saveChatLog(result.text, result.mood, "spontaneous");
        }
    } catch (error) {
        logError("generateSpontaneousSpeech error:", error);
    } finally {
        state.isPetGenerating = false;
    }
}
