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
import { COMPLEMENTARY_MOODS } from "./constants.js";

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
    
    // 멀티펫 자동 대화 타이머 시작
    startInterPetChatTimer();
    
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
    stopInterPetChatTimer();
    
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
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
        triggerReaction("userMessage", "secondary");
    }
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
    if (greetingCooldown) return; // 인사 직후 다른 확장의 AI 반응 무시
    
    log("onAIResponse triggered, messageId:", messageId);
    
    resetIdleTimer();
    
    // 반응 간격 체크 (N번째 메시지마다 반응) — 스킵되더라도 항상 증가
    messageCounter++;
    const interval = state.settings.reactions.reactionInterval || 3;
    if (messageCounter < interval) {
        log(`Skipping reaction (${messageCounter}/${interval})`);
        return;
    }
    messageCounter = 0;
    
    // 채팅 반응할 펫 결정 (chatReactor 설정)
    let reactPetId = "primary";
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
        const reactor = state.settings.multiPet.chatReactor || "primary";
        if (reactor === "secondary") {
            reactPetId = "secondary";
        } else if (reactor === "alternate") {
            reactionAlternator = !reactionAlternator;
            reactPetId = reactionAlternator ? "secondary" : "primary";
        }
    }
    
    // 펫 API 호출 중이면 대기 후 실행 (최대 15초)
    if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
        log("Pet is generating, deferring AI reaction...");
        waitForPetIdle(15000, 2000).then(available => {
            if (available) {
                log("Pet now idle, executing deferred AI reaction");
                triggerReaction("aiResponse", reactPetId);
            } else {
                log("Deferred AI reaction timed out, discarding");
            }
        });
        return;
    }
    
    triggerReaction("aiResponse", reactPetId);
}

/**
 * 펫 API 호출이 끝날 때까지 대기 (폴링)
 * @param {number} maxWait - 최대 대기 시간 (ms)
 * @param {number} pollInterval - 폴링 간격 (ms)
 * @returns {Promise<boolean>} - true면 idle 상태, false면 타임아웃
 */
function waitForPetIdle(maxWait = 15000, pollInterval = 2000) {
    return new Promise(resolve => {
        const start = Date.now();
        const check = () => {
            if (!state.isPetGenerating && !state.secondPet?.isPetGenerating) {
                resolve(true);
                return;
            }
            if (Date.now() - start >= maxWait) {
                resolve(false);
                return;
            }
            setTimeout(check, pollInterval);
        };
        check();
    });
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
    if (state.settings.multiPet?.enabled && state.secondPet?.currentState === PET_STATES.THINKING) {
        setState(PET_STATES.IDLE, null, "secondary");
        log("Generation ended, reset secondary to idle");
    }
}

/**
 * 채팅방 변경 시 (새 채팅방 진입)
 */
function onChatChanged() {
    if (!state.isReady) return;
    log("Chat changed");
    
    // 채팅방 이동 시 카운터 리셋 + idle 타이머 리셋
    messageCounter = 0;
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
        if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
            triggerReaction("longAbsence", "secondary");
        }
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
    
    // 멀티펫 활성 여부
    const hasSecondPet = state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData;
    
    // 3. 시간대별 인사 (ST 처음 접속 시 1회만)
    if (!state.hasShownTimeGreeting) {
        state.hasShownTimeGreeting = true;
        if (hour >= 0 && hour <= 6) {
            triggerReaction("latenight");
            if (hasSecondPet) triggerReaction("latenight", "secondary");
        } else if (hour >= 7 && hour <= 10) {
            triggerReaction("morning");
            if (hasSecondPet) triggerReaction("morning", "secondary");
        } else {
            triggerReaction("greeting");
            if (hasSecondPet) triggerReaction("greeting", "secondary");
        }
        return;
    }
    
    // 4. 이미 시간 인사 했고, AI 채팅방이면 일반 인사
    if (hasCharacter) {
        triggerReaction("greeting");
        if (hasSecondPet) triggerReaction("greeting", "secondary");
    }
}

/**
 * 반응 트리거
 * @param {string} triggerType - 트리거 종류
 */
