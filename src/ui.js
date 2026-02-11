/**
 * SaiPet - 설정 UI
 */

import { EXTENSION_NAME, MOOD_LABELS, POSITION_PRESETS, DEFAULT_SPEECHES, BUBBLE_DESIGNS, FONT_LIST } from "./constants.js";
import { state, log } from "./state.js";
import { saveSettings, fileToBase64, savePreset, loadPreset, deletePreset, updatePreset, getPresetList, resetToDefaultMiyu, exportPreset, importPreset, resetAllSettings } from "./storage.js";
import { createPetContainer, removePetContainer, updatePetPosition, updatePetSize, updatePetSprite, applyDesignTheme, startWalking, stopWalking } from "./pet-core.js";
import { extension_settings } from "../../../../extensions.js";
import { getLogs, clearLogs } from "./pet-ai.js";
import { startSpontaneousTimer, stopSpontaneousTimer } from "./pet-reactions.js";

// 대화 로그 페이지네이션 상태
const LOG_PAGE_SIZE = 10;
let logCurrentPage = 1;


/**
 * UI 생성
 */
export async function createUI() {
    // 위치 프리셋 옵션
    const positionPresetOptions = Object.entries(POSITION_PRESETS)
        .map(([id, data]) => `<option value="${id}">${data.name}</option>`)
        .join("");
    
    // Connection Profile 옵션
    const profiles = extension_settings?.connectionManager?.profiles || [];
    const connectionProfileOptions = profiles.length > 0
        ? profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join("")
        : '<option value="">프로필 없음</option>';

    // 말풍선 디자인 옵션
    const designOptions = Object.entries(BUBBLE_DESIGNS)
        .map(([id, data]) => `<option value="${id}">${data.name}</option>`)
        .join("");

    // 폰트 옵션
    const fontOptions = FONT_LIST
        .map(f => `<option value="${f.id}">${f.name}</option>`)
        .join("");

    // 기분별 스프라이트 업로드 HTML
    const spriteUploadsHtml = Object.entries(MOOD_LABELS)
        .map(([id, label]) => createSpriteUploadHtml(id, label))
        .join("");

    // 대사 설정 HTML (비슷한 상황끼리 그룹)
    const speechLabels = {
        // 일상
        idle: "대기중 (4분 잠수시)",
        sleeping: "잠잘때 (10분 잠수시)",
        // 인사/시간
        greeting: "인사",
        morning: "아침 (7~10시)",
        latenight: "심야 (0~6시)",
        longAbsence: "오랜만에 접속",
        // 상호작용
        click: "클릭시",
        clickSpam: "연타시 (5회+)",
        petting: "쓰다듬기 (길게 클릭)",
        dragging: "드래그시",
        // 컨디션
        feeding: "밥먹을때",
        hungry: "배고플때",
    };
    const speechSettingsHtml = Object.entries(speechLabels)
        .map(([id, label]) => createSpeechSettingHtml(id, label))
        .join("");

    const settingsHtml = `
    <div id="saipet-settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-paw"></i> SaiPet</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                
                <!-- ━━━ 기본 ━━━ -->
                <div class="stvp-section">
                    <div class="stvp-row">
                        <label>활성화</label>
                        <input type="checkbox" id="stvp-enabled">
                        <label class="stvp-toggle" for="stvp-enabled"></label>
                    </div>
                    <div class="stvp-info" style="margin-bottom:0;">
                        <small><i class="fa-solid fa-mobile-screen"></i> 스마트폰에서는 자동으로 비활성화됩니다 (태블릿은 사용 가능).</small>
                    </div>
                </div>

                <!-- ━━━ 프리셋 관리 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-floppy-disk"></i> 프리셋 관리</h5>
                    <div class="stvp-row">
                        <label>저장된 프리셋</label>
                        <select id="stvp-preset-select" class="text_pole">
                            <option value="">-- 선택 --</option>
                        </select>
                    </div>
                    <div class="stvp-row stvp-preset-buttons">
                        <button class="menu_button" id="stvp-preset-load" title="불러오기"><i class="fa-solid fa-folder-open"></i> 불러오기</button>
                        <button class="menu_button" id="stvp-preset-save" title="현재 설정 저장"><i class="fa-solid fa-floppy-disk"></i> 새로 저장</button>
                        <button class="menu_button" id="stvp-preset-update" title="선택된 프리셋에 덮어쓰기"><i class="fa-solid fa-arrows-rotate"></i> 덮어쓰기</button>
                        <button class="menu_button" id="stvp-preset-delete" title="삭제"><i class="fa-solid fa-trash-can"></i> 삭제</button>
                    </div>
                    <div class="stvp-row stvp-preset-buttons">
                        <button class="menu_button" id="stvp-preset-export" title="프리셋 파일로 내보내기"><i class="fa-solid fa-file-export"></i> 내보내기</button>
                        <button class="menu_button" id="stvp-preset-import" title="프리셋 파일 가져오기"><i class="fa-solid fa-file-import"></i> 가져오기</button>
                        <button class="menu_button" id="stvp-preset-default" title="기본 미유로 초기화"><i class="fa-solid fa-cat"></i> 기본 미유</button>
                        <input type="file" id="stvp-preset-import-file" accept=".json" style="display:none;">
                    </div>
                </div>

                <!-- ━━━ 펫 캐릭터 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-paw"></i> 펫 캐릭터</h5>
                    <div class="stvp-row">
                        <label>펫 이름</label>
                        <input type="text" id="stvp-pet-name" class="text_pole" placeholder="냥이">
                    </div>
                    <div class="stvp-row">
                        <label>커스텀 성격</label>
                        <textarea id="stvp-personality-prompt" class="text_pole" rows="4" placeholder="커스텀 성격 프롬프트 (비우면 기본 고양이 성격 사용)"></textarea>
                    </div>
                    <hr class="stvp-divider">
                    <label class="stvp-subsection-title"><i class="fa-solid fa-user"></i> 유저 정보</label>
                    <div class="stvp-row" style="margin-top:6px;">
                        <label>유저와의 관계</label>
                        <input type="text" id="stvp-user-relation" class="text_pole" placeholder="예: 주인, 친구, 동거인, 연인... (비우면 주인)">
                    </div>
                    <div class="stvp-row">
                        <label>유저 이름</label>
                        <input type="text" id="stvp-owner-name" class="text_pole" placeholder="비우면 ST 페르소나 이름 사용">
                    </div>
                    <div class="stvp-row">
                        <label>유저 설정</label>
                        <textarea id="stvp-owner-persona" class="text_pole" rows="3" placeholder="펫에게 알려줄 유저 정보 (비우면 ST 페르소나 사용)"></textarea>
                    </div>
                </div>

                <!-- ━━━ 외형 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-palette"></i> 외형</h5>
                    <div class="stvp-row">
                        <label>크기 (px)</label>
                        <input type="number" id="stvp-size" class="text_pole" min="20" max="500" step="1" style="width: 70px;">
                    </div>
                    <div class="stvp-row">
                        <label>좌우 반전</label>
                        <input type="checkbox" id="stvp-flip">
                        <label class="stvp-toggle" for="stvp-flip"></label>
                    </div>

                    <div class="stvp-subsection">
                        <label class="stvp-subsection-title">기분별 이미지</label>
                        <div class="stvp-info" style="margin-top:6px;">
                            <small><i class="fa-solid fa-lightbulb"></i> 기분별 이미지를 업로드하세요 (GIF 가능). 비어있으면 기본 이모지 사용</small>
                        </div>
                        <div class="stvp-sprite-grid">
                            ${spriteUploadsHtml}
                            <div class="stvp-sprite-item" id="stvp-walk-sprite-item">
                                <span class="stvp-sprite-label">걷기</span>
                                <div class="stvp-sprite-preview" id="stvp-walk-preview">
                                    <span class="stvp-sprite-placeholder">+</span>
                                </div>
                                <input type="file" id="stvp-walk-sprite-file" accept="image/*,.gif,.webp" style="display:none;">
                                <div class="stvp-sprite-buttons">
                                    <button class="stvp-sprite-url menu_button" id="stvp-walk-sprite-url" title="URL로 등록"><i class="fa-solid fa-link"></i></button>
                                    <button class="stvp-sprite-clear menu_button" id="stvp-walk-sprite-clear" style="display:none;">✕</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ━━━ 위치 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-location-dot"></i> 위치</h5>
                    <div class="stvp-row">
                        <label>위치 프리셋</label>
                        <select id="stvp-position" class="text_pole">
                            ${positionPresetOptions}
                        </select>
                    </div>
                    <div class="stvp-row">
                        <label>드래그 이동</label>
                        <input type="checkbox" id="stvp-draggable">
                        <label class="stvp-toggle" for="stvp-draggable"></label>
                    </div>
                    
                    <hr class="stvp-divider">
                    <label class="stvp-subsection-title"><i class="fa-solid fa-person-walking"></i> 걷기</label>
                    <div class="stvp-info" style="margin-bottom:4px;">
                        <small><i class="fa-solid fa-lightbulb"></i> 펫이 주변을 천천히 돌아다닙니다. 잠자기/드래그 중에는 멈춥니다</small>
                    </div>
                    <div class="stvp-row" style="margin-top:4px;">
                        <label>걷기 사용</label>
                        <input type="checkbox" id="stvp-walk-enabled">
                        <label class="stvp-toggle" for="stvp-walk-enabled"></label>
                    </div>

                </div>

                <!-- ━━━ 말풍선 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-comment"></i> 말풍선</h5>
                    <div class="stvp-row">
                        <label>활성화</label>
                        <input type="checkbox" id="stvp-bubble-enabled">
                        <label class="stvp-toggle" for="stvp-bubble-enabled"></label>
                    </div>
                    <div class="stvp-row">
                        <label>디자인</label>
                        <select id="stvp-bubble-design" class="text_pole">
                            ${designOptions}
                        </select>
                    </div>
                    <div class="stvp-row">
                        <label>폰트</label>
                        <select id="stvp-bubble-font" class="text_pole">
                            ${fontOptions}
                        </select>
                    </div>
                    <div class="stvp-row">
                        <label>최대 너비</label>
                        <input type="range" id="stvp-bubble-max-width" min="120" max="600" step="10">
                        <span id="stvp-bubble-max-width-label">360</span>px
                    </div>
                    <div class="stvp-row">
                        <label>표시 시간 (ms)</label>
                        <input type="number" id="stvp-bubble-duration" class="text_pole" min="1000" max="30000" step="500">
                    </div>
                    <hr class="stvp-divider">
                    <label class="stvp-subsection-title"><i class="fa-solid fa-droplet"></i> 색상</label>
                    <div class="stvp-row" style="margin-top:6px;">
                        <label>배경색</label>
                        <input type="color" id="stvp-bubble-bg" value="#ffffff">
                    </div>
                    <div class="stvp-row">
                        <label>글자색</label>
                        <input type="color" id="stvp-bubble-text-color" value="#333333">
                    </div>
                    <div class="stvp-row">
                        <label>강조색</label>
                        <input type="color" id="stvp-bubble-accent-color" value="#7c9bff">
                    </div>
                    <div class="stvp-info" style="margin-bottom:0;">
                        <small><i class="fa-solid fa-palette"></i> 강조색은 게이지바, 버튼, 입력창에 적용됩니다</small>
                    </div>
                    <hr class="stvp-divider">
                    <label class="stvp-subsection-title"><i class="fa-solid fa-comment-slash"></i> 폴백 대사</label>
                    <div class="stvp-row" style="margin-top:6px;">
                        <label>응답 실패 시 대사</label>
                        <input type="text" id="stvp-fallback-no-response" class="text_pole" placeholder="...뭐라고?">
                    </div>
                    <div class="stvp-row">
                        <label>API 오류 시 대사</label>
                        <input type="text" id="stvp-fallback-api-error" class="text_pole" placeholder="...잘 안 들렸어.">
                    </div>
                </div>

                <!-- ━━━ 커스텀 대사 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-quote-left"></i> 커스텀 대사</h5>
                    <div class="stvp-info">
                        <small><i class="fa-solid fa-lightbulb"></i> 비어있으면 기본 대사를 사용합니다. 줄바꿈으로 여러 대사 입력</small>
                    </div>
                    <div class="stvp-speeches-container">
                        ${speechSettingsHtml}
                    </div>
                </div>

                <!-- ━━━ AI 반응 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-robot"></i> AI 반응</h5>
                    <div class="stvp-row">
                        <label>AI 반응 사용</label>
                        <input type="checkbox" id="stvp-ai-enabled">
                        <label class="stvp-toggle" for="stvp-ai-enabled"></label>
                    </div>
                    <div class="stvp-info" style="margin-bottom:0;">
                        <small><i class="fa-solid fa-triangle-exclamation"></i> ON 시 AI 응답마다 펫이 채팅을 읽고 반응합니다 (추가 API 호출 발생)</small>
                    </div>
                    
                    <div class="stvp-row" style="margin-top:8px;">
                        <label>반응 간격</label>
                        <input type="range" id="stvp-reaction-interval" min="1" max="10" step="1">
                        <span id="stvp-reaction-interval-label">3</span>번째 메시지마다
                    </div>

                    <hr class="stvp-divider">
                    <label class="stvp-subsection-title"><i class="fa-solid fa-comment-dots"></i> 자발적 말걸기</label>
                    <div class="stvp-info" style="margin-bottom:4px;">
                        <small><i class="fa-solid fa-lightbulb"></i> 펫이 설정된 간격마다 스스로 말을 겁니다 (AI 반응 ON 필요)</small>
                    </div>
                    <div class="stvp-row" style="margin-top:4px;">
                        <label>자발적 말걸기</label>
                        <input type="checkbox" id="stvp-spontaneous-enabled">
                        <label class="stvp-toggle" for="stvp-spontaneous-enabled"></label>
                    </div>
                    <div id="stvp-spontaneous-settings">
                        <div class="stvp-row">
                            <label>최소 간격</label>
                            <input type="range" id="stvp-spontaneous-min" min="5" max="60" step="5">
                            <span id="stvp-spontaneous-min-label">15</span>분
                        </div>
                        <div class="stvp-row">
                            <label>최대 간격</label>
                            <input type="range" id="stvp-spontaneous-max" min="10" max="120" step="5">
                            <span id="stvp-spontaneous-max-label">30</span>분
                        </div>
                    </div>

                    <hr class="stvp-divider">
                    <div id="stvp-ai-settings" class="stvp-subsection">
                        <label class="stvp-subsection-title">채팅 반응 설정</label>
                        <div class="stvp-row" style="margin-top:8px;">
                            <label>반응 모드</label>
                            <select id="stvp-reaction-mode" class="text_pole">
                                <option value="observer">관전자 (비평/감상)</option>
                                <option value="character">속마음 (내면 독백)</option>
                            </select>
                        </div>
                        <div class="stvp-info" style="margin-bottom:0;">
                            <small><i class="fa-solid fa-eye"></i> 관전자: 채팅을 옆에서 보며 반응 | <i class="fa-solid fa-cloud"></i> 속마음: 캐릭터의 진짜 속마음</small>
                        </div>

                        <hr class="stvp-divider">
                        <label class="stvp-subsection-title">프롬프트에 포함할 정보</label>
                        <div class="stvp-row" style="margin-top:8px;">
                            <label>이전 메시지 수</label>
                            <input type="range" id="stvp-history-count" min="1" max="20" step="1">
                            <span id="stvp-history-count-label">6</span>개
                        </div>
                        <div class="stvp-row">
                            <label>월드인포 포함</label>
                            <input type="checkbox" id="stvp-include-worldinfo">
                            <label class="stvp-toggle" for="stvp-include-worldinfo"></label>
                        </div>

                        <hr class="stvp-divider">
                        <label class="stvp-subsection-title">API 연결</label>
                        <div class="stvp-row" style="margin-top:8px;">
                            <label>Connection Manager</label>
                            <input type="checkbox" id="stvp-use-cm">
                            <label class="stvp-toggle" for="stvp-use-cm"></label>
                        </div>
                        <div class="stvp-row" id="stvp-cm-profile-row">
                            <label>Connection Profile</label>
                            <select id="stvp-cm-profile" class="text_pole">
                                ${connectionProfileOptions}
                            </select>
                        </div>
                        <div class="stvp-row">
                            <label>최대 토큰</label>
                            <input type="number" id="stvp-max-tokens" class="text_pole" min="50" max="200" step="10">
                        </div>
                    </div>
                </div>

                <!-- ━━━ 대화 로그 ━━━ -->
                <div class="stvp-section">
                    <h5><i class="fa-solid fa-clipboard-list"></i> 대화 로그</h5>
                    <div class="stvp-row">
                        <label>로그 필터</label>
                        <select id="stvp-log-filter" class="text_pole">
                            <option value="all">전체</option>
                            <option value="direct">직접 대화만</option>
                            <option value="chat">현재 채팅방 반응만</option>
                        </select>
                    </div>
                    <hr class="stvp-divider">
                    <div id="stvp-log-viewer" class="stvp-log-viewer">
                        <div class="stvp-log-empty"><i class="fa-solid fa-inbox"></i> 로그가 없습니다.</div>
                    </div>
                    <div class="stvp-log-pagination" id="stvp-log-pagination" style="display:none;">
                        <button class="menu_button stvp-log-page-btn" id="stvp-log-prev" title="이전 페이지"><i class="fa-solid fa-chevron-left"></i></button>
                        <span id="stvp-log-page-info">1 / 1</span>
                        <button class="menu_button stvp-log-page-btn" id="stvp-log-next" title="다음 페이지"><i class="fa-solid fa-chevron-right"></i></button>
                    </div>
                    <hr class="stvp-divider">
                    <label class="stvp-subsection-title"><i class="fa-solid fa-broom"></i> 로그 관리</label>
                    <div class="stvp-row stvp-log-buttons" style="margin-top:6px;">
                        <button class="menu_button" id="stvp-log-refresh" title="새로고침"><i class="fa-solid fa-arrows-rotate"></i> 새로고침</button>
                        <button class="menu_button" id="stvp-log-clear-direct" title="직접 대화 로그 초기화"><i class="fa-solid fa-trash-can"></i> 직접 대화</button>
                        <button class="menu_button" id="stvp-log-clear-chat" title="현재 채팅방 로그 초기화"><i class="fa-solid fa-trash-can"></i> 채팅방</button>
                        <button class="menu_button" id="stvp-log-clear-all" title="모든 로그 초기화"><i class="fa-solid fa-trash-can"></i> 전체</button>
                    </div>
                    <div class="stvp-info" style="margin-top:6px; margin-bottom:0;">
                        <small><i class="fa-solid fa-circle-info"></i> 직접 대화는 펫별로 저장됩니다 | 채팅방 반응은 해당 채팅방에서만 표시</small>
                    </div>
                </div>

                <!-- 모바일 상태 -->
                <div class="stvp-section" id="stvp-mobile-notice" style="display:none;">
                    <div class="stvp-info" style="background: rgba(255, 100, 100, 0.15); margin-bottom:0;">
                        <small><i class="fa-solid fa-mobile-screen"></i> 모바일(스마트폰) 환경이 감지되어 펫이 비활성화되었습니다. PC/태블릿에서 자동으로 활성화됩니다.</small>
                    </div>
                </div>

                <!-- 전체 초기화 -->
                <div class="stvp-section" style="margin-bottom:0;">
                    <div class="stvp-row" style="margin-bottom:0;">
                        <button class="menu_button" id="stvp-reset-all" style="width:100%; background: rgba(255, 80, 80, 0.12); border-color: rgba(255, 80, 80, 0.25); font-size:0.85em;" title="확장의 모든 설정을 초기화합니다"><i class="fa-solid fa-triangle-exclamation"></i> 모든 설정 초기화</button>
                    </div>
                </div>

            </div>
        </div>
    </div>
    `;

    // HTML 삽입
    $("#extensions_settings").append(settingsHtml);

    // 이벤트 바인딩
    bindUIEvents();
    
    // UI 값 초기화
    updateUIValues();
    
    // 프리셋 목록 업데이트
    updatePresetList();
    
    // 대화 로그 자동 새로고침
    document.addEventListener("stvp-log-updated", () => {
        refreshLogViewer();
    });
    
    log("UI created");
}

