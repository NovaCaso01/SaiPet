/**
 * SaiPet - 펫 코어 (DOM 생성, 위치, 드래그, 걷기)
 */

import { state, log } from "./state.js";
import { saveSettings } from "./storage.js";
import { getCurrentSprite, PET_STATES } from "./pet-animation.js";
import { EXTENSION_BASE_PATH, DEFAULT_WALK_SPRITE, COLLISION_SPEECHES, POSITION_PRESETS } from "./constants.js";

/**
 * 펫 컨테이너 생성
 */
export function createPetContainer() {
    // 기존 요소 제거
    removePetContainer();
    
    const container = document.createElement("div");
    container.id = "saipet-container";
    const design = state.settings.speechBubble?.design || "simple";
    container.setAttribute("data-design", design);
    container.innerHTML = `
        <div class="st-pet-wrapper">
            <div class="st-pet-sprite"></div>
            <div class="st-pet-bubble" style="display:none;">
                <span class="st-pet-bubble-text"></span>
            </div>
            <div class="st-pet-condition-row">
                <button class="st-pet-feed-btn" title="밥주기"><i class="fa-solid fa-drumstick-bite"></i></button>
                <div class="st-pet-hunger-bar">
                    <div class="st-pet-hunger-fill" style="width: 100%;"></div>
                </div>
                <button class="st-pet-chat-btn" title="말 걸기"><i class="fa-solid fa-comment-dots"></i></button>
            </div>
            <div class="st-pet-chat-input" style="display:none;">
                <input type="text" class="st-pet-chat-text" placeholder="" maxlength="100">
            </div>
        </div>
    `;
    
    document.body.appendChild(container);
    
    state.petElement = container.querySelector(".st-pet-sprite");
    state.bubbleElement = container.querySelector(".st-pet-bubble");
    
    // 초기 위치 설정
    updatePetPosition();
    
    // 초기 스프라이트 설정
    updatePetSprite();
    
    // 드래그 이벤트 설정
    if (state.settings.position.draggable) {
        setupDragEvents(container);
    }
    
    // 크기 설정
    updatePetSize();
    
    // 투명도 설정
    updatePetOpacity();
    
    // 디자인 테마 적용
    applyDesignTheme();
    
    // 걷기 시작
    if (state.settings.walk?.enabled) {
        // 약간의 딜레이 후 시작 (초기화 완료 대기)
        setTimeout(() => startWalking(), 3000);
    }
    
    // 밥주기 버튼 이벤트
    const feedBtn = container.querySelector(".st-pet-feed-btn");
    if (feedBtn) {
        feedBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            import("./pet-reactions.js").then(({ feedPet }) => {
                feedPet();
            });
        });
    }
    
    // 말걸기 버튼 이벤트
    const chatBtn = container.querySelector(".st-pet-chat-btn");
    if (chatBtn) {
        chatBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleChatInput();
        });
    }
    
    // 초기 배고픔 게이지 설정
    const hungerFill = container.querySelector(".st-pet-hunger-fill");
    if (hungerFill) {
        const hunger = state.settings.condition?.hunger ?? 100;
        hungerFill.style.width = `${hunger}%`;
    }
    
    log("Pet container created");
}

/**
 * 펫 컨테이너 제거
 */
export function removePetContainer() {
    // 걷기 중지
    stopWalking();
    
    // 드래그 이벤트 정리
    if (state.cleanupDragEvents) {
        state.cleanupDragEvents();
        state.cleanupDragEvents = null;
    }
    
    const existing = document.getElementById("saipet-container");
    if (existing) {
        existing.remove();
    }
    state.petElement = null;
    state.bubbleElement = null;
}

/**
 * 펫 위치 업데이트
 */
