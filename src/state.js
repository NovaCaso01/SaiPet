/**
 * SaiPet - 상태 관리
 */

import { EXTENSION_NAME } from "./constants.js";

// 전역 상태
export const state = {
    settings: null,
    petElement: null,
    bubbleElement: null,
    currentState: "idle",
    isDragging: false,
    idleTimer: null,
    sleepTimer: null,
    bubbleTimer: null,
    isGenerating: false,
    isPetGenerating: false,  // 펫 자체 API 호출 중인지
    isReady: false,          // 초기 로딩 완료 여부
    isMobile: false,         // 모바일 여부 (자동 감지)
    isPrioritySpeech: false, // API 응답 말풍선 우선순위 잠금
    cleanupMobileDetect: null, // 모바일 감지 리스너 정리 함수
    cleanupDragEvents: null,   // 메인 펫 드래그 리스너 정리 함수
    _cleanupSecondPetDrag: null, // 2번째 펫 드래그 리스너 정리 함수
    _isWalkingSprite: false,   // 메인 펫 걷기 스프라이트 표시 중
    _lastInteractionTime: null, // 마지막 상호작용 시간
    hasShownTimeGreeting: false, // 이번 세션에서 시간대 인사를 이미 했는지
    // 멀티펫 (2번째 펫) 런타임 상태
    secondPet: {
        petElement: null,
        bubbleElement: null,
        currentState: "idle",
        isPetGenerating: false,
        isPrioritySpeech: false,
        bubbleTimer: null,
        _isWalkingSprite: false,
    },
};

/**
 * 로그 출력
 * @param  {...any} args 
 */
export function log(...args) {
    console.log(`[${EXTENSION_NAME}]`, ...args);
}

/**
 * 에러 로그
 * @param  {...any} args 
 */
export function logError(...args) {
    console.error(`[${EXTENSION_NAME}]`, ...args);
}
