/**
 * SaiPet - 메인 진입점
 * 채팅창에 귀여운 가상 펫을 표시하고, 대화 상황에 맞게 반응합니다.
 */

import { extension_settings } from "../../../extensions.js";

import { DEFAULT_SETTINGS, EXTENSION_NAME } from "./src/constants.js";
import { state, log } from "./src/state.js";
import { createUI } from "./src/ui.js";
import { createPetContainer, removePetContainer, clampPetPosition, createSecondPetContainer, removeSecondPetContainer } from "./src/pet-core.js";
import { initReactions, destroyReactions } from "./src/pet-reactions.js";

/**
 * 모바일 감지 (UserAgent + 터치 전용)
 * 태블릿은 모바일로 취급하지 않음 (iPad, Android 태블릿 등)
 * @returns {boolean}
 */
function detectMobile() {
    const ua = navigator.userAgent || "";
    
    // 태블릿 감지 (태블릿은 활성화 유지)
    const isTablet = /iPad/i.test(ua)
        || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)  // iPadOS 13+ (UA에 "Macintosh" 포함)
        || (/Android/i.test(ua) && !/Mobile/i.test(ua));  // Android 태블릿 (Mobile 키워드 없음)
    
    if (isTablet) return false;
    
    // 스마트폰만 감지 (UA 기반 — 터치+화면크기 조합은 태블릿 세로모드 오탐 위험)
    const isMobileUA = /Android.*Mobile|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    
    return isMobileUA;
}

/**
 * 모바일/PC 전환 처리
 */
function handleDeviceChange() {
    const wasMobile = state.isMobile;
    state.isMobile = detectMobile();
    
    if (wasMobile === state.isMobile) return; // 변화 없으면 무시
    
    log(`Device changed: ${wasMobile ? 'mobile' : 'PC'} -> ${state.isMobile ? 'mobile' : 'PC'}`);
    
    // 모바일 알림 UI 업데이트
    const notice = document.getElementById("stvp-mobile-notice");
    if (notice) {
        notice.style.display = state.isMobile ? "block" : "none";
    }
    
    if (state.isMobile) {
        // 모바일로 전환 → 펫 숨기기 + 이벤트 해제
        removeSecondPetContainer();
        removePetContainer();
        destroyReactions();
        log("Pet disabled (mobile detected)");
    } else {
        // PC로 전환 → 설정이 ON이면 펫 다시 활성화
        if (state.settings.enabled) {
            createPetContainer();
            initReactions();
            
            if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
                createSecondPetContainer();
            }
            log("Pet re-enabled (PC detected)");
        }
    }
}

/**
 * 모바일 감지 리스너 등록
 */
function setupMobileDetection() {
    let resizeDebounce = null;
    const onResize = () => {
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
            handleDeviceChange();
            clampPetPosition();
            clampPetPosition("secondary");
        }, 200);
    };
    window.addEventListener("resize", onResize);
    
    // 정리 함수 저장
    state.cleanupMobileDetect = () => {
        window.removeEventListener("resize", onResize);
    };
}

// jQuery 로드 대기
jQuery(async () => {
    // 설정 초기화
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = structuredClone(DEFAULT_SETTINGS);
    }

    // 설정 병합 (새 설정 항목 추가 대응)
    mergeSettings(extension_settings[EXTENSION_NAME], DEFAULT_SETTINGS);

    // personalMemo(구) → personalMemos(신) 마이그레이션
    const p = extension_settings[EXTENSION_NAME].personality;
    if (p?.personalMemo && typeof p.personalMemo === "string" && p.personalMemo.trim()) {
        if (!p.personalMemos || !Array.isArray(p.personalMemos)) p.personalMemos = [];
        p.personalMemos.push({ tag: "기타", content: p.personalMemo.trim() });
        delete p.personalMemo;
    } else if (p) {
        delete p.personalMemo;
    }

    state.settings = extension_settings[EXTENSION_NAME];

    // UI 생성
    await createUI();

    // 모바일 감지
    state.isMobile = detectMobile();
    setupMobileDetection();

    // 펫 초기화 (모바일이면 비활성화)
    if (state.settings.enabled && !state.isMobile) {
        createPetContainer();
        initReactions();
        
        // 멀티펫: 2번째 펫이 설정되어 있으면 함께 초기화
        if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
            createSecondPetContainer();
        }
    }

    if (state.isMobile) {
        log("Extension loaded (mobile detected - pet disabled)");
    } else {
        log("Extension loaded successfully!");
    }
});

/**
 * 설정 병합 (깊은 병합)
 * @param {Object} target - 대상 설정
 * @param {Object} defaults - 기본값
 */
function mergeSettings(target, defaults) {
    for (const key in defaults) {
        if (defaults.hasOwnProperty(key)) {
            if (target[key] === undefined) {
                target[key] = structuredClone(defaults[key]);
            } else if (
                typeof defaults[key] === "object" &&
                defaults[key] !== null &&
                !Array.isArray(defaults[key])
            ) {
                mergeSettings(target[key], defaults[key]);
            }
        }
    }
}
