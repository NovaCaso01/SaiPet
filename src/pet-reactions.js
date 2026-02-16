/**
 * SaiPet - 반응 트리거 관리
 */

import { eventSource, event_types } from "../../../../../script.js";
import { getContext } from "../../../../extensions.js";
import { state, log, logError } from "./state.js";
import { saveSettings } from "./storage.js";
import { setState, PET_STATES, playBounce, playShake, playHearts, showSleepZzz, hideSleepZzz, showDreamEffect, hideDreamEffect } from "./pet-animation.js";
import { showStateSpeech, showSpeechBubble } from "./pet-speech.js";
import { showAIReaction, saveNotificationLog } from "./pet-ai.js";
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
    if (state._startupCooldownTimer) clearTimeout(state._startupCooldownTimer);
    state._startupCooldownTimer = setTimeout(() => {
        state._startupCooldownTimer = null;
        state.isReady = true;
        log("Reactions ready (startup cooldown ended)");
    }, 5000);
    
    // 인사는 즉시 표시 (AI 호출 없이 커스텀 대사)
    if (state._greetingTimer) clearTimeout(state._greetingTimer);
    state._greetingTimer = setTimeout(() => {
        state._greetingTimer = null;
        triggerEntryGreeting();
    }, 500);
    
    // Idle 타이머 시작
    startIdleTimer();
    
    // 컨디션 시스템 시작 (배고픔 감소 등)
    startConditionTimer();
    
    // 멀티펫 자동 대화 타이머 시작
    startInterPetChatTimer();

    // 알림/리마인드 타이머 시작
    startReminderTimer();

    // 세션 시작 시간 기록 (자동 일기용 — 하루 총 접속시간 누적)
    state._sessionStartTime = Date.now();
    state._sessionChatCount = 0;
    // 오늘 누적 접속 시간 복원 (저장된 값이 오늘 날짜면)
    const todayStr = new Date().toISOString().split("T")[0];
    if (state.settings._dailySessionDate === todayStr) {
        state._dailySessionAccumulated = state.settings._dailySessionAccumulated || 0;
    } else {
        state._dailySessionAccumulated = 0;
        state.settings._dailySessionDate = todayStr;
        state.settings._dailySessionAccumulated = 0;
    }
    
    log("Reactions initialized");
}

/**
 * 이벤트 리스너 해제
 */
export function destroyReactions() {
    // 세션 종료 시 누적 접속시간 저장
    if (state._sessionStartTime) {
        const currentSessionElapsed = Date.now() - state._sessionStartTime;
        state.settings._dailySessionAccumulated = (state._dailySessionAccumulated || 0) + currentSessionElapsed;
        saveSettings();
    }

    eventSource.off(event_types.MESSAGE_SENT, onUserMessage);
    eventSource.off(event_types.GENERATION_STARTED, onGenerationStart);
    eventSource.off(event_types.MESSAGE_RECEIVED, onAIResponse);
    eventSource.off(event_types.GENERATION_ENDED, onGenerationEnd);
    eventSource.off(event_types.CHAT_CHANGED, onChatChanged);
    
    stopIdleTimer();
    stopConditionTimer();
    stopInterPetChatTimer();
    stopReminderTimer();
    
    log("Reactions destroyed");
}

/**
 * 유저 메시지 전송 시
 */
