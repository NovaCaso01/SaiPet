/**
 * SaiPet - 말풍선 관리
 */

import { state, log } from "./state.js";
import { DEFAULT_SPEECHES } from "./constants.js";

/** 말풍선 z-index 카운터: 나중에 뜬 말풍선이 항상 위에 표시되도록 */
let bubbleZCounter = 9999;

/**
 * 말풍선 표시
 * @param {string} text - 표시할 텍스트
 * @param {number|null} duration - 표시 시간 (ms), null이면 설정값 사용
 * @param {boolean} priority - true면 우선순위 말풍선 (AI 응답), 일반 대사로 덮어쓰기 불가
 */
export function showSpeechBubble(text, duration = null, priority = false, petId = "primary") {
    const isSecond = petId === "secondary";
    const speechBubbleSettings = isSecond
        ? (state.settings.multiPet?.secondPetData?.speechBubble || state.settings.speechBubble)
        : state.settings.speechBubble;
    
    // 공통 설정: 말풍선 ON/OFF는 항상 글로벌 설정 사용
    if (!state.settings.speechBubble.enabled) return;
    
    const bubbleEl = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
    if (!bubbleEl) return;
    
    const bubbleText = bubbleEl.querySelector(".st-pet-bubble-text");
    if (!bubbleText) return;
    
    // 우선순위 말풍선이 표시 중이면 일반 대사는 무시
    const isPriorityActive = isSecond ? state.secondPet.isPrioritySpeech : state.isPrioritySpeech;
    if (isPriorityActive && !priority) {
        log(`Speech [${petId}] blocked (priority active): "${text}"`);
        return;
    }
    
    // 기존 타이머 클리어
    const existingTimer = isSecond ? state.secondPet.bubbleTimer : state.bubbleTimer;
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    
    // 우선순위 플래그 설정
    if (isSecond) {
        state.secondPet.isPrioritySpeech = priority;
    } else {
        state.isPrioritySpeech = priority;
    }
    
    // 스타일 적용
    applyBubbleStyle(petId);
    
    // 텍스트 설정
    bubbleText.textContent = text;
    
    // 표시
    bubbleEl.style.display = "block";
    bubbleEl.classList.add("show");
    
    // 늦게 뜬 말풍선이 위에 오도록 컨테이너 z-index 갱신
    if (bubbleZCounter > 99999) bubbleZCounter = 9999;
    bubbleZCounter++;
    const container = isSecond
        ? document.getElementById("saipet-container-2")
        : document.getElementById("saipet-container");
    if (container) container.style.zIndex = bubbleZCounter;
    
    // 화면 밖 잘림 보정
    adjustBubblePosition(petId);
    
    // 자동 숨김 — 공통 설정: 표시 시간은 글로벌 설정 사용
    const hideAfter = duration || state.settings.speechBubble.duration;
    const newTimer = setTimeout(() => {
        hideSpeechBubble(petId);
    }, hideAfter);
    
    if (isSecond) {
        state.secondPet.bubbleTimer = newTimer;
    } else {
        state.bubbleTimer = newTimer;
    }
    
    log(`Speech [${petId}]: "${text}"`);
}

/**
 * 말풍선 숨기기
 */
export function hideSpeechBubble(petId = "primary") {
    const isSecond = petId === "secondary";
    const bubbleEl = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
    if (!bubbleEl) return;
    
    if (isSecond) {
        state.secondPet.isPrioritySpeech = false;
    } else {
        state.isPrioritySpeech = false;
    }
    bubbleEl.classList.remove("show");
    
    setTimeout(() => {
        const el = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
        if (el) el.style.display = "none";
    }, 200);
    
    const timer = isSecond ? state.secondPet.bubbleTimer : state.bubbleTimer;
    if (timer) {
        clearTimeout(timer);
        if (isSecond) {
            state.secondPet.bubbleTimer = null;
        } else {
            state.bubbleTimer = null;
        }
    }
}

/**
 * 말풍선 위치 보정 (화면 밖 잘림 방지)
 */