/**
 * 스프라이트 업로드 HTML 생성
 */
function createSpriteUploadHtml(moodId, label) {
    return `
        <div class="stvp-sprite-item" data-mood="${moodId}">
            <span class="stvp-sprite-label">${label}</span>
            <div class="stvp-sprite-preview" id="stvp-preview-${moodId}">
                <span class="stvp-sprite-placeholder">+</span>
            </div>
            <input type="file" id="stvp-file-${moodId}" accept="image/*,.gif,.webp" style="display:none;">
            <div class="stvp-sprite-buttons">
                <button class="stvp-sprite-url menu_button" data-mood="${moodId}" title="URL로 등록"><i class="fa-solid fa-link"></i></button>
                <button class="stvp-sprite-clear menu_button" data-mood="${moodId}" style="display:none;">✕</button>
            </div>
        </div>
    `;
}

/**
 * 대사 설정 HTML 생성
 */
function createSpeechSettingHtml(moodId, label) {
    return `
        <div class="stvp-speech-item">
            <label class="stvp-speech-label">${label}</label>
            <textarea id="stvp-speech-${moodId}" class="text_pole stvp-speech-textarea" rows="2" 
                placeholder="줄바꿈으로 여러 대사 입력..." data-mood="${moodId}"></textarea>
        </div>
    `;
}

