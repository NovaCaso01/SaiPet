/**
 * SaiPet - 말풍선 관리
 */

import { state, log } from "./state.js";
import { DEFAULT_SPEECHES } from "./constants.js";

/**
 * 말풍선 표시
 * @param {string} text - 표시할 텍스트
 * @param {number|null} duration - 표시 시간 (ms), null이면 설정값 사용
 * @param {boolean} priority - true면 우선순위 말풍선 (AI 응답), 일반 대사로 덮어쓰기 불가
 */
export function showSpeechBubble(text, duration = null, priority = false) {
    if (!state.settings.speechBubble.enabled) return;
    if (!state.bubbleElement) return;
    
    const bubbleText = state.bubbleElement.querySelector(".st-pet-bubble-text");
    if (!bubbleText) return;
    
    // 우선순위 말풍선이 표시 중이면 일반 대사는 무시
    if (state.isPrioritySpeech && !priority) {
        log(`Speech blocked (priority active): "${text}"`);
        return;
    }
    
    // 기존 타이머 클리어
    if (state.bubbleTimer) {
        clearTimeout(state.bubbleTimer);
    }
    
    // 우선순위 플래그 설정
    state.isPrioritySpeech = priority;
    
    // 스타일 적용
    applyBubbleStyle();
    
    // 텍스트 설정
    bubbleText.textContent = text;
    
    // 표시
    state.bubbleElement.style.display = "block";
    state.bubbleElement.classList.add("show");
    
    // 화면 밖 잘림 보정
    adjustBubblePosition();
    
    // 자동 숨김
    const hideAfter = duration || state.settings.speechBubble.duration;
    state.bubbleTimer = setTimeout(() => {
        hideSpeechBubble();
    }, hideAfter);
    
    log(`Speech: "${text}"`);
}

/**
 * 말풍선 숨기기
 */
export function hideSpeechBubble() {
    if (!state.bubbleElement) return;
    
    state.isPrioritySpeech = false;
    state.bubbleElement.classList.remove("show");
    
    setTimeout(() => {
        if (state.bubbleElement) {
            state.bubbleElement.style.display = "none";
        }
    }, 200);
    
    if (state.bubbleTimer) {
        clearTimeout(state.bubbleTimer);
        state.bubbleTimer = null;
    }
}

/**
 * 말풍선 위치 보정 (화면 밖 잘림 방지)
 */
function adjustBubblePosition() {
    if (!state.bubbleElement) return;
    
    const bubble = state.bubbleElement;
    const container = document.getElementById("saipet-container");
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
        
        // === 상하 보정: 말풍선이 화면 위로 삐져나가면 하단으로 ===
        if (bubbleRect.top < margin) {
            bubble.classList.add("below");
        }
        
        // 하단 모드일 때 화면 아래로 삐져나가면 다시 상단으로
        if (bubble.classList.contains("below")) {
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
}

/**
 * 말풍선 스타일 적용
 */
function applyBubbleStyle() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const { backgroundColor, textColor, accentColor } = state.settings.speechBubble;
    
    // CSS 변수로 스타일 전달 (ST 테마 격리)
    container.style.setProperty("--spc-bubble-bg", backgroundColor);
    container.style.setProperty("--spc-bubble-text", textColor);
    container.style.setProperty("--spc-accent", accentColor || "#7c9bff");
    container.style.setProperty("--bubble-bg-color", backgroundColor);
}

/**
 * 상황에 맞는 랜덤 대사 가져오기
 * @param {string} speechType - idle, sleeping, dragging 중 하나
 * @returns {string}
 */
export function getRandomSpeech(speechType) {
    // 유효한 타입만 허용
    const validTypes = ["idle", "sleeping", "dragging", "click", "greeting", "latenight", "morning", "clickSpam", "longAbsence", "feeding", "hungry", "petting"];
    const type = validTypes.includes(speechType) ? speechType : "idle";
    
    // 커스텀 대사가 있으면 우선 사용
    const customSpeeches = state.settings.customSpeeches?.[type];
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
export function showStateSpeech(speechType) {
    const speech = getRandomSpeech(speechType);
    showSpeechBubble(speech);
}
