/**
 * SaiPet - 펫 코어 (DOM 생성, 위치, 드래그)
 */

import { state, log } from "./state.js";
import { saveSettings } from "./storage.js";
import { getCurrentSprite } from "./pet-animation.js";
import { EXTENSION_BASE_PATH } from "./constants.js";

/**
 * 펫 컨테이너 생성
 */
export function createPetContainer() {
    // 기존 요소 제거
    removePetContainer();
    
    const container = document.createElement("div");
    container.id = "saipet-container";
    container.innerHTML = `
        <div class="st-pet-wrapper">
            <div class="st-pet-sprite"></div>
            <div class="st-pet-bubble" style="display:none;">
                <span class="st-pet-bubble-text"></span>
            </div>
            <div class="st-pet-condition-row">
                <button class="st-pet-feed-btn" title="밥주기">🍖</button>
                <div class="st-pet-hunger-bar">
                    <div class="st-pet-hunger-fill" style="width: 100%;"></div>
                </div>
                <button class="st-pet-chat-btn" title="말 걸기">💬</button>
            </div>
            <div class="st-pet-chat-input" style="display:none;">
                <input type="text" class="st-pet-chat-text" placeholder="말 걸기..." maxlength="100">
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
export function clampPetPosition() {
    const container = document.getElementById("saipet-container");
    if (!container) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;

    // 프리셋 위치(right/bottom 기반)도 화면이 좁으면 잘릴 수 있으므로 보정
    if (state.settings.position.customX === null && state.settings.position.customY === null) {
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

    let x = state.settings.position.customX;
    let y = state.settings.position.customY;
    let changed = false;

    if (x > maxX) { x = maxX; changed = true; }
    if (y > maxY) { y = maxY; changed = true; }
    if (x < 0) { x = 0; changed = true; }
    if (y < 0) { y = 0; changed = true; }

    if (changed) {
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        state.settings.position.customX = x;
        state.settings.position.customY = y;
        saveSettings();
    }
}
