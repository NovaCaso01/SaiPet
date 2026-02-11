/**
 * SaiPet - 반응 트리거 관리
 */

import { eventSource, event_types } from "../../../../../script.js";
import { getContext } from "../../../../extensions.js";
import { state, log, logError } from "./state.js";
import { saveSettings } from "./storage.js";
import { setState, PET_STATES, playBounce, playShake, playHearts, showSleepZzz, hideSleepZzz } from "./pet-animation.js";
import { showStateSpeech, showSpeechBubble } from "./pet-speech.js";
import { showAIReaction } from "./pet-ai.js";

/**
 * 이벤트 리스너 등록
 */
export function initReactions() {
    // 유저 메시지 전송
    eventSource.on(event_types.MESSAGE_SENT, onUserMessage);
    
    // AI 응답 시작
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStart);
    
    // AI 응답 완료
    eventSource.on(event_types.MESSAGE_RECEIVED, onAIResponse);
    
    // AI 응답 종료 (에러 포함)
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnd);
    
    // 채팅방 진입 시 인사
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    
    // 초기 로딩 쿨다운: 채팅방 진입 시 다른 확장들이 발생시키는 이벤트 무시
    state.isReady = false;
    setTimeout(() => {
        state.isReady = true;
        log("Reactions ready (startup cooldown ended)");
    }, 5000);
    
    // 인사는 즉시 표시 (AI 호출 없이 커스텀 대사)
    setTimeout(() => {
        triggerEntryGreeting();
    }, 500);
    
    // Idle 타이머 시작
    startIdleTimer();
    
    // 컨디션 시스템 시작 (배고픔 감소 등)
    startConditionTimer();
    
    // 자발적 말걸기 타이머
    startSpontaneousTimer();
    
    log("Reactions initialized");
}

/**
 * 이벤트 리스너 해제
 */
export function destroyReactions() {
    eventSource.off(event_types.MESSAGE_SENT, onUserMessage);
    eventSource.off(event_types.GENERATION_STARTED, onGenerationStart);
    eventSource.off(event_types.MESSAGE_RECEIVED, onAIResponse);
    eventSource.off(event_types.GENERATION_ENDED, onGenerationEnd);
    eventSource.off(event_types.CHAT_CHANGED, onChatChanged);
    
    stopIdleTimer();
    stopConditionTimer();
    stopSpontaneousTimer();
    
    log("Reactions destroyed");
}

/**
 * 유저 메시지 전송 시
 */
function onUserMessage() {
    if (!state.isReady) return;
    if (state.isPetGenerating) return;
    
    resetIdleTimer();
    triggerReaction("userMessage");
}

/**
 * AI 응답 생성 시작
 * SillyTavern emit 시그니처: (type, options, dryRun)
 * type: 'normal', 'regenerate', 'swipe', 'impersonate', 'quiet' 등
 * dryRun: true면 프롬프트 조립만 (실제 생성 아님)
 */
function onGenerationStart(type, _options, dryRun) {
    if (!state.isReady) return;
    if (state.isPetGenerating) return;
    
    // dry run이면 무시 (다른 확장의 프롬프트 계산, 메시지 삭제 등)
    if (dryRun) return;
    
    // quiet 생성이면 무시 (펫 자체 API 호출 등)
    if (type === "quiet") return;
    
    state.isGenerating = true;
    resetIdleTimer();
    log(`Generation started: type=${type}`);
}

/**
 * AI 응답 완료 시
 * @param {number} messageId 
 */
let messageCounter = 0;

function onAIResponse(messageId) {
    if (!state.isReady) return;
    if (state.isPetGenerating) return;
    if (greetingCooldown) return; // 인사 직후 다른 확장의 AI 반응 무시
    
    log("onAIResponse triggered, messageId:", messageId);
    
    resetIdleTimer();
    
    // 반응 간격 체크 (N번째 메시지마다 반응)
    messageCounter++;
    const interval = state.settings.reactions.reactionInterval || 3;
    if (messageCounter < interval) {
        log(`Skipping reaction (${messageCounter}/${interval})`);
        return;
    }
    messageCounter = 0;
    
    triggerReaction("aiResponse");
}

/**
 * AI 응답 종료 (스톱/에러 포함)
 */
function onGenerationEnd() {
    if (!state.isReady) return;
    if (state.isPetGenerating) return;
    
    state.isGenerating = false;
    
    if (state.currentState === PET_STATES.THINKING) {
        setState(PET_STATES.IDLE);
        log("Generation ended, reset to idle");
    }
}

/**
 * 채팅방 변경 시 (새 채팅방 진입)
 */
function onChatChanged() {
    if (!state.isReady) return;
    log("Chat changed");
    
    // 채팅방 이동 시에는 인사 없이 idle 타이머만 리셋
    resetIdleTimer();
}