export async function triggerReaction(triggerType, petId = "primary") {
    log(`Trigger [${petId}]: ${triggerType}`);
    
    // sleeping 이외의 트리거면 zzz 이펙트 제거
    if (triggerType !== "sleeping" && triggerType !== "idle") {
        hideSleepZzz(petId);
    }
    
    // === 배고픔 패널티 체크 ===
    const hunger = petId === "secondary"
        ? (state.settings.multiPet?.secondPetCondition?.hunger ?? 100)
        : (state.settings.condition?.hunger ?? 100);
    const isStarving = hunger <= 10;
    const isHungry = hunger <= 30;
    
    // 배고프면 상호작용 무시 (50% 확률, 밥주기/배고픔 트리거는 예외)
    if (isStarving && !["feeding", "hungry", "dragging"].includes(triggerType)) {
        if (["click", "petting", "clickSpam"].includes(triggerType) && Math.random() < 0.5) {
            showStateSpeech("hungry", petId);
            setState(PET_STATES.SAD, 2000, petId);
            log(`Hunger penalty [${petId}]: ignored ${triggerType} (starving)`);
            return;
        }
    }
    
    // 기본 상태 및 컨텍스트 결정
    let defaultMood = PET_STATES.IDLE;
    let speechType = "idle";
    
    switch (triggerType) {
        case "userMessage":
            playBounce(petId);
            return;
            
        case "aiResponse":
            defaultMood = PET_STATES.HAPPY;
            playBounce(petId);
            
            if (state.settings.personality.enabled) {
                const reactionResult = await showAIReaction(petId);
                
                // 비반응 펫은 보조 무드만 변경 (API 호출 없음)
                if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && reactionResult) {
                    const otherPetId = petId === "primary" ? "secondary" : "primary";
                    const compMoods = COMPLEMENTARY_MOODS[reactionResult.mood] || ["idle"];
                    const compMood = compMoods[Math.floor(Math.random() * compMoods.length)];
                    setState(compMood, 4000, otherPetId);
                }
            }
            
            const curState = petId === "secondary" ? state.secondPet.currentState : state.currentState;
            if (curState === PET_STATES.THINKING) {
                setState(defaultMood, 2000, petId);
            }
            return;
            
        case "idle":
            defaultMood = PET_STATES.IDLE;
            speechType = "idle";
            break;

        case "sleeping":
            defaultMood = PET_STATES.SLEEPING;
            speechType = "sleeping";
            showSleepZzz(petId);
            break;
            
        case "dragging":
            defaultMood = PET_STATES.DRAGGING;
            speechType = "dragging";
            setState(defaultMood, null, petId);
            showStateSpeech(speechType, petId);
            return;
        
        case "click":
            defaultMood = PET_STATES.HAPPY;
            speechType = "click";
            playBounce(petId);
            break;
        
        case "clickSpam":
            defaultMood = PET_STATES.ANGRY;
            speechType = "clickSpam";
            playShake(petId);
            break;
        
        case "petting":
            defaultMood = PET_STATES.SHY;
            speechType = "petting";
            playBounce(petId);
            playHearts(petId);
            break;
        
        case "greeting":
            defaultMood = PET_STATES.HAPPY;
            speechType = "greeting";
            playBounce(petId);
            break;
        
        case "latenight":
            defaultMood = PET_STATES.IDLE;
            speechType = "latenight";
            break;
        
        case "morning":
            defaultMood = PET_STATES.SLEEPING;
            speechType = "morning";
            break;
        
        case "longAbsence":
            defaultMood = PET_STATES.SURPRISED;
            speechType = "longAbsence";
            playShake(petId);
            break;
        
        case "feeding":
            defaultMood = PET_STATES.HAPPY;
            speechType = "feeding";
            playBounce(petId);
            break;
        
        case "hungry":
            defaultMood = PET_STATES.SAD;
            speechType = "hungry";
            break;
            
        default:
            defaultMood = PET_STATES.IDLE;
            speechType = "idle";
    }
    
    if (isHungry && speechType === "idle") {
        speechType = "hungry";
        defaultMood = PET_STATES.SAD;
    }
    setState(defaultMood, triggerType === "idle" || triggerType === "sleeping" ? null : 2000, petId);
    showStateSpeech(speechType, petId);
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
            if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && !state.secondPet.isPetGenerating) {
                triggerReaction("idle", "secondary");
            }
        }
    }, idleTimeout);
    
    state.sleepTimer = setTimeout(() => {
        if (!state.isGenerating && !state.isPetGenerating) {
            triggerReaction("sleeping");
            if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && !state.secondPet.isPetGenerating) {
                triggerReaction("sleeping", "secondary");
            }
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
let secondPetHungryNotified = false;        // 2번째 펫 배고픔 알림 중복 방지
let interPetChatTimer = null;               // 펫끼리 자동 대화 타이머
let reactionAlternator = false;             // alternate 모드 교대 플래그

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
    
    // 2번째 펫 컨디션
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetCondition) {
        state.settings.multiPet.secondPetCondition.hunger = Math.max(0, state.settings.multiPet.secondPetCondition.hunger - HUNGER_DECAY_PER_CHECK);
        updateSecondPetHungerGauge();
        
        if (state.settings.multiPet.secondPetCondition.hunger <= HUNGER_WARNING && !secondPetHungryNotified && !state.secondPet.isPetGenerating) {
            secondPetHungryNotified = true;
            triggerReaction("hungry", "secondary");
        }
        if (state.settings.multiPet.secondPetCondition.hunger > HUNGER_WARNING) {
            secondPetHungryNotified = false;
        }
    }
    
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

/**
 * 2번째 펫 밥주기
 */
export function feedSecondPet() {
    if (!state.settings.multiPet?.enabled) return;
    if (!state.settings.multiPet.secondPetCondition) {
        state.settings.multiPet.secondPetCondition = { hunger: 100, lastFed: null };
    }
    
    const before = state.settings.multiPet.secondPetCondition.hunger;
    state.settings.multiPet.secondPetCondition.hunger = Math.min(100, state.settings.multiPet.secondPetCondition.hunger + 40);
    state.settings.multiPet.secondPetCondition.lastFed = Date.now();
    secondPetHungryNotified = false;
    saveSettings();
    
    log(`Fed second pet: ${before} -> ${state.settings.multiPet.secondPetCondition.hunger}`);
    
    updateSecondPetHungerGauge();
    triggerReaction("feeding", "secondary");
}

/**
 * 2번째 펫 배고픔 게이지 UI 업데이트
 */
function updateSecondPetHungerGauge() {
    const gauge = document.querySelector("#saipet-container-2 .st-pet-hunger-fill");
    if (gauge) {
        const hunger = state.settings.multiPet?.secondPetCondition?.hunger ?? 100;
        gauge.style.width = `${hunger}%`;
        
        if (hunger <= 20) {
            gauge.style.backgroundColor = "rgba(190, 100, 100, 0.65)";
        } else if (hunger <= 50) {
            gauge.style.backgroundColor = "rgba(190, 170, 100, 0.65)";
        } else {
            gauge.style.backgroundColor = "rgba(100, 180, 140, 0.65)";
        }
    }
}

// ===== 펫끼리 자동 대화 시스템 =====

/**
 * 펫끼리 자동 대화 타이머 시작
 */
function startInterPetChatTimer() {
    stopInterPetChatTimer();
    
    if (!state.settings.multiPet?.enabled) return;
    if (!state.settings.multiPet?.interPetChat?.enabled) return;
    if (!state.settings.multiPet?.secondPetData) return;
    
    const intervalMin = state.settings.multiPet.interPetChat.interval || 5;
    const intervalMs = intervalMin * 60 * 1000;
    
    interPetChatTimer = setInterval(async () => {
        // 생성 중이면 30초 후 1회 재시도
        if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
            log("Inter-pet chat blocked, will retry in 30s");
            setTimeout(async () => {
                if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
                    log("Inter-pet chat retry still blocked, skipping");
                    return;
                }
                try {
                    const { showInterPetDialogue } = await import("./pet-ai.js");
                    await showInterPetDialogue();
                } catch (err) {
                    logError("Inter-pet chat retry error:", err);
                }
            }, 30000);
            return;
        }
        
        try {
            const { showInterPetDialogue } = await import("./pet-ai.js");
            await showInterPetDialogue();
        } catch (err) {
            logError("Inter-pet chat error:", err);
        }
    }, intervalMs);
    
    log(`Inter-pet chat timer started: interval=${intervalMin}min`);
}

/**
 * 펫끼리 자동 대화 타이머 중지
 */
function stopInterPetChatTimer() {
    if (interPetChatTimer) {
        clearInterval(interPetChatTimer);
        interPetChatTimer = null;
        log("Inter-pet chat timer stopped");
    }
}

/**
 * 펫끼리 자동 대화 타이머 재시작 (설정 변경 시 호출)
 */
export function restartInterPetChatTimer() {
    startInterPetChatTimer();
}