function onUserMessage() {
    if (!state.isReady) return;
    if (state.isPetGenerating) return;
    
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
    
    // AI 응답 = 유저 교류이므로 idle/sleep 타이머 리셋 (반응 스킵되더라도)
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

    // 유저 교류 트리거면 idle/sleep 타이머 리셋
    // (펫끼리 대화, 자발적 idle/sleeping, 꿈 등은 리셋하지 않음)
    const userInteractionTriggers = [
        "click", "clickSpam", "petting", "dragging",
        "feeding", "aiResponse", "userMessage",
        "greeting", "longAbsence",
    ];
    if (userInteractionTriggers.includes(triggerType)) {
        resetIdleTimer();
    }
    
    // sleeping 이외의 트리거면 zzz 이펙트 제거
    if (triggerType !== "sleeping" && triggerType !== "idle") {
        hideSleepZzz(petId);
        hideDreamEffect(petId);
        // 잠에서 깨면 꿈 플래그 리셋
        if (petId === "secondary") {
            if (state.secondPet.dreamTimer) { clearTimeout(state.secondPet.dreamTimer); state.secondPet.dreamTimer = null; }
            state.secondPet.hasDreamedThisSleep = false;
        } else {
            if (state.dreamTimer) { clearTimeout(state.dreamTimer); state.dreamTimer = null; }
            state.hasDreamedThisSleep = false;
        }
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
            // 꿈 생성 트리거 (30-60초 후 1회)
            scheduleDream(petId);
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
    
    const idleTimeout = (state.settings.reactions.idleTimeout || 300) * 1000;
    const sleepTimeout = (state.settings.reactions.sleepTimeout || 900) * 1000;
    
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
 * Idle 타이머 리셋 (유저 교류 시 호출)
 */
export function resetIdleTimer() {
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
    stopConditionTimer();

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

            // 2번째 펫 오프라인 배고픔 감소
            if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetCondition) {
                state.settings.multiPet.secondPetCondition.hunger = Math.max(0, state.settings.multiPet.secondPetCondition.hunger - (missedChecks * HUNGER_DECAY_PER_CHECK));
                log(`SecondPet offline hunger decay: -${missedChecks * HUNGER_DECAY_PER_CHECK}, now ${state.settings.multiPet.secondPetCondition.hunger}`);
            }

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

    // 자동 일기 조건 체크
    checkAutoDiary();

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
let interPetRetryTimer = null;  // retry setTimeout 참조 (중첩 방지)

function startInterPetChatTimer() {
    stopInterPetChatTimer();
    
    if (!state.settings.multiPet?.enabled) return;
    if (!state.settings.multiPet?.interPetChat?.enabled) return;
    if (!state.settings.multiPet?.secondPetData) return;
    
    const intervalMin = Math.max(3, state.settings.multiPet.interPetChat.interval || 10);
    const intervalMs = intervalMin * 60 * 1000;
    
    interPetChatTimer = setInterval(async () => {
        // 이미 retry 대기 중이면 스킵
        if (interPetRetryTimer) {
            log("Inter-pet chat skipped: retry already pending");
            return;
        }
        
        // 생성 중이면 30초 후 1회 재시도
        if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
            log("Inter-pet chat blocked, will retry in 30s");
            interPetRetryTimer = setTimeout(async () => {
                interPetRetryTimer = null;
                if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
                    log("Inter-pet chat retry still blocked, skipping");
                    return;
                }
                try {
                    const { showInterPetDialogue } = await import("./pet-ai.js");
                    await showInterPetDialogue();
                } catch (err) {
                    logError("펫끼리 대화 (재시도)", err);
                }
            }, 30000);
            return;
        }
        
        try {
            const { showInterPetDialogue } = await import("./pet-ai.js");
            await showInterPetDialogue();
        } catch (err) {
            logError("펫끼리 대화", err);
        }
    }, intervalMs);
    
    log(`Inter-pet chat timer started: interval=${intervalMin}min`);
}

/**
 * 펫끼리 자동 대화 타이머 중지
 */