export function updatePetPosition() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const { location, customX, customY } = state.settings.position;
    
    // 커스텀 위치가 있으면 사용
    if (customX !== null && customY !== null) {
        container.style.left = `${customX}px`;
        container.style.top = `${customY}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
        return;
    }
    
    // 프리셋 위치 적용
    container.style.left = "auto";
    container.style.top = "auto";
    container.style.right = "auto";
    container.style.bottom = "auto";
    
    switch (location) {
        case "top-left":
            container.style.left = "20px";
            container.style.top = "20px";
            break;
        case "top-right":
            container.style.right = "20px";
            container.style.top = "20px";
            break;
        case "bottom-left":
            container.style.left = "20px";
            container.style.bottom = "20px";
            break;
        case "bottom-right":
        default:
            container.style.right = "20px";
            container.style.bottom = "20px";
            break;
    }
}

/**
 * 펫 크기 업데이트
 */
export function updatePetSize() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const size = state.settings.appearance.size;
    container.style.setProperty("--pet-size", `${size}px`);
}

/**
 * 펫 투명도 업데이트
 */
export function updatePetOpacity() {
    const opacity = (state.settings.appearance.opacity ?? 100) / 100;
    const container = document.getElementById("saipet-container");
    if (container) container.style.opacity = opacity;
    // 공통 설정: 2번째 펫에도 동일 투명도 적용
    const container2 = document.getElementById("saipet-container-2");
    if (container2) container2.style.opacity = opacity;
}

/**
 * 펫 스프라이트 업데이트
 */
export function updatePetSprite() {
    if (!state.petElement) return;
    
    const sprite = getCurrentSprite();
    
    // 이미지인지 판단 (data:, http, 또는 파일 경로)
    const isImage = sprite && (
        sprite.startsWith("data:") || 
        sprite.startsWith("http") || 
        sprite.endsWith(".png") || 
        sprite.endsWith(".gif") || 
        sprite.endsWith(".webp") ||
        sprite.endsWith(".jpg") ||
        sprite.endsWith(".jpeg")
    );
    
    if (isImage) {
        // 상대 경로면 확장 폴더 기준으로 변환
        let imgSrc = sprite;
        if (!sprite.startsWith("data:") && !sprite.startsWith("http")) {
            // 확장 폴더 경로 가져오기 (대소문자 무관)
            const extensionPath = `${EXTENSION_BASE_PATH}${sprite}`;
            imgSrc = extensionPath;
        }
        state.petElement.innerHTML = `<img src="${imgSrc}" alt="pet" draggable="false">`;
        state.petElement.classList.add("has-image");
    } else {
        // 이모지 또는 텍스트
        state.petElement.innerHTML = sprite || "🐱";
        state.petElement.classList.remove("has-image");
    }
    
    // 좌우 반전
    if (state.settings.appearance.flipHorizontal) {
        state.petElement.classList.add("flipped");
    } else {
        state.petElement.classList.remove("flipped");
    }
}

/**
 * 드래그 이벤트 설정 (PC + 모바일)
 */
function setupDragEvents(container) {
    let startX, startY, initialX, initialY;
    let hasMoved = false; // 클릭/드래그 구분용
    let isPointerDown = false;
    let clickCount = 0;
    let clickResetTimer = null;
    let holdTimer = null;
    let didTriggerPetting = false;
    
    // 포인터 다운
    function onDragStart(e) {
        // 컨디션 행 내 버튼(밥주기/말걸기) 및 채팅 입력창 클릭은 무시
        const target = e.target;
        if (target.closest && (target.closest(".st-pet-condition-row") || target.closest(".st-pet-chat-input"))) {
            return;
        }
        
        isPointerDown = true;
        hasMoved = false;
        didTriggerPetting = false;
        
        const event = e.type.includes("touch") ? e.touches[0] : e;
        startX = event.clientX;
        startY = event.clientY;
        
        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        // 길게 누르기 감지 (800ms) — thinking 중에는 무시
        holdTimer = setTimeout(() => {
            if (isPointerDown && !hasMoved && !state.isPetGenerating && state.currentState !== "thinking") {
                didTriggerPetting = true;
                import("./pet-reactions.js").then(({ triggerReaction }) => {
                    triggerReaction("petting");
                });
            }
        }, 800);
        
        e.preventDefault();
    }
    
    // 드래그 중
    function onDragMove(e) {
        if (!isPointerDown) return;
        
        const event = e.type.includes("touch") ? e.touches[0] : e;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // 5px 이상 이동해야 드래그로 판정
        if (!hasMoved && distance >= 5) {
            // 이동 시작하면 홀드 타이머 해제
            clearTimeout(holdTimer);
            holdTimer = null;
            if (!state.settings.position.draggable) return;
            hasMoved = true;
            state.isDragging = true;
            container.classList.add("dragging");
            
            // 드래그 반응 트리거 (AI 생성 중이면 무시)
            if (state.settings.reactions.onInteraction && !state.isPetGenerating) {
                import("./pet-reactions.js").then(({ triggerReaction }) => {
                    triggerReaction("dragging");
                });
            }
        }
        
        if (!hasMoved) return;
        
        let newX = initialX + deltaX;
        let newY = initialY + deltaY;
        
        // 화면 경계 체크
        const maxX = window.innerWidth - container.offsetWidth;
        const maxY = window.innerHeight - container.offsetHeight;
        
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        container.style.left = `${newX}px`;
        container.style.top = `${newY}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
        
        e.preventDefault();
    }
    
    // 포인터 업
    function onDragEnd(e) {
        if (!isPointerDown) return;
        isPointerDown = false;
        
        // 홀드 타이머 해제
        clearTimeout(holdTimer);
        holdTimer = null;
        
        if (hasMoved) {
            // 드래그 종료
            state.isDragging = false;
            container.classList.remove("dragging");
            
            const rect = container.getBoundingClientRect();
            state.settings.position.customX = rect.left;
            state.settings.position.customY = rect.top;
            saveSettings();
            
            // 걷기 기준점 갱신 (드래그한 위치를 새 기준으로)
            resetWalkOrigin();            
            // 충돌 감지
            checkAndResolvePetCollision("primary");            
            // 드래그 상태 해제 → idle 복귀 (AI 생성 중이면 thinking 유지)
            import("./pet-animation.js").then(({ setState, PET_STATES }) => {
                if (state.currentState === PET_STATES.DRAGGING) {
                    setState(state.isPetGenerating ? PET_STATES.THINKING : PET_STATES.IDLE);
                }
            });
        } else {
            // 쓰다듬기가 이미 발동되었으면 클릭 무시
            if (didTriggerPetting) return;
            
            // 클릭으로 판정
            clickCount++;
            clearTimeout(clickResetTimer);
            clickResetTimer = setTimeout(() => { clickCount = 0; }, 1500);
            
            // AI 생성 중(thinking)이면 클릭 반응 무시
            if (!state.isPetGenerating && state.currentState !== "thinking") {
                import("./pet-reactions.js").then(({ triggerReaction }) => {
                    if (clickCount >= 5) {
                        clickCount = 0;
                        triggerReaction("clickSpam");
                    } else {
                        triggerReaction("click");
                    }
                });
            }
        }
    }
    
    // PC 마우스 이벤트
    container.addEventListener("mousedown", onDragStart);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    
    // 모바일 터치 이벤트
    container.addEventListener("touchstart", onDragStart, { passive: false });
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
    
    // 정리 함수 저장 (메모리 누수 방지)
    state.cleanupDragEvents = () => {
        container.removeEventListener("mousedown", onDragStart);
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        container.removeEventListener("touchstart", onDragStart);
        document.removeEventListener("touchmove", onDragMove);
        document.removeEventListener("touchend", onDragEnd);
    };
}