function adjustBubblePosition(petId = "primary") {
    const isSecond = petId === "secondary";
    const bubble = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
    if (!bubble) return;
    
    const containerId = isSecond ? "saipet-container-2" : "saipet-container";
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // 기본 위치 초기화 (상단, 중앙 정렬)
    bubble.style.setProperty("--bubble-offset-x", "-50%");
    bubble.style.setProperty("--tail-left", "50%");
    bubble.classList.remove("below");
    
    // 렌더링 후 위치 계산
    requestAnimationFrame(() => {
        const bubbleRect = bubble.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const containerCenterX = containerRect.left + containerRect.width / 2;
        const margin = 8;
        
        // 1차 판단: 위로 삐져나가는지만 확인
        let needBelow = bubbleRect.top < margin;
        
        // 위치 결정 후 한 번에 적용 (layout thrashing 방지)
        requestAnimationFrame(() => {
            if (needBelow) {
                bubble.classList.add("below");
                // 하단 모드에서 아래로 삐져나가면 다시 상단으로
                const belowRect = bubble.getBoundingClientRect();
                if (belowRect.bottom > vh - margin) {
                    bubble.classList.remove("below");
                }
            }
            
            // === 좌우 보정 ===
            const finalRect = bubble.getBoundingClientRect();
            let shiftPx = 0;
            
            if (finalRect.left < margin) {
                shiftPx = margin - finalRect.left;
            } else if (finalRect.right > vw - margin) {
                shiftPx = (vw - margin) - finalRect.right;
            }
            
            if (shiftPx !== 0) {
                bubble.style.setProperty("--bubble-offset-x", `calc(-50% + ${shiftPx}px)`);
                
                const tailLeft = containerCenterX - (finalRect.left + shiftPx);
                const clampedTail = Math.max(12, Math.min(tailLeft, finalRect.width - 12));
                bubble.style.setProperty("--tail-left", `${clampedTail}px`);
            }
        });
    });
}

/**
 * 말풍선 스타일 적용
 */
function applyBubbleStyle(petId = "primary") {
    const isSecond = petId === "secondary";
    const containerId = isSecond ? "saipet-container-2" : "saipet-container";
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const speechBubbleSettings = isSecond
        ? (state.settings.multiPet?.secondPetData?.speechBubble || state.settings.speechBubble)
        : state.settings.speechBubble;
    const { backgroundColor, textColor, accentColor } = speechBubbleSettings;
    
    // CSS 변수로 스타일 전달 (ST 테마 격리)
    container.style.setProperty("--spc-bubble-bg", backgroundColor);
    container.style.setProperty("--spc-bubble-text", textColor);
    container.style.setProperty("--spc-accent", accentColor || "#7c9bff");
    container.style.setProperty("--bubble-bg-color", backgroundColor);
}

/**
 * 상황에 맞는 랜덤 대사 가져오기
 * @param {string} speechType - idle, sleeping, dragging, click, greeting, latenight, morning, clickSpam, longAbsence, feeding, hungry, petting 중 하나
 * @returns {string}
 */
export function getRandomSpeech(speechType, petId = "primary") {
    // 유효한 타입만 허용
    const validTypes = ["idle", "sleeping", "dragging", "click", "greeting", "latenight", "morning", "clickSpam", "longAbsence", "feeding", "hungry", "petting"];
    const type = validTypes.includes(speechType) ? speechType : "idle";
    
    // 커스텀 대사가 있으면 우선 사용
    const customSpeechesSource = petId === "secondary"
        ? state.settings.multiPet?.secondPetData?.customSpeeches
        : state.settings.customSpeeches;
    const customSpeeches = customSpeechesSource?.[type];
    if (customSpeeches && customSpeeches.length > 0) {
        const validCustom = customSpeeches.filter(s => s && s.trim());
        if (validCustom.length > 0) {
            const index = Math.floor(Math.random() * validCustom.length);
            return validCustom[index];
        }
    }
    
    // 기본 대사 사용
    const defaultList = DEFAULT_SPEECHES[type] || DEFAULT_SPEECHES.idle;
    const index = Math.floor(Math.random() * defaultList.length);
    return defaultList[index];
}

/**
 * 상황에 맞는 대사 표시
 * @param {string} speechType - idle, sleeping, click, petting, greeting 등 상황 키워드
 */
export function showStateSpeech(speechType, petId = "primary") {
    const speech = getRandomSpeech(speechType, petId);
    showSpeechBubble(speech, null, false, petId);
}