/**
 * 채팅방 진입 인사 (오래 비움 감지 + 새 채팅 + 시간대 인사)
 */
let greetingCooldown = false;

function triggerEntryGreeting() {
    const now = Date.now();
    const hour = new Date().getHours();
    
    // 인사 후 다른 확장의 generation 이벤트 무시용 쿨다운 (5초)
    greetingCooldown = true;
    setTimeout(() => { greetingCooldown = false; }, 5000);
    
    // 1. 오랜만에 접속 체크 (24시간 이상)
    const lastVisit = state.settings.condition?.lastVisit;
    if (lastVisit && (now - lastVisit) > 86400000) {
        log(`Long absence detected: ${Math.round((now - lastVisit) / 60000)} min`);
        state.settings.condition.lastVisit = now;
        saveSettings();
        triggerReaction("longAbsence");
        return;
    }
    
    // 방문 시간 기록
    if (!state.settings.condition) {
        state.settings.condition = { hunger: 100, lastFed: null, lastVisit: now };
    }
    state.settings.condition.lastVisit = now;
    saveSettings();
    
    // 2. AI 채팅방 진입 체크 (캐릭터가 선택되어 있는 경우에만)
    const context = getContext();
    const hasCharacter = context?.characterId !== undefined && context?.characterId !== null;
    
    // 3. 시간대별 인사 (ST 처음 접속 시 1회만)
    if (!state.hasShownTimeGreeting) {
        state.hasShownTimeGreeting = true;
        if (hour >= 0 && hour <= 6) {
            triggerReaction("latenight");
        } else if (hour >= 7 && hour <= 10) {
            triggerReaction("morning");
        } else {
            triggerReaction("greeting");
        }
        return;
    }
    
    // 4. 이미 시간 인사 했고, AI 채팅방이면 일반 인사
    if (hasCharacter) {
        triggerReaction("greeting");
    }
}

/**
 * 반응 트리거
 * @param {string} triggerType - 트리거 종류
 */
export async function triggerReaction(triggerType) {
    log(`Trigger: ${triggerType}`);
    
    // sleeping 이외의 트리거면 zzz 이펙트 제거
    if (triggerType !== "sleeping" && triggerType !== "idle") {
        hideSleepZzz();
    }
    
    // === 배고픔 패널티 체크 ===
    const hunger = state.settings.condition?.hunger ?? 100;
    const isStarving = hunger <= 10;
    const isHungry = hunger <= 30;
    
    // 배고프면 상호작용 무시 (50% 확률, 밥주기/배고픔 트리거는 예외)
    if (isStarving && !["feeding", "hungry", "dragging"].includes(triggerType)) {
        if (["click", "petting", "clickSpam"].includes(triggerType) && Math.random() < 0.5) {
            showStateSpeech("hungry");
            setState(PET_STATES.SAD, 2000);
            log(`Hunger penalty: ignored ${triggerType} (starving)`);
            return;
        }
    }
    
    // 기본 상태 및 컨텍스트 결정
    let defaultMood = PET_STATES.IDLE;
    let speechType = "idle"; // idle, sleeping, interaction 중 하나 (커스텀 대사용)
    
    switch (triggerType) {
        case "userMessage":
            // 유저 메시지 전송 시: 바운스 (thinking은 GENERATION_STARTED에서 지연 처리)
            playBounce();
            return;
            
        case "aiResponse":
            // AI 응답 시: 채팅 읽고 성격 기반 반응 생성 (CM API 1회 호출)
            defaultMood = PET_STATES.HAPPY;
            playBounce();
            
            if (state.settings.personality.enabled) {
                await showAIReaction();
            }
            
            // thinking에 걸리지 않도록 보장
            if (state.currentState === PET_STATES.THINKING) {
                setState(defaultMood, 2000);
            }
            return;
            
        case "idle":
            // 대기 시간 초과 (4분): 대기중 대사
            defaultMood = PET_STATES.IDLE;
            speechType = "idle";
            break;

        case "sleeping":
            // 장기 대기 (10분): 잠자기 대사 + zzZ
            defaultMood = PET_STATES.SLEEPING;
            speechType = "sleeping";
            showSleepZzz();
            break;
            
        case "dragging":
            // 드래그 시: 드래그 대사 (드래그 끝날 때까지 유지)
            defaultMood = PET_STATES.DRAGGING;
            speechType = "dragging";
            setState(defaultMood, null); // 영구 - onDragEnd에서 idle로 복귀
            showStateSpeech(speechType);
            return;
        
        case "click":
            // 클릭 시: 클릭 대사
            defaultMood = PET_STATES.HAPPY;
            speechType = "click";
            playBounce();
            break;
        
        case "clickSpam":
            // 연속 클릭 (5회+): 짜증 반응
            defaultMood = PET_STATES.ANGRY;
            speechType = "clickSpam";
            playShake();
            break;
        
        case "petting":
            // 쓰다듬기 (길게 클릭/홀드)
            defaultMood = PET_STATES.SHY;
            speechType = "petting";
            playBounce();
            playHearts();
            break;
        
        case "greeting":
            // 인사
            defaultMood = PET_STATES.HAPPY;
            speechType = "greeting";
            playBounce();
            break;
        
        case "latenight":
            // 심야 인사
            defaultMood = PET_STATES.IDLE;
            speechType = "latenight";
            break;
        
        case "morning":
            // 아침 인사
            defaultMood = PET_STATES.SLEEPING;
            speechType = "morning";
            break;
        
        case "longAbsence":
            // 오랜만에 접속
            defaultMood = PET_STATES.SURPRISED;
            speechType = "longAbsence";
            playShake();
            break;
        
        case "feeding":
            // 밥주기
            defaultMood = PET_STATES.HAPPY;
            speechType = "feeding";
            playBounce();
            break;
        
        case "hungry":
            // 배고픔 알림
            defaultMood = PET_STATES.SAD;
            speechType = "hungry";
            break;
            
        default:
            defaultMood = PET_STATES.IDLE;
            speechType = "idle";
    }
    
    // 커스텀 대사 표시 (idle, sleeping, interaction만)
    // 배고픔 패널티: idle 상태에서 배고프면 대사 변경 (sleeping은 유지)
    if (isHungry && speechType === "idle") {
        speechType = "hungry";
        defaultMood = PET_STATES.SAD;
    }
    setState(defaultMood, triggerType === "idle" || triggerType === "sleeping" ? null : 2000);
    showStateSpeech(speechType);
}