/**
 * 펫 표시/숨김
 */
export function setPetVisibility(visible) {
    const container = document.getElementById("saipet-container");
    if (container) {
        container.style.display = visible ? "block" : "none";
    }
}

/**
 * 말걸기 입력창 토글
 */
function toggleChatInput() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const chatInput = container.querySelector(".st-pet-chat-input");
    const textInput = container.querySelector(".st-pet-chat-text");
    if (!chatInput || !textInput) return;
    
    const isVisible = chatInput.style.display !== "none";
    
    if (isVisible) {
        chatInput.style.display = "none";
        textInput.value = "";
    } else {
        if (!state.settings.personality.enabled) {
            import("./pet-speech.js").then(({ showSpeechBubble }) => {
                showSpeechBubble("'AI 반응 사용'을 켜야 말할 수 있어!");
            });
            return;
        }
        chatInput.style.display = "flex";
        textInput.focus();
        
        // Enter 키 핸들러 (중복 방지)
        if (!textInput._hasEnterHandler) {
            textInput._hasEnterHandler = true;
            textInput.addEventListener("keydown", async (e) => {
                if (e.key === "Enter" && textInput.value.trim()) {
                    const userText = textInput.value.trim();
                    chatInput.style.display = "none";
                    textInput.value = "";
                    
                    import("./pet-ai.js").then(async ({ talkToPet }) => {
                        await talkToPet(userText);
                    });
                }
                if (e.key === "Escape") {
                    chatInput.style.display = "none";
                    textInput.value = "";
                }
            });
            // 외부 클릭 시 닫기
            document.addEventListener("click", (e) => {
                if (!container.contains(e.target) && chatInput.style.display !== "none") {
                    chatInput.style.display = "none";
                    textInput.value = "";
                }
            });
        }
    }
}

/**
 * 위치 초기화
 */
export function resetPetPosition() {
    state.settings.position.customX = null;
    state.settings.position.customY = null;
    saveSettings();
    updatePetPosition();
}

/**
 * 펫 위치 보정 (화면 밖으로 나가지 않도록)
 * 브라우저 창 크기가 줄어들 때 호출
 */
export function clampPetPosition(petId = "primary") {
    const isSecond = petId === "secondary";
    const containerId = isSecond ? "saipet-container-2" : "saipet-container";
    const container = document.getElementById(containerId);
    if (!container) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;

    const posSettings = isSecond ? state.settings.multiPet?.secondPetPosition : state.settings.position;
    if (!posSettings) return;

    // 프리셋 위치(right/bottom 기반)도 화면이 좁으면 잘릴 수 있으므로 보정
    if (posSettings.customX === null && posSettings.customY === null) {
        // 프리셋 위치: right/bottom 기반이라 보통 괜찮지만
        // 펫이 뷰포트보다 클 경우 left:0으로 보정
        const rect = container.getBoundingClientRect();
        if (rect.left < 0) {
            container.style.left = "0px";
            container.style.right = "auto";
        }
        if (rect.top < 0) {
            container.style.top = "0px";
            container.style.bottom = "auto";
        }
        return;
    }

    const maxX = Math.max(0, vw - cw);
    const maxY = Math.max(0, vh - ch);

    let x = posSettings.customX;
    let y = posSettings.customY;
    let changed = false;

    if (x > maxX) { x = maxX; changed = true; }
    if (y > maxY) { y = maxY; changed = true; }
    if (x < 0) { x = 0; changed = true; }
    if (y < 0) { y = 0; changed = true; }

    if (changed) {
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        posSettings.customX = x;
        posSettings.customY = y;
        saveSettings();
    }
}

/**
 * 디자인 테마 적용
 */
export function applyDesignTheme() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    const { design, backgroundColor, textColor, accentColor, font, maxWidth } = state.settings.speechBubble;
    container.setAttribute("data-design", design || "simple");
    container.style.setProperty("--spc-bubble-bg", backgroundColor);
    container.style.setProperty("--spc-bubble-text", textColor);
    container.style.setProperty("--spc-accent", accentColor || "#7c9bff");
    container.style.setProperty("--bubble-bg-color", backgroundColor);
    container.style.setProperty("--spc-bubble-max-w", `${maxWidth || 360}px`);
    
    // 커스텀 폰트 적용
    if (font && font !== "default") {
        container.setAttribute("data-custom-font", "");
        container.style.setProperty("--spc-font", `'${font}', sans-serif`);
    } else {
        container.removeAttribute("data-custom-font");
        container.style.removeProperty("--spc-font");
    }
}

// ===== 걷기 시스템 =====