/**
 * UI 이벤트 바인딩
 */
function bindUIEvents() {
    // 활성화 토글
    $("#stvp-enabled").on("change", function() {
        state.settings.enabled = this.checked;
        saveSettings();
        
        if (this.checked && !state.isMobile) {
            createPetContainer();
            import("./pet-reactions.js").then(({ initReactions }) => initReactions());
        } else {
            removePetContainer();
            import("./pet-reactions.js").then(({ destroyReactions }) => destroyReactions());
        }
    });

    // === 프리셋 관리 ===
    $("#stvp-preset-save").on("click", function() {
        const name = prompt("프리셋 이름을 입력하세요:", `프리셋 ${(state.settings.savedPresets?.length || 0) + 1}`);
        if (name) {
            savePreset(name);
            updatePresetList();
            alert("프리셋이 저장되었습니다!");
        }
    });

    $("#stvp-preset-load").on("click", function() {
        const presetId = $("#stvp-preset-select").val();
        if (!presetId) {
            alert("불러올 프리셋을 선택하세요.");
            return;
        }
        if (loadPreset(presetId)) {
            updateUIValues();
            if (state.settings.enabled) {
                createPetContainer();
            }
            alert("프리셋을 불러왔습니다!");
        }
    });

    $("#stvp-preset-update").on("click", function() {
        const presetId = $("#stvp-preset-select").val();
        if (!presetId) {
            alert("덮어쓸 프리셋을 선택하세요.");
            return;
        }
        if (confirm("선택한 프리셋에 현재 설정을 덮어쓰시겠습니까?")) {
            if (updatePreset(presetId)) {
                alert("프리셋이 업데이트되었습니다!");
            }
        }
    });

    $("#stvp-preset-delete").on("click", function() {
        const presetId = $("#stvp-preset-select").val();
        if (!presetId) {
            alert("삭제할 프리셋을 선택하세요.");
            return;
        }
        if (confirm("선택한 프리셋을 삭제하시겠습니까?")) {
            if (deletePreset(presetId)) {
                updatePresetList();
                alert("프리셋이 삭제되었습니다!");
            }
        }
    });

    // 기본 미유로 초기화
    $("#stvp-preset-default").on("click", function() {
        if (confirm("기본 메이드 미유 설정으로 초기화하시겠습니까?\n(커스텀 이미지와 대사가 초기화됩니다)")) {
            resetToDefaultMiyu();
            updateUIValues();
            alert("기본 미유로 초기화되었습니다!");
        }
    });

    // 프리셋 내보내기
    $("#stvp-preset-export").on("click", function() {
        const selectedId = $("#stvp-preset-select").val();
        if (selectedId) {
            exportPreset(selectedId);
        } else {
            // 선택된 프리셋 없으면 현재 설정 내보내기
            if (confirm("선택된 프리셋이 없습니다.\n현재 설정을 내보내시겠습니까?")) {
                exportPreset(null);
            }
        }
    });

    // 프리셋 가져오기
    $("#stvp-preset-import").on("click", function() {
        $("#stvp-preset-import-file").click();
    });

    $("#stvp-preset-import-file").on("change", async function() {
        const file = this.files[0];
        if (!file) return;
        
        const success = await importPreset(file);
        if (success) {
            updatePresetList();
            updateUIValues();
            alert("프리셋을 가져왔습니다! 불러오기에서 선택하세요.");
        }
        this.value = "";
    });

    // 전체 설정 초기화
    $("#stvp-reset-all").on("click", function() {
        if (confirm("⚠️ 정말로 모든 설정을 초기화하시겠습니까?\n\n외형, 성격, 대사, 프리셋, 대화 로그 등 모든 데이터가 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.")) {
            if (confirm("정말로요? 마지막 확인입니다.")) {
                resetAllSettings();
                updateUIValues();
                updatePresetList();
                alert("모든 설정이 초기화되었습니다.");
            }
        }
    });

    // === 외형 ===
    // 크기 변경 - 숫자 입력 즉시 적용
    $("#stvp-size").on("input", function() {
        let size = parseInt(this.value);
        if (isNaN(size) || size < 20) size = 20;
        if (size > 500) size = 500;
        state.settings.appearance.size = size;
        updatePetSize();
        saveSettings();
    });

    // 좌우 반전
    $("#stvp-flip").on("change", function() {
        state.settings.appearance.flipHorizontal = this.checked;
        saveSettings();
        updatePetSprite();
    });

    // 스프라이트 업로드 (걷기 이미지는 별도 핸들러)
    $(".stvp-sprite-preview").not("#stvp-walk-preview").on("click", function() {
        const moodId = $(this).closest(".stvp-sprite-item").data("mood");
        $(`#stvp-file-${moodId}`).click();
    });

    $("[id^='stvp-file-']").on("change", async function() {
        const moodId = this.id.replace("stvp-file-", "");
        const file = this.files[0];
        
        if (file) {
            try {
                const base64 = await fileToBase64(file, 512, 0.9);
                state.settings.appearance.customSprites[moodId] = base64;
                saveSettings();
                
                // 미리보기 업데이트
                $(`#stvp-preview-${moodId}`).html(`<img src="${base64}" alt="${moodId}">`);
                $(`.stvp-sprite-clear[data-mood="${moodId}"]`).show();
                
                updatePetSprite();
            } catch (error) {
                log("Failed to upload sprite:", error);
            }
        }
    });

    // URL로 스프라이트 등록 (걷기 이미지는 별도 핸들러)
    $(".stvp-sprite-url").not("#stvp-walk-sprite-url").on("click", function(e) {
        e.stopPropagation();
        const moodId = $(this).data("mood");
        const currentVal = state.settings.appearance.customSprites[moodId];
        const currentUrl = (currentVal && !currentVal.startsWith("data:")) ? currentVal : "";
        const url = prompt("이미지 URL을 입력하세요:", currentUrl);
        
        if (url === null) return; // 취소
        
        if (url.trim() === "") {
            // 빈 값이면 삭제
            state.settings.appearance.customSprites[moodId] = null;
            saveSettings();
            $(`#stvp-preview-${moodId}`).html('<span class="stvp-sprite-placeholder">+</span>');
            $(`.stvp-sprite-clear[data-mood="${moodId}"]`).hide();
            updatePetSprite();
            return;
        }
        
        // URL 직접 저장 (압축 없음)
        state.settings.appearance.customSprites[moodId] = url.trim();
        saveSettings();
        $(`#stvp-preview-${moodId}`).html(`<img src="${url.trim()}" alt="${moodId}">`);
        $(`.stvp-sprite-clear[data-mood="${moodId}"]`).show();
        updatePetSprite();
    });

    // 스프라이트 삭제 (걷기 이미지는 별도 핸들러)
    $(".stvp-sprite-clear").not("#stvp-walk-sprite-clear").on("click", function(e) {
        e.stopPropagation();
        const moodId = $(this).data("mood");
        
        state.settings.appearance.customSprites[moodId] = null;
        saveSettings();
        
        $(`#stvp-preview-${moodId}`).html('<span class="stvp-sprite-placeholder">+</span>');
        $(this).hide();
        
        updatePetSprite();
    });

    // === 위치 ===
    $("#stvp-position").on("change", function() {
        state.settings.position.location = this.value;
        state.settings.position.customX = null;
        state.settings.position.customY = null;
        saveSettings();
        updatePetPosition();
    });

    $("#stvp-draggable").on("change", function() {
        state.settings.position.draggable = this.checked;
        saveSettings();
        if (state.settings.enabled) {
            createPetContainer();
        }
    });

    // === 걷기 ===
    $("#stvp-walk-enabled").on("change", function() {
        if (!state.settings.walk) {
            state.settings.walk = { enabled: false, walkSprite: null };
        }
        state.settings.walk.enabled = this.checked;
        saveSettings();
        if (this.checked) {
            startWalking();
        } else {
            stopWalking();
        }
    });

    // 걷기 이미지 클릭 → 파일 업로드
    $("#stvp-walk-preview").on("click", function() {
        $("#stvp-walk-sprite-file").trigger("click");
    });

    $("#stvp-walk-sprite-file").on("change", async function() {
        const file = this.files[0];
        if (!file) return;
        
        const base64 = await fileToBase64(file);
        if (!state.settings.walk) {
            state.settings.walk = { enabled: false, walkSprite: null };
        }
        state.settings.walk.walkSprite = base64;
        saveSettings();
        
        $("#stvp-walk-preview").html(`<img src="${base64}" alt="walk">`);
        $("#stvp-walk-sprite-clear").show();
    });

    // 걷기 이미지 URL 등록
    $("#stvp-walk-sprite-url").on("click", function(e) {
        e.stopPropagation();
        const currentVal = state.settings.walk?.walkSprite;
        const currentUrl = (currentVal && !currentVal.startsWith("data:")) ? currentVal : "";
        const url = prompt("걷기 이미지 URL을 입력하세요:", currentUrl);
        
        if (url === null) return;
        
        if (!state.settings.walk) {
            state.settings.walk = { enabled: false, walkSprite: null };
        }
        
        if (url.trim() === "") {
            state.settings.walk.walkSprite = null;
            saveSettings();
            $("#stvp-walk-preview").html('<span class="stvp-sprite-placeholder">+</span>');
            $("#stvp-walk-sprite-clear").hide();
            return;
        }
        
        state.settings.walk.walkSprite = url.trim();
        saveSettings();
        $("#stvp-walk-preview").html(`<img src="${url.trim()}" alt="walk">`);
        $("#stvp-walk-sprite-clear").show();
    });

    // 걷기 이미지 제거
    $("#stvp-walk-sprite-clear").on("click", function(e) {
        e.stopPropagation();
        if (!state.settings.walk) {
            state.settings.walk = { enabled: false, walkSprite: null };
        }
        state.settings.walk.walkSprite = null;
        saveSettings();
        
        $("#stvp-walk-preview").html('<span class="stvp-sprite-placeholder">+</span>');
        $(this).hide();
    });

    // === 대사 설정 ===
    $(".stvp-speech-textarea").on("change", function() {
        const moodId = $(this).data("mood");
        const text = this.value.trim();
        
        // 줄바꿈으로 분리하여 배열로 저장
        const speeches = text ? text.split("\n").filter(s => s.trim()) : [];
        state.settings.customSpeeches[moodId] = speeches;
        saveSettings();
    });

    // === AI 설정 ===
    $("#stvp-ai-enabled").on("change", function() {
        state.settings.personality.enabled = this.checked;
        saveSettings();
        toggleAISettings(this.checked);
    });

    $("#stvp-reaction-interval").on("input", function() {
        $("#stvp-reaction-interval-label").text(this.value);
    }).on("change", function() {
        state.settings.reactions.reactionInterval = parseInt(this.value) || 3;
        saveSettings();
    });

    // === 자발적 말걸기 ===
    $("#stvp-spontaneous-enabled").on("change", function() {
        if (!state.settings.reactions.spontaneous) {
            state.settings.reactions.spontaneous = { enabled: false, intervalMin: 15, intervalMax: 30 };
        }
        state.settings.reactions.spontaneous.enabled = this.checked;
        saveSettings();
        if (this.checked) {
            startSpontaneousTimer();
        } else {
            stopSpontaneousTimer();
        }
        toggleSpontaneousSettings(this.checked);
    });

    $("#stvp-spontaneous-min").on("input", function() {
        $("#stvp-spontaneous-min-label").text(this.value);
    }).on("change", function() {
        const val = parseInt(this.value) || 15;
        if (!state.settings.reactions.spontaneous) {
            state.settings.reactions.spontaneous = { enabled: false, intervalMin: 15, intervalMax: 30 };
        }
        state.settings.reactions.spontaneous.intervalMin = val;
        // 최소가 최대보다 크면 최대도 맞춤
        if (val > state.settings.reactions.spontaneous.intervalMax) {
            state.settings.reactions.spontaneous.intervalMax = val;
            $("#stvp-spontaneous-max").val(val);
            $("#stvp-spontaneous-max-label").text(val);
        }
        saveSettings();
        if (state.settings.reactions.spontaneous.enabled) startSpontaneousTimer();
    });

    $("#stvp-spontaneous-max").on("input", function() {
        $("#stvp-spontaneous-max-label").text(this.value);
    }).on("change", function() {
        const val = parseInt(this.value) || 30;
        if (!state.settings.reactions.spontaneous) {
            state.settings.reactions.spontaneous = { enabled: false, intervalMin: 15, intervalMax: 30 };
        }
        state.settings.reactions.spontaneous.intervalMax = val;
        // 최대가 최소보다 작으면 최소도 맞춤
        if (val < state.settings.reactions.spontaneous.intervalMin) {
            state.settings.reactions.spontaneous.intervalMin = val;
            $("#stvp-spontaneous-min").val(val);
            $("#stvp-spontaneous-min-label").text(val);
        }
        saveSettings();
        if (state.settings.reactions.spontaneous.enabled) startSpontaneousTimer();
    });

    $("#stvp-pet-name").on("change", function() {
        state.settings.personality.name = this.value || "냥이";
        saveSettings();
    });

    $("#stvp-personality-prompt").on("change", function() {
        state.settings.personality.prompt = this.value;
        saveSettings();
    });

    $("#stvp-user-relation").on("change", function() {
        state.settings.personality.userRelation = this.value;
        saveSettings();
    });

    $("#stvp-owner-name").on("change", function() {
        state.settings.personality.ownerName = this.value;
        saveSettings();
    });

    $("#stvp-owner-persona").on("change", function() {
        state.settings.personality.ownerPersona = this.value;
        saveSettings();
    });

    $("#stvp-reaction-mode").on("change", function() {
        state.settings.api.reactionMode = this.value;
        saveSettings();
    });

    $("#stvp-include-worldinfo").on("change", function() {
        state.settings.api.includeWorldInfo = this.checked;
        saveSettings();
    });

    $("#stvp-history-count").on("input", function() {
        $("#stvp-history-count-label").text(this.value);
    }).on("change", function() {
        state.settings.api.historyCount = parseInt(this.value) || 5;
        saveSettings();
    });

    $("#stvp-use-cm").on("change", function() {
        state.settings.api.useConnectionManager = this.checked;
        saveSettings();
        toggleCMProfile(this.checked);
    });

    $("#stvp-cm-profile").on("change", function() {
        state.settings.api.connectionProfile = this.value;
        saveSettings();
    });

    $("#stvp-max-tokens").on("change", function() {
        state.settings.api.maxTokens = parseInt(this.value) || 100;
        saveSettings();
    });

    // === 말풍선 ===
    $("#stvp-bubble-enabled").on("change", function() {
        state.settings.speechBubble.enabled = this.checked;
        saveSettings();
    });

    $("#stvp-bubble-design").on("change", function() {
        const design = this.value;
        state.settings.speechBubble.design = design;
        
        saveSettings();
        applyDesignTheme();
    });

    $("#stvp-bubble-font").on("change", function() {
        state.settings.speechBubble.font = this.value;
        saveSettings();
        applyDesignTheme();
    });

    $("#stvp-bubble-max-width").on("input", function() {
        const v = parseInt(this.value) || 360;
        $("#stvp-bubble-max-width-label").text(v);
        state.settings.speechBubble.maxWidth = v;
        saveSettings();
        applyDesignTheme();
    });

    $("#stvp-bubble-duration").on("change", function() {
        state.settings.speechBubble.duration = parseInt(this.value) || 3000;
        saveSettings();
    });

    $("#stvp-bubble-bg").on("change", function() {
        state.settings.speechBubble.backgroundColor = this.value;
        saveSettings();
        applyDesignTheme();
    });

    $("#stvp-bubble-text-color").on("change", function() {
        state.settings.speechBubble.textColor = this.value;
        saveSettings();
        applyDesignTheme();
    });

    $("#stvp-bubble-accent-color").on("change", function() {
        state.settings.speechBubble.accentColor = this.value;
        saveSettings();
        applyDesignTheme();
    });

    // === 실패 대사 ===
    $("#stvp-fallback-no-response").on("change", function() {
        if (!state.settings.fallbackMessages) state.settings.fallbackMessages = {};
        state.settings.fallbackMessages.noResponse = this.value;
        saveSettings();
    });

    $("#stvp-fallback-api-error").on("change", function() {
        if (!state.settings.fallbackMessages) state.settings.fallbackMessages = {};
        state.settings.fallbackMessages.apiError = this.value;
        saveSettings();
    });

    // === 대화 로그 ===
    $("#stvp-log-filter").on("change", function() {
        logCurrentPage = 1;
        refreshLogViewer();
    });

    $("#stvp-log-refresh").on("click", function() {
        refreshLogViewer();
    });

    // 페이지네이션 버튼
    $("#stvp-log-prev").on("click", function() {
        if (logCurrentPage > 1) {
            logCurrentPage--;
            refreshLogViewer();
        }
    });

    $("#stvp-log-next").on("click", function() {
        logCurrentPage++;
        refreshLogViewer();
    });

    $("#stvp-log-clear-direct").on("click", function() {
        if (confirm("직접 대화 로그를 모두 삭제하시겠습니까?")) {
            clearLogs("direct");
            logCurrentPage = 1;
            refreshLogViewer();
        }
    });

    $("#stvp-log-clear-chat").on("click", function() {
        if (confirm("현재 채팅방의 반응 로그를 삭제하시겠습니까?")) {
            clearLogs("chat");
            logCurrentPage = 1;
            refreshLogViewer();
        }
    });

    $("#stvp-log-clear-all").on("click", function() {
        if (confirm("모든 대화 로그를 삭제하시겠습니까?")) {
            clearLogs("all");
            logCurrentPage = 1;
            refreshLogViewer();
        }
    });
}