/**
 * Idle 타이머 시작
 */
function startIdleTimer() {
    if (!state.settings.reactions.onIdle) return;
    
    const idleTimeout = (state.settings.reactions.idleTimeout || 240) * 1000;
    const sleepTimeout = (state.settings.reactions.sleepTimeout || 600) * 1000;
    
    state.idleTimer = setTimeout(() => {
        if (!state.isGenerating && !state.isPetGenerating) {
            triggerReaction("idle");
        }
    }, idleTimeout);
    
    state.sleepTimer = setTimeout(() => {
        if (!state.isGenerating && !state.isPetGenerating) {
            triggerReaction("sleeping");
        }
    }, sleepTimeout);
}

/**
 * Idle 타이머 리셋
 */
function resetIdleTimer() {
    stopIdleTimer();
    startIdleTimer();
    state._lastInteractionTime = Date.now();
}

/**
 * Idle 타이머 중지
 */
function stopIdleTimer() {
    if (state.idleTimer) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
    }
    if (state.sleepTimer) {
        clearTimeout(state.sleepTimer);
        state.sleepTimer = null;
    }
}

// ===== 컨디션 시스템 =====

let conditionTimer = null;
const CONDITION_INTERVAL = 5 * 60 * 1000; // 5분마다 체크
const HUNGER_DECAY_PER_CHECK = 3;          // 5분마다 배고픔 -3 (약 2.7시간에 0)
const HUNGER_WARNING = 30;                  // 이 이하면 배고픔 알림
let hungryNotified = false;                 // 배고픔 알림 중복 방지

/**
 * 컨디션 타이머 시작
 */
function startConditionTimer() {
    // 초기화 안 됐으면 기본값 설정
    if (!state.settings.condition) {
        state.settings.condition = { hunger: 100, lastFed: null, lastVisit: Date.now() };
        saveSettings();
    }
    
    // 오프라인 동안의 배고픔 감소 계산
    const lastVisit = state.settings.condition.lastVisit;
    if (lastVisit) {
        const elapsed = Date.now() - lastVisit;
        const missedChecks = Math.floor(elapsed / CONDITION_INTERVAL);
        if (missedChecks > 0) {
            state.settings.condition.hunger = Math.max(0, state.settings.condition.hunger - (missedChecks * HUNGER_DECAY_PER_CHECK));
            log(`Offline hunger decay: -${missedChecks * HUNGER_DECAY_PER_CHECK}, now ${state.settings.condition.hunger}`);
            saveSettings();
        }
    }
    
    conditionTimer = setInterval(() => {
        updateCondition();
    }, CONDITION_INTERVAL);
    
    log(`Condition system started, hunger: ${state.settings.condition.hunger}`);
}

/**
 * 컨디션 타이머 중지
 */
function stopConditionTimer() {
    if (conditionTimer) {
        clearInterval(conditionTimer);
        conditionTimer = null;
    }
}

/**
 * 컨디션 업데이트 (5분마다)
 */