let walkTimer = null;
let walkTransitionTimer = null; // 이동 중 transition 타이머
let walkOriginX = null;  // 걷기 시작 기준 위치
let walkOriginY = null;
const WALK_RANGE = 250;  // 기준 위치에서 ±250px
const WALK_MOVE_MIN = 30000; // 정지 후 다음 이동까지 최소 대기 (30초)
const WALK_MOVE_MAX = 90000; // 정지 후 다음 이동까지 최대 대기 (1분 30초)

/**
 * 걷기 시작
 */
export function startWalking() {
    stopWalking();
    
    if (!state.settings.walk?.enabled) return;
    
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    // 현재 위치를 기준점으로 저장
    const rect = container.getBoundingClientRect();
    walkOriginX = rect.left;
    walkOriginY = rect.top;
    
    log("Walking started");
    scheduleNextWalk();
}

/**
 * 걷기 중지
 */
export function stopWalking() {
    if (walkTimer) {
        clearTimeout(walkTimer);
        walkTimer = null;
    }
    if (walkTransitionTimer) {
        clearTimeout(walkTransitionTimer);
        walkTransitionTimer = null;
    }
    
    const container = document.getElementById("saipet-container");
    if (container) {
        container.classList.remove("walking");
        // 걷기 스프라이트 → 원래 스프라이트로 복원
        if (state._isWalkingSprite) {
            state._isWalkingSprite = false;
            updatePetSprite();
        }
    }
}

/**
 * 다음 걷기 스케줄
 */
function scheduleNextWalk() {
    const delay = WALK_MOVE_MIN + Math.random() * (WALK_MOVE_MAX - WALK_MOVE_MIN);
    
    walkTimer = setTimeout(() => {
        doWalkStep();
    }, delay);
}

/**
 * 걷기 한 스텝 실행
 */
function doWalkStep() {
    const container = document.getElementById("saipet-container");
    if (!container) return;
    
    // 잠자기/드래그/생성 중/thinking이면 스킵
    if (state.currentState === PET_STATES.SLEEPING || 
        state.currentState === PET_STATES.DRAGGING ||
        state.isDragging ||
        state.isGenerating || 
        state.isPetGenerating) {
        // 걷기 스프라이트 해제
        if (state._isWalkingSprite) {
            state._isWalkingSprite = false;
            container.classList.remove("walking");
            updatePetSprite();
        }
        scheduleNextWalk();
        return;
    }
    
    // 걷기 이미지 적용 (커스텀 > 기본 순서)
    const walkSprite = state.settings.walk?.walkSprite || DEFAULT_WALK_SPRITE;
    if (walkSprite) {
        state._isWalkingSprite = true;
        applyWalkSprite(walkSprite);
    }
    
    // walking 클래스 추가 (CSS transition + waddle animation)
    container.classList.add("walking");
    
    // 이동 목표 계산 (기준점 ±WALK_RANGE, 화면 안)
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;
    
    // 현재 위치
    const currentRect = container.getBoundingClientRect();
    
    // 기준점이 없거나 드래그로 옮겨졌으면 현재 위치를 기준점으로 갱신
    if (walkOriginX === null) walkOriginX = currentRect.left;
    if (walkOriginY === null) walkOriginY = currentRect.top;
    
    // 랜덤 목표 (기준점 기준 ±WALK_RANGE)
    const targetX = walkOriginX + (Math.random() - 0.5) * 2 * WALK_RANGE;
    const targetY = walkOriginY + (Math.random() - 0.5) * 2 * (WALK_RANGE * 0.3); // Y는 범위 작게
    
    // 화면 경계 clamp
    const clampedX = Math.max(0, Math.min(targetX, vw - cw));
    const clampedY = Math.max(0, Math.min(targetY, vh - ch));
    
    // 이동 방향에 따라 좌우 반전 (걷는 방향 바라보기)
    const movingLeft = clampedX < currentRect.left;
    const sprite = container.querySelector(".st-pet-sprite");
    if (sprite) {
        // 기본 방향: 오른쪽 바라봄. 왼쪽으로 이동 시 flip
        const userFlip = state.settings.appearance.flipHorizontal;
        if (movingLeft) {
            sprite.classList.toggle("flipped", !userFlip);
        } else {
            sprite.classList.toggle("flipped", userFlip);
        }
    }
    
    // CSS transition으로 부드러운 이동
    container.style.left = `${clampedX}px`;
    container.style.top = `${clampedY}px`;
    container.style.right = "auto";
    container.style.bottom = "auto";
    
    // 이동 완료 후 (transition 시간 2.5s) → 멈추기
    walkTransitionTimer = setTimeout(() => {
        walkTransitionTimer = null;
        
        const c = document.getElementById("saipet-container");
        if (!c) return;
        
        c.classList.remove("walking");
        
        // 걷기 스프라이트 → 원래로 복원
        if (state._isWalkingSprite) {
            state._isWalkingSprite = false;
            updatePetSprite();
        }
        
        // 원래 flip 상태로 복원
        const sp = c.querySelector(".st-pet-sprite");
        if (sp) {
            sp.classList.toggle("flipped", state.settings.appearance.flipHorizontal);
        }
        
        // 위치 저장
        state.settings.position.customX = clampedX;
        state.settings.position.customY = clampedY;
        saveSettings();
        
        // 충돌 감지
        checkAndResolvePetCollision("primary");
        
        // 다음 걸음 예약
        if (state.settings.walk?.enabled) {
            scheduleNextWalk();
        }
    }, 2700); // CSS transition 2.5s + 약간의 여유
}

/**
 * 걷기 스프라이트 적용
 */