function stopInterPetChatTimer() {
    if (interPetRetryTimer) {
        clearTimeout(interPetRetryTimer);
        interPetRetryTimer = null;
    }
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

// ===== 꿈 시스템 =====

/**
 * 꿈 생성 스케줄 (sleeping 진입 후 30-60초 뒤 1회)
 */
function scheduleDream(petId = "primary") {
    const isSecond = petId === "secondary";
    const hasDreamed = isSecond ? state.secondPet.hasDreamedThisSleep : state.hasDreamedThisSleep;

    // 이미 이번 수면에서 꿈 꿨으면 스킵
    if (hasDreamed) return;

    // 꿈 시스템 OFF면 스킵
    if (!state.settings.petJournal?.dreamEnabled) return;
    if (!state.settings.personality?.enabled) return;

    // 하루 최대 꿈 횟수 체크 (펫별)
    const maxDreams = state.settings.petJournal.maxDreamsPerDay ?? 3;
    if (maxDreams > 0) {
        const todayStr = new Date().toISOString().split("T")[0];
        // 펫별 카운터 초기화
        if (!state.settings.petJournal.dreamCounts) state.settings.petJournal.dreamCounts = {};
        if (state.settings.petJournal.dreamCountDate !== todayStr) {
            state.settings.petJournal.dreamCountDate = todayStr;
            state.settings.petJournal.dreamCounts = {};
            // 레거시 전역 카운터도 리셋
            state.settings.petJournal.dreamCountToday = 0;
            saveSettings();
        }
        const petName = isSecond
            ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
            : (state.settings.personality?.name || "미유");
        const petCount = state.settings.petJournal.dreamCounts[petName] || 0;
        if (petCount >= maxDreams) {
            log(`Dream skipped [${petId}]: daily limit reached for ${petName} (${petCount}/${maxDreams})`);
            return;
        }
    }

    // 기존 타이머 정리
    if (isSecond) {
        if (state.secondPet.dreamTimer) clearTimeout(state.secondPet.dreamTimer);
    } else {
        if (state.dreamTimer) clearTimeout(state.dreamTimer);
    }

    const delay = (30 + Math.floor(Math.random() * 30)) * 1000; // 30-60초
    log(`Dream scheduled [${petId}]: ${Math.round(delay / 1000)}s delay`);

    const timer = setTimeout(async () => {
        // 아직 sleeping 상태인지 확인
        const currentState = isSecond ? state.secondPet.currentState : state.currentState;
        if (currentState !== PET_STATES.SLEEPING) {
            log(`Dream cancelled [${petId}]: no longer sleeping`);
            return;
        }

        // 이미 다른 생성 중이면 스킵
        if (isSecond ? state.secondPet.isPetGenerating : state.isPetGenerating) {
            log(`Dream cancelled [${petId}]: pet is generating`);
            return;
        }

        // 꿈 생성 시작
        if (isSecond) { state.secondPet.isDreamGenerating = true; state.secondPet.hasDreamedThisSleep = true; }
        else { state.isDreamGenerating = true; state.hasDreamedThisSleep = true; }

        showDreamEffect(petId);
        showSpeechBubble("꿈꾸는 중...", 20000, false, petId);

        try {
            const { generateDream, saveDream } = await import("./pet-ai.js");
            const petName = isSecond
                ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
                : (state.settings.personality?.name || "미유");

            const result = await generateDream(petId);

            if (result && result.content) {
                saveDream(petName, result.content, result.sleepTalk);
                // 잠꼬대 말풍선
                showSpeechBubble(result.sleepTalk, 10000, false, petId);
                log(`Dream complete [${petId}]: "${result.sleepTalk}"`);
            } else {
                showSpeechBubble("...zzz...", 5000, false, petId);
            }
        } catch (err) {
            logError("꿈 생성", err);
            showSpeechBubble("...zzz...", 5000, false, petId);
        } finally {
            hideDreamEffect(petId);
            if (isSecond) { state.secondPet.isDreamGenerating = false; }
            else { state.isDreamGenerating = false; }
        }
    }, delay);

    if (isSecond) { state.secondPet.dreamTimer = timer; }
    else { state.dreamTimer = timer; }
}

// ===== 알림/리마인드 시스템 =====

let reminderTimer = null;
const REMINDER_CHECK_INTERVAL = 60 * 1000; // 60초마다 체크 (분 단위 정밀도)

/**
 * 알림 타이머 시작
 */
function startReminderTimer() {
    stopReminderTimer();

    if (!state.settings.reminders || state.settings.reminders.length === 0) return;

    // 접속(세션 시작) 시점 기준으로 interval 알림 카운트 리셋
    const now = Date.now();
    for (const reminder of state.settings.reminders) {
        if (reminder.mode === "interval") {
            reminder.lastIntervalTrigger = now;
        }
    }

    reminderTimer = setInterval(() => {
        checkReminders();
    }, REMINDER_CHECK_INTERVAL);

    log(`Reminder timer started (${state.settings.reminders.length} reminders)`);
}

/**
 * 알림 타이머 중지
 */
function stopReminderTimer() {
    if (reminderTimer) {
        clearInterval(reminderTimer);
        reminderTimer = null;
    }
}

/**
 * 알림 타이머 재시작 (설정 변경 시 UI에서 호출)
 */
export function restartReminderTimer() {
    startReminderTimer();
}

/**
 * 알림 체크 (60초마다 실행)
 */
async function checkReminders() {
    if (!state.settings.reminders || state.settings.reminders.length === 0) return;
    if (state.isPetGenerating || state.isGenerating) return;

    const now = new Date();
    const currentHH = String(now.getHours()).padStart(2, "0");
    const currentMM = String(now.getMinutes()).padStart(2, "0");
    const currentTime = `${currentHH}:${currentMM}`;
    const todayStr = now.toISOString().split("T")[0];
    const dayOfWeek = now.getDay(); // 0=일, 1=월 ... 6=토

    // 트리거할 알림 수집
    const toTrigger = [];

    for (const reminder of state.settings.reminders) {
        if (!reminder.enabled) continue;

        if (reminder.mode === "interval") {
            // 반복 간격 모드: 마지막 트리거로부터 N분 경과 시 트리거
            const intervalMs = (reminder.intervalMinutes || 30) * 60 * 1000;
            const lastTrigger = reminder.lastIntervalTrigger || 0;
            if (Date.now() - lastTrigger >= intervalMs) {
                toTrigger.push(reminder);
            }
            continue;
        }

        // 시각 지정 모드 (기존)
        if (reminder.time !== currentTime) continue;
        if (reminder.lastTriggered === todayStr) continue;

        // 이전 형식 호환 (repeat → days 마이그레이션)
        if (!reminder.days && reminder.repeat) {
            if (reminder.repeat === "daily") reminder.days = [0,1,2,3,4,5,6];
            else if (reminder.repeat === "weekdays") reminder.days = [1,2,3,4,5];
            else reminder.days = [];
            delete reminder.repeat;
        }

        const days = reminder.days || [];
        if (days.length > 0 && !days.includes(dayOfWeek)) continue;

        toTrigger.push(reminder);
    }

    if (toTrigger.length === 0) return;

    // 알림 담당 펫
    const reminderPetId = state.settings.reminderPetId || "primary";
    const actualPetId = (reminderPetId === "secondary" && state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData)
        ? "secondary" : "primary";

    // 순차 트리거 (여러 개면 딜레이 적용)
    for (let i = 0; i < toTrigger.length; i++) {
        const reminder = toTrigger[i];

        if (i > 0) {
            await new Promise(r => setTimeout(r, 18000)); // 18초 간격
            if (state.isPetGenerating || state.secondPet?.isPetGenerating) break;
        }

        log(`Reminder triggered: "${reminder.message}" at ${reminder.time || reminder.intervalMinutes + 'min interval'}`);

        if (reminder.mode === "interval") {
            reminder.lastIntervalTrigger = Date.now();
        } else {
            reminder.lastTriggered = todayStr;
            if ((reminder.days || []).length === 0) {
                reminder.enabled = false;
            }
        }

        saveSettings();
        document.dispatchEvent(new CustomEvent("stvp-reminders-updated"));

        try {
            const { generateReminder } = await import("./pet-ai.js");
            const result = await generateReminder(reminder.message, actualPetId);

            if (result && result.text) {
                setState(result.mood || PET_STATES.HAPPY, 3000, actualPetId);
                showSpeechBubble(result.text, 15000, true, actualPetId);
                saveNotificationLog(reminder.message, result.text, result.mood || "happy", "reminder", actualPetId);
            } else {
                showSpeechBubble(`⏰ ${reminder.message}`, 10000, false, actualPetId);
                saveNotificationLog(reminder.message, `⏰ ${reminder.message}`, "neutral", "reminder", actualPetId);
            }
        } catch (err) {
            logError("리마인드 생성", err);
            showSpeechBubble(`⏰ ${reminder.message}`, 10000, false, actualPetId);
            saveNotificationLog(reminder.message, `⏰ ${reminder.message}`, "neutral", "reminder", actualPetId);
        }
    }
}

// ===== 자동 일기 시스템 =====

let autoDiaryInProgress = false;

/**
 * 자동 일기 조건 체크 (updateCondition에서 5분마다 호출)
 * 조건: enabled + 오늘 아직 안씀 + 세션시간 ≥ 30분 + 채팅 ≥ N회
 */
async function checkAutoDiary() {
    // 기본 체크
    const autoDiary = state.settings.autoDiary;
    if (!autoDiary?.enabled) return;
    if (!state.settings.petJournal?.diaryEnabled) return;
    if (autoDiaryInProgress) return;
    if (state.isPetGenerating || state.isGenerating) return;

    const todayStr = new Date().toISOString().split("T")[0];

    // 하루 총 접속 시간 체크 (기본 30분)
    const minSessionMs = (autoDiary.minSessionMinutes || 30) * 60 * 1000;
    const currentSessionElapsed = Date.now() - (state._sessionStartTime || Date.now());
    const totalDailySession = (state._dailySessionAccumulated || 0) + currentSessionElapsed;
    if (totalDailySession < minSessionMs) return;

    // 채팅 횟수 체크
    const minChats = autoDiary.minChats || 5;
    if ((state._sessionChatCount || 0) < minChats) return;

    // diaryWriter 설정에 따라 작성할 펫 결정
    const writer = state.settings.petJournal?.diaryWriter || "primary";
    const targets = [];
    if (writer === "primary" || writer === "both") targets.push("primary");
    if ((writer === "secondary" || writer === "both") && state.settings.multiPet?.enabled) targets.push("secondary");
    if (targets.length === 0) targets.push("primary");

    // 오늘 이미 작성한 펫 제외
    const lastDates = state.settings.petJournal.lastDiaryDates || {};
    // 하위호환: 기존 lastDiaryDate 값도 primary로 취급
    if (!lastDates.primary && state.settings.petJournal.lastDiaryDate) {
        lastDates.primary = state.settings.petJournal.lastDiaryDate;
    }
    const pendingTargets = targets.filter(id => lastDates[id] !== todayStr);
    if (pendingTargets.length === 0) return;

    // 모든 조건 충족 → 일기 자동 작성
    autoDiaryInProgress = true;
    log(`Auto diary conditions met (session: ${Math.floor(totalDailySession/60000)}min, chats: ${state._sessionChatCount}, writers: ${pendingTargets.join(",")})`);

    try {
        const { generateDiary, saveDiary } = await import("./pet-ai.js");

        for (const petId of pendingTargets) {
            const isSecond = petId === "secondary";
            const petName = isSecond
                ? (state.settings.multiPet?.secondPetData?.personality?.name || "펫2")
                : (state.settings.personality?.name || "미유");

            const result = await generateDiary(petId);

            if (result && result.diary) {
                saveDiary(petName, result.diary, petId);

                // 완료 코멘트 말풍선 표시
                if (result.comment) {
                    setState(PET_STATES.HAPPY, 4000, petId);
                    showSpeechBubble(`📔 ${result.comment}`, 10000, true, petId);
                } else {
                    setState(PET_STATES.HAPPY, 3000, petId);
                    showSpeechBubble("📔 일기 다 썼다...", 6000, false, petId);
                }

                log(`Auto diary written for ${petName} [${petId}]`);
            }
        }
    } catch (err) {
        logError("자동 일기", err);
    } finally {
        autoDiaryInProgress = false;
    }
}