function updateCondition() {
    if (!state.settings.condition) return;
    
    // 배고픔 감소
    state.settings.condition.hunger = Math.max(0, state.settings.condition.hunger - HUNGER_DECAY_PER_CHECK);
    state.settings.condition.lastVisit = Date.now();
    saveSettings();
    
    log(`Condition update: hunger=${state.settings.condition.hunger}`);
    
    // 배고픔 알림 (30 이하, 생성중 아닐 때)
    if (state.settings.condition.hunger <= HUNGER_WARNING && !hungryNotified && !state.isGenerating && !state.isPetGenerating) {
        hungryNotified = true;
        triggerReaction("hungry");
    }
    
    // 배고픔 회복되면 알림 리셋
    if (state.settings.condition.hunger > HUNGER_WARNING) {
        hungryNotified = false;
    }
    
    // 펫 컨테이너의 배고픔 게이지 업데이트
    updateHungerGauge();
}

/**
 * 배고픔 게이지 UI 업데이트
 */
function updateHungerGauge() {
    const gauge = document.querySelector(".st-pet-hunger-fill");
    if (gauge) {
        const hunger = state.settings.condition?.hunger ?? 100;
        gauge.style.width = `${hunger}%`;
        
        // 색상 변경 (반투명, 차분한 계열)
        if (hunger <= 20) {
            gauge.style.backgroundColor = "rgba(190, 100, 100, 0.65)";
        } else if (hunger <= 50) {
            gauge.style.backgroundColor = "rgba(190, 170, 100, 0.65)";
        } else {
            gauge.style.backgroundColor = "rgba(100, 180, 140, 0.65)";
        }
    }
}

/**
 * 밥주기
 */
export function feedPet() {
    if (!state.settings.condition) {
        state.settings.condition = { hunger: 100, lastFed: null, lastVisit: Date.now() };
    }
    
    const before = state.settings.condition.hunger;
    state.settings.condition.hunger = Math.min(100, state.settings.condition.hunger + 40);
    state.settings.condition.lastFed = Date.now();
    hungryNotified = false;
    saveSettings();
    
    log(`Fed pet: ${before} -> ${state.settings.condition.hunger}`);
    
    updateHungerGauge();
    triggerReaction("feeding");
}

// ===== 자발적 말걸기 시스템 =====

let spontaneousTimer = null;

/**
 * 자발적 말걸기 타이머 시작
 */
export function startSpontaneousTimer() {
    stopSpontaneousTimer();
    
    const config = state.settings.reactions.spontaneous;
    if (!config?.enabled || !state.settings.personality.enabled) return;
    
    const minMs = (config.intervalMin || 15) * 60 * 1000;
    const maxMs = (config.intervalMax || 30) * 60 * 1000;
    const delay = minMs + Math.random() * (maxMs - minMs);
    
    log(`Spontaneous timer set: ${Math.round(delay / 60000)}분 후`);
    
    spontaneousTimer = setTimeout(async () => {
        await trySpontaneousSpeech();
        // 다음 타이머 재설정
        startSpontaneousTimer();
    }, delay);
}

/**
 * 자발적 말걸기 타이머 중지
 */
export function stopSpontaneousTimer() {
    if (spontaneousTimer) {
        clearTimeout(spontaneousTimer);
        spontaneousTimer = null;
    }
}

/**
 * 자발적 말걸기 시도
 */
async function trySpontaneousSpeech() {
    // API 호출 중이면 스킵
    if (state.isGenerating || state.isPetGenerating) {
        log("Spontaneous skipped: API busy");
        return;
    }
    
    // AI 반응 비활성화면 스킵
    if (!state.settings.personality.enabled) return;
    
    // 잠자기 상태면 스킵 (잠자는 펫은 말 안 걸음)
    if (state.currentState === PET_STATES.SLEEPING) {
        log("Spontaneous skipped: pet is sleeping");
        return;
    }
    
    // 상황 정보 수집
    const hunger = state.settings.condition?.hunger ?? 100;
    const hour = new Date().getHours();
    const lastInteraction = state._lastInteractionTime || Date.now();
    const minutesSinceInteraction = Math.round((Date.now() - lastInteraction) / 60000);
    
    log(`Spontaneous speech attempt: hunger=${hunger}, idle=${minutesSinceInteraction}min`);
    
    try {
        // 자발적 말걸기 시 → zzZ만 제거 (타이머는 건드리지 않음)
        hideSleepZzz();
        state._lastInteractionTime = Date.now();
        
        const { generateSpontaneousSpeech } = await import("./pet-ai.js");
        await generateSpontaneousSpeech({ hunger, hour, minutesSinceInteraction });
    } catch (error) {
        logError("Spontaneous speech error:", error);
    }
}