/**
 * 대화 로그 뷰어 갱신 (10개씩 페이지네이션)
 */
function refreshLogViewer() {
    const viewer = document.getElementById("stvp-log-viewer");
    if (!viewer) return;
    
    const filter = $("#stvp-log-filter").val() || "all";
    const logs = getLogs(filter);
    
    if (logs.length === 0) {
        viewer.innerHTML = '<div class="stvp-log-empty"><i class="fa-solid fa-inbox"></i> 로그가 없습니다.</div>';
        $("#stvp-log-pagination").hide();
        logCurrentPage = 1;
        return;
    }
    
    // 최신순으로 표시
    const reversed = [...logs].reverse();
    const totalPages = Math.ceil(reversed.length / LOG_PAGE_SIZE);
    
    // 현재 페이지가 범위를 벗어나면 보정
    if (logCurrentPage > totalPages) logCurrentPage = totalPages;
    if (logCurrentPage < 1) logCurrentPage = 1;
    
    const startIdx = (logCurrentPage - 1) * LOG_PAGE_SIZE;
    const endIdx = Math.min(startIdx + LOG_PAGE_SIZE, reversed.length);
    const pageItems = reversed.slice(startIdx, endIdx);
    
    let html = "";
    
    for (const entry of pageItems) {
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString("ko-KR", {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
        const moodEmoji = getMoodEmoji(entry.mood);
        
        if (entry.type === "direct") {
            html += `<div class="stvp-log-entry stvp-log-direct">
                <div class="stvp-log-header">
                    <span class="stvp-log-time"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                    <span class="stvp-log-badge stvp-log-badge-direct"><i class="fa-solid fa-comment"></i> 직접대화</span>
                </div>
                <div class="stvp-log-user"><i class="fa-solid fa-user"></i> ${escapeHtml(entry.userText)}</div>
                <div class="stvp-log-pet"><i class="fa-solid fa-paw"></i> ${escapeHtml(entry.petResponse)}</div>
            </div>`;
        } else {
            const triggerLabel = getTriggerLabel(entry.trigger);
            html += `<div class="stvp-log-entry stvp-log-reaction">
                <div class="stvp-log-header">
                    <span class="stvp-log-time"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                    <span class="stvp-log-badge stvp-log-badge-reaction"><i class="fa-solid fa-bolt"></i> ${triggerLabel}</span>
                </div>
                <div class="stvp-log-pet"><i class="fa-solid fa-paw"></i> ${escapeHtml(entry.petResponse)}</div>
            </div>`;
        }
    }
    
    viewer.innerHTML = html;
    
    // 페이지네이션 UI 업데이트
    if (totalPages > 1) {
        $("#stvp-log-pagination").show();
        $("#stvp-log-page-info").text(`${logCurrentPage} / ${totalPages}`);
        $("#stvp-log-prev").prop("disabled", logCurrentPage <= 1);
        $("#stvp-log-next").prop("disabled", logCurrentPage >= totalPages);
    } else {
        $("#stvp-log-pagination").hide();
    }
}

/**
 * 무드 이모지 가져오기
 */
function getMoodEmoji(mood) {
    const emojis = {
        happy: "😊", sad: "😢", excited: "🤩", surprised: "😲",
        nervous: "😰", confident: "😎", shy: "😳", angry: "😡",
        thinking: "🤔", sleeping: "😴", idle: "😐",
    };
    return emojis[mood] || "🐾";
}

/**
 * 트리거 라벨 가져오기
 */
function getTriggerLabel(trigger) {
    const labels = {
        aiResponse: "채팅 반응",
        userMessage: "유저 메시지",
        idle: "대기중",
        click: "클릭",
        clickSpam: "연타",
        petting: "쓰다듬기",
        greeting: "인사",
        latenight: "심야",
        morning: "아침",
        newchat: "새 채팅",
        longAbsence: "오랜만에",
        feeding: "밥주기",
        hungry: "배고픔",
        spontaneous: "자발적 말걸기",
    };
    return labels[trigger] || trigger;
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 모바일 알림 업데이트
 */
function updateMobileNotice() {
    const notice = document.getElementById("stvp-mobile-notice");
    if (notice) {
        notice.style.display = state.isMobile ? "block" : "none";
    }
}

/**
 * UI 값 업데이트
 */
function updateUIValues() {
    const s = state.settings;
    
    $("#stvp-enabled").prop("checked", s.enabled);
    
    // 외형
    $("#stvp-size").val(s.appearance.size);
    $("#stvp-flip").prop("checked", s.appearance.flipHorizontal);
    
    // 커스텀 스프라이트 미리보기
    Object.entries(s.appearance.customSprites || {}).forEach(([moodId, data]) => {
        if (data) {
            $(`#stvp-preview-${moodId}`).html(`<img src="${data}" alt="${moodId}">`);
            $(`.stvp-sprite-clear[data-mood="${moodId}"]`).show();
        } else {
            $(`#stvp-preview-${moodId}`).html('<span class="stvp-sprite-placeholder">+</span>');
            $(`.stvp-sprite-clear[data-mood="${moodId}"]`).hide();
        }
    });
    
    // 위치
    $("#stvp-position").val(s.position.location);
    $("#stvp-draggable").prop("checked", s.position.draggable);
    
    // 걷기
    const walk = s.walk || { enabled: false, walkSprite: null };
    $("#stvp-walk-enabled").prop("checked", walk.enabled);
    if (walk.walkSprite) {
        $("#stvp-walk-preview").html(`<img src="${walk.walkSprite}" alt="walk">`);
        $("#stvp-walk-sprite-clear").show();
    } else {
        $("#stvp-walk-preview").html('<span class="stvp-sprite-placeholder">+</span>');
        $("#stvp-walk-sprite-clear").hide();
    }
    
    // 대사 설정 (모든 textarea를 먼저 비운 뒤, 값이 있는 것만 채움)
    $(".stvp-speech-textarea").val("");
    Object.entries(s.customSpeeches || {}).forEach(([moodId, speeches]) => {
        $(`#stvp-speech-${moodId}`).val(speeches.join("\n"));
    });
    
    // AI
    $("#stvp-ai-enabled").prop("checked", s.personality.enabled);
    $("#stvp-reaction-interval").val(s.reactions.reactionInterval || 3);
    $("#stvp-reaction-interval-label").text(s.reactions.reactionInterval || 3);
    
    // 자발적 말걸기
    const spon = s.reactions.spontaneous || { enabled: false, intervalMin: 15, intervalMax: 30 };
    $("#stvp-spontaneous-enabled").prop("checked", spon.enabled);
    $("#stvp-spontaneous-min").val(spon.intervalMin || 15);
    $("#stvp-spontaneous-min-label").text(spon.intervalMin || 15);
    $("#stvp-spontaneous-max").val(spon.intervalMax || 30);
    $("#stvp-spontaneous-max-label").text(spon.intervalMax || 30);
    toggleSpontaneousSettings(spon.enabled);
    
    $("#stvp-pet-name").val(s.personality.name);
    $("#stvp-personality-prompt").val(s.personality.prompt);
    $("#stvp-user-relation").val(s.personality.userRelation || "");
    $("#stvp-owner-name").val(s.personality.ownerName || "");
    $("#stvp-owner-persona").val(s.personality.ownerPersona || "");
    $("#stvp-reaction-mode").val(s.api.reactionMode || "observer");
    $("#stvp-include-worldinfo").prop("checked", s.api.includeWorldInfo || false);
    $("#stvp-history-count").val(s.api.historyCount || 6);
    $("#stvp-history-count-label").text(s.api.historyCount || 6);
    $("#stvp-use-cm").prop("checked", s.api.useConnectionManager);
    $("#stvp-cm-profile").val(s.api.connectionProfile);
    $("#stvp-max-tokens").val(s.api.maxTokens);
    toggleAISettings(s.personality.enabled);
    toggleCMProfile(s.api.useConnectionManager);
    
    // 말풍선
    $("#stvp-bubble-enabled").prop("checked", s.speechBubble.enabled);
    $("#stvp-bubble-design").val(s.speechBubble.design || "simple");
    $("#stvp-bubble-font").val(s.speechBubble.font || "default");
    $("#stvp-bubble-max-width").val(s.speechBubble.maxWidth || 360);
    $("#stvp-bubble-max-width-label").text(s.speechBubble.maxWidth || 360);
    $("#stvp-bubble-duration").val(s.speechBubble.duration);
    $("#stvp-bubble-bg").val(s.speechBubble.backgroundColor);
    $("#stvp-bubble-text-color").val(s.speechBubble.textColor);
    $("#stvp-bubble-accent-color").val(s.speechBubble.accentColor || "#7c9bff");
    $("#stvp-fallback-no-response").val(s.fallbackMessages?.noResponse || "");
    $("#stvp-fallback-api-error").val(s.fallbackMessages?.apiError || "");
    
    // 대화 로그
    refreshLogViewer();
    
    // 모바일 알림
    updateMobileNotice();
}

/**
 * 프리셋 목록 업데이트
 */
function updatePresetList() {
    const presets = getPresetList();
    const $select = $("#stvp-preset-select");
    
    $select.empty();
    $select.append('<option value="">-- 선택 --</option>');
    
    presets.forEach(preset => {
        $select.append(`<option value="${preset.id}">${preset.name}</option>`);
    });
    
    // 현재 선택된 프리셋 표시
    if (state.settings.currentPresetId) {
        $select.val(state.settings.currentPresetId);
    }
}

/**
 * AI 설정 섹션 토글
 */
function toggleAISettings(show) {
    if (show) {
        $("#stvp-ai-settings").slideDown(200);
    } else {
        $("#stvp-ai-settings").slideUp(200);
    }
}

/**
 * 자발적 말걸기 설정 토글
 */
function toggleSpontaneousSettings(show) {
    if (show) {
        $("#stvp-spontaneous-settings").slideDown(200);
    } else {
        $("#stvp-spontaneous-settings").slideUp(200);
    }
}

/**
 * Connection Manager 프로필 토글
 */
function toggleCMProfile(show) {
    if (show) {
        $("#stvp-cm-profile-row").show();
    } else {
        $("#stvp-cm-profile-row").hide();
    }
}
