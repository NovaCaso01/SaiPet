/**
 * SaiPet - 애니메이션 관리
 */

import { state, log } from "./state.js";
import { DEFAULT_SPRITES, MOOD_STATES } from "./constants.js";
import { updatePetSprite } from "./pet-core.js";

// 애니메이션 상태 (re-export)
export const PET_STATES = MOOD_STATES;

/**
 * 현재 스프라이트 가져오기
 * @returns {string}
 */
export function getCurrentSprite() {
    const { customSprites } = state.settings.appearance;
    const currentState = state.currentState || PET_STATES.IDLE;
    
    // 커스텀 이미지가 하나라도 설정되어 있는지 확인
    const hasAnyCustom = Object.values(customSprites).some(v => v);
    
    // 커스텀 스프라이트 우선 (해당 상태에 이미지가 있으면)
    if (customSprites[currentState]) {
        return customSprites[currentState];
    }
    
    // 커스텀 이미지가 하나라도 있으면 → idle 커스텀으로 대체 (이모지 안 씀)
    if (hasAnyCustom && customSprites.idle) {
        return customSprites.idle;
    }
    
    // 커스텀 이미지가 전부 비어있을 때만 기본 이모지
    return DEFAULT_SPRITES[currentState] || DEFAULT_SPRITES.idle;
}

/**
 * 상태 변경
 * @param {string} newState - 새 상태
 * @param {number|null} duration - 지속 시간 (ms), null이면 영구
 */
export function setState(newState, duration = null) {
    const prevState = state.currentState;
    state.currentState = newState;
    
    log(`State: ${prevState} -> ${newState}`);
    
    // 스프라이트 업데이트
    updatePetSprite();
    
    // 애니메이션 클래스 적용
    applyStateAnimation(newState);
    
    // 지속 시간 후 idle로 복귀
    if (duration !== null) {
        setTimeout(() => {
            if (state.currentState === newState) {
                setState(PET_STATES.IDLE);
            }
        }, duration);
    }
}

/**
 * 상태별 애니메이션 클래스 적용
 * @param {string} petState 
 */
function applyStateAnimation(petState) {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    // 기존 상태 클래스 제거
    Object.values(PET_STATES).forEach(s => {
        container.classList.remove(`state-${s}`);
    });
    
    // 새 상태 클래스 추가
    container.classList.add(`state-${petState}`);
}

/**
 * 간단한 바운스 애니메이션
 */
export function playBounce() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    container.classList.add("bounce");
    setTimeout(() => {
        container.classList.remove("bounce");
    }, 500);
}

/**
 * 간단한 흔들림 애니메이션
 */
export function playShake() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    container.classList.add("shake");
    setTimeout(() => {
        container.classList.remove("shake");
    }, 500);
}

/**
 * 하트 파티클 애니메이션 (쓰다듬기 시)
 */
export function playHearts() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const wrapper = container.querySelector(".st-pet-wrapper");
    if (!wrapper) return;
    
    const hearts = ["❤", "💕", "💖", "🩷", "♥"];
    const count = 4 + Math.floor(Math.random() * 3); // 4~6개
    
    for (let i = 0; i < count; i++) {
        const heart = document.createElement("span");
        heart.className = "st-pet-heart-particle";
        heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
        
        // 랜덤 위치 + 크기 + 애니메이션 딜레이
        heart.style.setProperty("--h-x", `${(Math.random() - 0.5) * 80}px`);
        heart.style.setProperty("--h-delay", `${i * 0.1}s`);
        heart.style.fontSize = `${12 + Math.random() * 10}px`;
        
        wrapper.appendChild(heart);
        
        // 애니메이션 끝나면 제거
        setTimeout(() => heart.remove(), 1200);
    }
}

/**
 * 졸기 zzZ 이펙트 표시
 */
export function showSleepZzz() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    // 이미 있으면 스킵
    if (container.querySelector(".st-pet-zzz")) return;
    
    const wrapper = container.querySelector(".st-pet-wrapper");
    if (!wrapper) return;
    
    const zzz = document.createElement("div");
    zzz.className = "st-pet-zzz";
    zzz.innerHTML = `<span class="zzz-1">z</span><span class="zzz-2">z</span><span class="zzz-3">Z</span>`;
    wrapper.appendChild(zzz);
}

/**
 * 졸기 zzZ 이펙트 제거
 */
export function hideSleepZzz() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const zzz = container.querySelector(".st-pet-zzz");
    if (zzz) zzz.remove();
}