function applyWalkSprite(spriteData) {
    if (!state.petElement) return;
    
    const isImage = spriteData && (
        spriteData.startsWith("data:") || 
        spriteData.startsWith("http") || 
        spriteData.endsWith(".png") || 
        spriteData.endsWith(".gif") || 
        spriteData.endsWith(".webp") ||
        spriteData.endsWith(".jpg") ||
        spriteData.endsWith(".jpeg")
    );
    
    if (isImage) {
        let imgSrc = spriteData;
        if (!spriteData.startsWith("data:") && !spriteData.startsWith("http")) {
            imgSrc = `${EXTENSION_BASE_PATH}${spriteData}`;
        }
        state.petElement.innerHTML = `<img src="${imgSrc}" alt="pet-walk" draggable="false">`;
        state.petElement.classList.add("has-image");
    }
}

/**
 * 걷기 기준점 리셋 (드래그 후 호출)
 */
export function resetWalkOrigin() {
    const container = document.getElementById("saipet-container");
    if (container) {
        const rect = container.getBoundingClientRect();
        walkOriginX = rect.left;
        walkOriginY = rect.top;
    }
}

// ===== 멀티펫 (2번째 펫) =====

/**
 * 2번째 펫 컨테이너 생성
 */
export function createSecondPetContainer() {
    removeSecondPetContainer();
    
    const spd = state.settings.multiPet?.secondPetData;
    if (!spd) return;
    
    const container = document.createElement("div");
    container.id = "saipet-container-2";
    const design = spd.speechBubble?.design || state.settings.speechBubble?.design || "simple";
    container.setAttribute("data-design", design);
    container.innerHTML = `
        <div class="st-pet-wrapper">
            <div class="st-pet-sprite"></div>
            <div class="st-pet-bubble" style="display:none;">
                <span class="st-pet-bubble-text"></span>
            </div>
            <div class="st-pet-condition-row">
                <button class="st-pet-feed-btn" title="밥주기"><i class="fa-solid fa-drumstick-bite"></i></button>
                <div class="st-pet-hunger-bar">
                    <div class="st-pet-hunger-fill" style="width: 100%;"></div>
                </div>
                <button class="st-pet-chat-btn" title="말 걸기"><i class="fa-solid fa-comment-dots"></i></button>
            </div>
            <div class="st-pet-chat-input" style="display:none;">
                <input type="text" class="st-pet-chat-text" placeholder="" maxlength="100">
            </div>
        </div>
    `;
    
    document.body.appendChild(container);
    
    state.secondPet.petElement = container.querySelector(".st-pet-sprite");
    state.secondPet.bubbleElement = container.querySelector(".st-pet-bubble");
    
    updateSecondPetPosition();
    updateSecondPetSprite();
    updateSecondPetSize();
    updateSecondPetOpacity();
    applySecondPetDesignTheme();
    setupSecondPetDragEvents(container);
    
    const walkEnabled = spd.walk?.enabled ?? state.settings.walk?.enabled;
    if (walkEnabled) {
        setTimeout(() => startSecondPetWalking(), 4000);
    }
    
    // 밥주기 버튼
    const feedBtn = container.querySelector(".st-pet-feed-btn");
    if (feedBtn) {
        feedBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            import("./pet-reactions.js").then(({ feedSecondPet }) => feedSecondPet());
        });
    }
    
    // 말걸기 버튼
    const chatBtn = container.querySelector(".st-pet-chat-btn");
    if (chatBtn) {
        chatBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleSecondPetChatInput();
        });
    }
    
    // 배고픔 게이지
    const hungerFill = container.querySelector(".st-pet-hunger-fill");
    if (hungerFill) {
        const hunger = state.settings.multiPet?.secondPetCondition?.hunger ?? 100;
        hungerFill.style.width = `${hunger}%`;
    }
    
    log("Second pet container created");
}

/**
 * 2번째 펫 컨테이너 제거
 */
export function removeSecondPetContainer() {
    stopSecondPetWalking();
    
    if (state._cleanupSecondPetDrag) {
        state._cleanupSecondPetDrag();
        state._cleanupSecondPetDrag = null;
    }
    
    const existing = document.getElementById("saipet-container-2");
    if (existing) existing.remove();
    
    state.secondPet.petElement = null;
    state.secondPet.bubbleElement = null;
    state.secondPet.currentState = "idle";
}

/**
 * 2번째 펫 스프라이트 업데이트
 */
export function updateSecondPetSprite() {
    if (!state.secondPet.petElement) return;
    
    const sprite = getCurrentSprite("secondary");
    const isImage = sprite && (
        sprite.startsWith("data:") || sprite.startsWith("http") ||
        sprite.endsWith(".png") || sprite.endsWith(".gif") ||
        sprite.endsWith(".webp") || sprite.endsWith(".jpg") || sprite.endsWith(".jpeg")
    );
    
    if (isImage) {
        let imgSrc = sprite;
        if (!sprite.startsWith("data:") && !sprite.startsWith("http")) {
            imgSrc = `${EXTENSION_BASE_PATH}${sprite}`;
        }
        state.secondPet.petElement.innerHTML = `<img src="${imgSrc}" alt="pet2" draggable="false">`;
        state.secondPet.petElement.classList.add("has-image");
    } else {
        state.secondPet.petElement.innerHTML = sprite || "🐱";
        state.secondPet.petElement.classList.remove("has-image");
    }
    
    const spd = state.settings.multiPet?.secondPetData;
    if (spd?.appearance?.flipHorizontal) {
        state.secondPet.petElement.classList.add("flipped");
    } else {
        state.secondPet.petElement.classList.remove("flipped");
    }
}

/**
 * 2번째 펫 위치 업데이트
 */
export function updateSecondPetPosition() {
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    
    const pos = state.settings.multiPet?.secondPetPosition;
    if (pos?.customX != null && pos?.customY != null) {
        container.style.left = `${pos.customX}px`;
        container.style.top = `${pos.customY}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
        return;
    }
    
    // 프리셋 사용 (settings에 저장된 location, 없으면 메인 펫 반대쪽)
    let loc = pos?.location;
    if (!loc) {
        const mainLoc = state.settings.position.location || "bottom-right";
        const opposites = { "top-left": "top-right", "top-right": "top-left", "bottom-left": "bottom-right", "bottom-right": "bottom-left" };
        loc = opposites[mainLoc] || "bottom-left";
    }
    
    const preset = POSITION_PRESETS[loc];
    container.style.left = "auto";
    container.style.top = "auto";
    container.style.right = "auto";
    container.style.bottom = "auto";
    
    if (preset) {
        if (preset.x != null) container.style.left = `${preset.x}px`;
        else container.style.right = "20px";
        if (preset.y != null) container.style.top = `${preset.y}px`;
        else container.style.bottom = "20px";
    } else {
        container.style.left = "20px";
        container.style.bottom = "20px";
    }
}

function updateSecondPetSize() {
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    const spd = state.settings.multiPet?.secondPetData;
    container.style.setProperty("--pet-size", `${spd?.appearance?.size || 250}px`);
}

function updateSecondPetOpacity() {
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    const spd = state.settings.multiPet?.secondPetData;
    container.style.opacity = (spd?.appearance?.opacity ?? 100) / 100;
}

function applySecondPetDesignTheme() {
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    
    const spd = state.settings.multiPet?.secondPetData;
    const sb = spd?.speechBubble || state.settings.speechBubble;
    const { design, backgroundColor, textColor, accentColor, font, maxWidth } = sb;
    container.setAttribute("data-design", design || "simple");
    container.style.setProperty("--spc-bubble-bg", backgroundColor);
    container.style.setProperty("--spc-bubble-text", textColor);
    container.style.setProperty("--spc-accent", accentColor || "#7c9bff");
    container.style.setProperty("--bubble-bg-color", backgroundColor);
    container.style.setProperty("--spc-bubble-max-w", `${maxWidth || 360}px`);
    
    if (font && font !== "default") {
        container.setAttribute("data-custom-font", "");
        container.style.setProperty("--spc-font", `'${font}', sans-serif`);
    } else {
        container.removeAttribute("data-custom-font");
        container.style.removeProperty("--spc-font");
    }
}

/**
 * 2번째 펫 말걸기 입력창 토글
 */
function toggleSecondPetChatInput() {
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    
    const chatInput = container.querySelector(".st-pet-chat-input");
    const textInput = container.querySelector(".st-pet-chat-text");
    if (!chatInput || !textInput) return;
    
    const isVisible = chatInput.style.display !== "none";
    
    if (isVisible) {
        chatInput.style.display = "none";
        textInput.value = "";
    } else {
        if (!state.settings.personality.enabled) {
            import("./pet-speech.js").then(({ showSpeechBubble }) => {
                showSpeechBubble("'AI 반응 사용'을 켜야 말할 수 있어!", null, false, "secondary");
            });
            return;
        }
        chatInput.style.display = "flex";
        textInput.focus();
        
        if (!textInput._hasEnterHandler) {
            textInput._hasEnterHandler = true;
            textInput.addEventListener("keydown", async (e) => {
                if (e.key === "Enter" && textInput.value.trim()) {
                    const userText = textInput.value.trim();
                    chatInput.style.display = "none";
                    textInput.value = "";
                    import("./pet-ai.js").then(async ({ talkToPet }) => {
                        await talkToPet(userText, "secondary");
                    });
                }
                if (e.key === "Escape") {
                    chatInput.style.display = "none";
                    textInput.value = "";
                }
            });
            document.addEventListener("click", (e) => {
                if (!container.contains(e.target) && chatInput.style.display !== "none") {
                    chatInput.style.display = "none";
                    textInput.value = "";
                }
            });
        }
    }
}

/**
 * 2번째 펫 드래그 이벤트 설정
 */
function setupSecondPetDragEvents(container) {
    let startX, startY, initialX, initialY;
    let hasMoved = false;
    let isPointerDown = false;
    let clickCount = 0;
    let clickResetTimer = null;
    let holdTimer = null;
    let didTriggerPetting = false;
    
    function onDragStart(e) {
        const target = e.target;
        if (target.closest && (target.closest(".st-pet-condition-row") || target.closest(".st-pet-chat-input"))) return;
        isPointerDown = true; hasMoved = false; didTriggerPetting = false;
        const event = e.type.includes("touch") ? e.touches[0] : e;
        startX = event.clientX; startY = event.clientY;
        const rect = container.getBoundingClientRect();
        initialX = rect.left; initialY = rect.top;
        holdTimer = setTimeout(() => {
            if (isPointerDown && !hasMoved && !state.secondPet.isPetGenerating && state.secondPet.currentState !== "thinking") {
                didTriggerPetting = true;
                import("./pet-reactions.js").then(({ triggerReaction }) => triggerReaction("petting", "secondary"));
            }
        }, 800);
        e.preventDefault();
    }
    
    function onDragMove(e) {
        if (!isPointerDown) return;
        const event = e.type.includes("touch") ? e.touches[0] : e;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        if (!hasMoved && Math.sqrt(deltaX * deltaX + deltaY * deltaY) >= 5) {
            // 공통 설정: 드래그 가능 여부는 글로벌 설정 사용
            if (!state.settings.position.draggable) return;
            clearTimeout(holdTimer); holdTimer = null;
            hasMoved = true;
            container.classList.add("dragging");
            if (state.settings.reactions.onInteraction && !state.secondPet.isPetGenerating) {
                import("./pet-reactions.js").then(({ triggerReaction }) => triggerReaction("dragging", "secondary"));
            }
        }
        if (!hasMoved) return;
        let newX = Math.max(0, Math.min(initialX + deltaX, window.innerWidth - container.offsetWidth));
        let newY = Math.max(0, Math.min(initialY + deltaY, window.innerHeight - container.offsetHeight));
        container.style.left = `${newX}px`; container.style.top = `${newY}px`;
        container.style.right = "auto"; container.style.bottom = "auto";
        e.preventDefault();
    }
    
    function onDragEnd() {
        if (!isPointerDown) return;
        isPointerDown = false;
        clearTimeout(holdTimer); holdTimer = null;
        if (hasMoved) {
            container.classList.remove("dragging");
            const rect = container.getBoundingClientRect();
            state.settings.multiPet.secondPetPosition.customX = rect.left;
            state.settings.multiPet.secondPetPosition.customY = rect.top;
            saveSettings();
            resetSecondPetWalkOrigin();
            checkAndResolvePetCollision("secondary");
            import("./pet-animation.js").then(({ setState, PET_STATES }) => {
                if (state.secondPet.currentState === PET_STATES.DRAGGING) {
                    setState(state.secondPet.isPetGenerating ? PET_STATES.THINKING : PET_STATES.IDLE, null, "secondary");
                }
            });
        } else {
            if (didTriggerPetting) return;
            clickCount++;
            clearTimeout(clickResetTimer);
            clickResetTimer = setTimeout(() => { clickCount = 0; }, 1500);
            if (!state.secondPet.isPetGenerating && state.secondPet.currentState !== "thinking") {
                import("./pet-reactions.js").then(({ triggerReaction }) => {
                    if (clickCount >= 5) { clickCount = 0; triggerReaction("clickSpam", "secondary"); }
                    else { triggerReaction("click", "secondary"); }
                });
            }
        }
    }
    
    container.addEventListener("mousedown", onDragStart);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    container.addEventListener("touchstart", onDragStart, { passive: false });
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
    
    state._cleanupSecondPetDrag = () => {
        container.removeEventListener("mousedown", onDragStart);
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        container.removeEventListener("touchstart", onDragStart);
        document.removeEventListener("touchmove", onDragMove);
        document.removeEventListener("touchend", onDragEnd);
    };
}

// ===== 2번째 펫 걷기 시스템 =====

let walkTimer2 = null;
let walkTransitionTimer2 = null;
let walkOriginX2 = null;
let walkOriginY2 = null;

export function startSecondPetWalking() {
    stopSecondPetWalking();
    const spd = state.settings.multiPet?.secondPetData;
    const walkEnabled = spd?.walk?.enabled ?? state.settings.walk?.enabled;
    if (!walkEnabled) return;
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    walkOriginX2 = rect.left; walkOriginY2 = rect.top;
    log("Second pet walking started");
    scheduleNextSecondPetWalk();
}

export function stopSecondPetWalking() {
    if (walkTimer2) { clearTimeout(walkTimer2); walkTimer2 = null; }
    if (walkTransitionTimer2) { clearTimeout(walkTransitionTimer2); walkTransitionTimer2 = null; }
    const container = document.getElementById("saipet-container-2");
    if (container) {
        container.classList.remove("walking");
        if (state.secondPet._isWalkingSprite) {
            state.secondPet._isWalkingSprite = false;
            updateSecondPetSprite();
        }
    }
}

function scheduleNextSecondPetWalk() {
    const delay = WALK_MOVE_MIN + Math.random() * (WALK_MOVE_MAX - WALK_MOVE_MIN);
    walkTimer2 = setTimeout(() => doSecondPetWalkStep(), delay);
}

function doSecondPetWalkStep() {
    const container = document.getElementById("saipet-container-2");
    if (!container) return;
    if (state.secondPet.currentState === PET_STATES.SLEEPING ||
        state.secondPet.currentState === PET_STATES.DRAGGING ||
        state.isGenerating ||
        state.secondPet.isPetGenerating) {
        if (state.secondPet._isWalkingSprite) {
            state.secondPet._isWalkingSprite = false;
            container.classList.remove("walking");
            updateSecondPetSprite();
        }
        scheduleNextSecondPetWalk();
        return;
    }
    const spd = state.settings.multiPet?.secondPetData;
    const walkSprite = spd?.walk?.walkSprite || DEFAULT_WALK_SPRITE;
    if (walkSprite) {
        state.secondPet._isWalkingSprite = true;
        const isImage = walkSprite && (walkSprite.startsWith("data:") || walkSprite.startsWith("http") ||
            walkSprite.endsWith(".png") || walkSprite.endsWith(".gif") || walkSprite.endsWith(".webp") ||
            walkSprite.endsWith(".jpg") || walkSprite.endsWith(".jpeg"));
        if (isImage && state.secondPet.petElement) {
            let imgSrc = walkSprite;
            if (!walkSprite.startsWith("data:") && !walkSprite.startsWith("http")) {
                imgSrc = `${EXTENSION_BASE_PATH}${walkSprite}`;
            }
            state.secondPet.petElement.innerHTML = `<img src="${imgSrc}" alt="pet2-walk" draggable="false">`;
            state.secondPet.petElement.classList.add("has-image");
        }
    }
    container.classList.add("walking");
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = container.offsetWidth, ch = container.offsetHeight;
    const currentRect = container.getBoundingClientRect();
    if (walkOriginX2 === null) walkOriginX2 = currentRect.left;
    if (walkOriginY2 === null) walkOriginY2 = currentRect.top;
    const clampedX = Math.max(0, Math.min(walkOriginX2 + (Math.random() - 0.5) * 2 * WALK_RANGE, vw - cw));
    const clampedY = Math.max(0, Math.min(walkOriginY2 + (Math.random() - 0.5) * 2 * (WALK_RANGE * 0.3), vh - ch));
    const movingLeft = clampedX < currentRect.left;
    const sprite = container.querySelector(".st-pet-sprite");
    if (sprite) {
        const userFlip = spd?.appearance?.flipHorizontal || false;
        sprite.classList.toggle("flipped", movingLeft ? !userFlip : userFlip);
    }
    container.style.left = `${clampedX}px`; container.style.top = `${clampedY}px`;
    container.style.right = "auto"; container.style.bottom = "auto";
    walkTransitionTimer2 = setTimeout(() => {
        walkTransitionTimer2 = null;
        const c = document.getElementById("saipet-container-2");
        if (!c) return;
        c.classList.remove("walking");
        if (state.secondPet._isWalkingSprite) { state.secondPet._isWalkingSprite = false; updateSecondPetSprite(); }
        const sp = c.querySelector(".st-pet-sprite");
        if (sp) sp.classList.toggle("flipped", spd?.appearance?.flipHorizontal || false);
        state.settings.multiPet.secondPetPosition.customX = clampedX;
        state.settings.multiPet.secondPetPosition.customY = clampedY;
        saveSettings();
        checkAndResolvePetCollision("secondary");
        const we = spd?.walk?.enabled ?? state.settings.walk?.enabled;
        if (we) scheduleNextSecondPetWalk();
    }, 2700);
}

function resetSecondPetWalkOrigin() {
    const container = document.getElementById("saipet-container-2");
    if (container) {
        const rect = container.getBoundingClientRect();
        walkOriginX2 = rect.left; walkOriginY2 = rect.top;
    }
}

// ===== 펫 충돌 감지 =====

/**
 * 두 펫 겹침 감지 + 밀어내기
 * @param {string} movingPetId - 방금 움직인 펫
 */
export function checkAndResolvePetCollision(movingPetId = "primary") {
    const c1 = document.getElementById("saipet-container");
    const c2 = document.getElementById("saipet-container-2");
    if (!c1 || !c2) return;
    
    const r1 = c1.getBoundingClientRect();
    const r2 = c2.getBoundingClientRect();
    const overlaps = !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
    if (!overlaps) return;
    
    const pushedId = movingPetId === "primary" ? "secondary" : "primary";
    const pushed = pushedId === "primary" ? c1 : c2;
    const pusher = pushedId === "primary" ? c2 : c1;
    
    const pusherRect = pusher.getBoundingClientRect();
    const pushedRect = pushed.getBoundingClientRect();
    let dx = pushedRect.left - pusherRect.left;
    let dy = pushedRect.top - pusherRect.top;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    
    const pushDist = 80;
    const vw = window.innerWidth, vh = window.innerHeight;
    const clampedX = Math.max(0, Math.min(pushedRect.left + (dx / dist) * pushDist, vw - pushed.offsetWidth));
    const clampedY = Math.max(0, Math.min(pushedRect.top + (dy / dist) * pushDist, vh - pushed.offsetHeight));
    
    pushed.style.transition = "left 0.3s ease, top 0.3s ease";
    pushed.style.left = `${clampedX}px`;
    pushed.style.top = `${clampedY}px`;
    pushed.style.right = "auto";
    pushed.style.bottom = "auto";
    
    if (pushedId === "secondary") {
        state.settings.multiPet.secondPetPosition.customX = clampedX;
        state.settings.multiPet.secondPetPosition.customY = clampedY;
        resetSecondPetWalkOrigin();
    } else {
        state.settings.position.customX = clampedX;
        state.settings.position.customY = clampedY;
        resetWalkOrigin();
    }
    saveSettings();
    
    import("./pet-animation.js").then(({ playBounce }) => playBounce(pushedId));
    const customCollision = pushedId === "secondary"
        ? (state.settings.multiPet?.secondPetData?.customSpeeches?.collision)
        : (state.settings.customSpeeches?.collision);
    const collisionPool = (customCollision && customCollision.length > 0) ? customCollision : COLLISION_SPEECHES;
    const speech = collisionPool[Math.floor(Math.random() * collisionPool.length)];
    import("./pet-speech.js").then(({ showSpeechBubble }) => showSpeechBubble(speech, 3000, false, pushedId));
    
    setTimeout(() => { pushed.style.transition = ""; }, 300);
}
