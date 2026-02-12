/**
 * SaiPet - 저장소 관리
 */

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { EXTENSION_NAME, DEFAULT_SETTINGS } from "./constants.js";
import { state } from "./state.js";

/**
 * 설정 저장
 */
export function saveSettings() {
    extension_settings[EXTENSION_NAME] = state.settings;
    saveSettingsDebounced();
}

/**
 * 설정 로드
 */
export function loadSettings() {
    return extension_settings[EXTENSION_NAME];
}

/**
 * 설정 업데이트
 * @param {string} category - 카테고리 (예: 'appearance')
 * @param {string} key - 키 (예: 'size')
 * @param {any} value - 값
 */
export function updateSetting(category, key, value) {
    if (state.settings[category]) {
        state.settings[category][key] = value;
        saveSettings();
    }
}

/**
 * 중첩 설정 업데이트
 * @param {string} path - 점 표기법 경로 (예: 'appearance.customSprites.idle')
 * @param {any} value - 값
 */
export function updateNestedSetting(path, value) {
    const keys = path.split('.');
    let current = state.settings;
    
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    saveSettings();
}

/**
 * 파일을 Base64로 변환 (이미지는 자동 압축)
 * @param {File} file 
 * @param {number} maxSize - 최대 크기 (px), 기본 200
 * @param {number} quality - JPEG 품질 (0~1), 기본 0.8
 * @returns {Promise<string>}
 */
export function fileToBase64(file, maxSize = 200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        // 이미지가 아니면 그냥 변환
        if (!file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
            return;
        }
        
        // 이미지면 압축
        const img = new Image();
        const reader = new FileReader();
        
        reader.onload = (e) => {
            img.onload = () => {
                // 캔버스로 리사이즈
                const canvas = document.createElement("canvas");
                let { width, height } = img;
                
                // 비율 유지하며 최대 크기로 축소
                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    } else {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                
                // GIF/WEBP는 PNG로, 나머지는 JPEG로 (용량 절약)
                let outputFormat = "image/jpeg";
                if (file.type === "image/gif" || file.type === "image/webp" || file.type === "image/png") {
                    // 투명도가 있을 수 있으므로 PNG 유지
                    outputFormat = "image/png";
                }
                
                const compressed = canvas.toDataURL(outputFormat, quality);
                resolve(compressed);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 이미지 URL 유효성 검사
 * @param {string} url 
 * @returns {Promise<boolean>}
 */
export function validateImageUrl(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

/**
 * 새 프리셋 저장
 * @param {string} name - 프리셋 이름
 * @returns {string} - 생성된 프리셋 ID
 */
export function savePreset(name) {
    const presetId = `preset_${Date.now()}`;
    
    const preset = {
        id: presetId,
        name: name,
        createdAt: new Date().toISOString(),
        appearance: structuredClone(state.settings.appearance),
        personality: structuredClone(state.settings.personality),
        customSpeeches: structuredClone(state.settings.customSpeeches),
        fallbackMessages: structuredClone(state.settings.fallbackMessages || {}),
        walk: structuredClone(state.settings.walk || { enabled: false, walkSprite: null }),
        speechBubble: structuredClone(state.settings.speechBubble),
    };
    
    if (!state.settings.savedPresets) {
        state.settings.savedPresets = [];
    }
    
    state.settings.savedPresets.push(preset);
    state.settings.currentPresetId = presetId;
    saveSettings();
    
    return presetId;
}

/**
 * 프리셋 불러오기
 * @param {string} presetId - 프리셋 ID
 * @returns {boolean} - 성공 여부
 */
export function loadPreset(presetId) {
    const preset = state.settings.savedPresets?.find(p => p.id === presetId);
    
    if (!preset) {
        return false;
    }
    
    // 외형, 성격, 대사 적용 (유저 정보도 프리셋별로 적용)
    state.settings.appearance = structuredClone(preset.appearance);
    const currentOwnerName = state.settings.personality.ownerName || "";
    const currentOwnerPersona = state.settings.personality.ownerPersona || "";
    state.settings.personality = structuredClone(preset.personality);
    // 구버전 프리셋(유저 정보 미포함)이면 현재 유저 정보 유지
    if (!('ownerName' in preset.personality)) {
        state.settings.personality.ownerName = currentOwnerName;
    }
    if (!('ownerPersona' in preset.personality)) {
        state.settings.personality.ownerPersona = currentOwnerPersona;
    }
    state.settings.customSpeeches = structuredClone(preset.customSpeeches);
    if (preset.fallbackMessages) {
        state.settings.fallbackMessages = structuredClone(preset.fallbackMessages);
    }
    if (preset.walk) {
        // walk.enabled는 유저 기존값 유지, walkSprite만 적용
        state.settings.walk.walkSprite = preset.walk.walkSprite || null;
    }
    if (preset.speechBubble) {
        state.settings.speechBubble = structuredClone(preset.speechBubble);
    }
    state.settings.currentPresetId = presetId;
    
    saveSettings();
    return true;
}

/**
 * 프리셋 삭제
 * @param {string} presetId - 프리셋 ID
 * @returns {boolean} - 성공 여부
 */
export function deletePreset(presetId) {
    if (!state.settings.savedPresets) {
        return false;
    }
    
    const index = state.settings.savedPresets.findIndex(p => p.id === presetId);
    
    if (index === -1) {
        return false;
    }
    
    state.settings.savedPresets.splice(index, 1);
    
    // 현재 선택된 프리셋이면 초기화
    if (state.settings.currentPresetId === presetId) {
        state.settings.currentPresetId = null;
    }
    
    saveSettings();
    return true;
}

/**
 * 현재 프리셋 업데이트 (덮어쓰기)
 * @param {string} presetId - 프리셋 ID
 * @returns {boolean} - 성공 여부
 */
export function updatePreset(presetId) {
    const preset = state.settings.savedPresets?.find(p => p.id === presetId);
    
    if (!preset) {
        return false;
    }
    
    preset.appearance = structuredClone(state.settings.appearance);
    preset.personality = structuredClone(state.settings.personality);
    preset.customSpeeches = structuredClone(state.settings.customSpeeches);
    preset.fallbackMessages = structuredClone(state.settings.fallbackMessages || {});
    preset.walk = structuredClone(state.settings.walk || { enabled: false, walkSprite: null });
    preset.speechBubble = structuredClone(state.settings.speechBubble);
    preset.updatedAt = new Date().toISOString();
    
    saveSettings();
    return true;
}

/**
 * 저장된 프리셋 목록 가져오기
 * @returns {Array}
 */
export function getPresetList() {
    return state.settings.savedPresets || [];
}

/**
 * 내보내기용 personality에서 유저 정보 제거 (펫 이름 + 성격만)
 * @param {Object} personality
 * @returns {Object}
 */
function stripUserInfo(personality) {
    const { ownerName, ownerPersona, ...petOnly } = personality;
    return structuredClone(petOnly);
}

/**
 * 프리셋 내보내기 (JSON 파일 다운로드)
 * @param {string} presetId - 프리셋 ID (비우면 현재 설정 전체)
 */
export function exportPreset(presetId) {
    let exportData;
    let fileName;
    
    if (presetId) {
        // 특정 프리셋 내보내기
        const preset = state.settings.savedPresets?.find(p => p.id === presetId);
        if (!preset) return false;
        exportData = {
            _type: "SaiPet-Preset",
            _version: 1,
            preset: {
                name: preset.name,
                createdAt: preset.createdAt,
                appearance: structuredClone(preset.appearance),
                personality: stripUserInfo(preset.personality),
                customSpeeches: structuredClone(preset.customSpeeches),
                fallbackMessages: structuredClone(preset.fallbackMessages || {}),
                walk: { walkSprite: (preset.walk?.walkSprite || null) },
                speechBubble: structuredClone(preset.speechBubble || state.settings.speechBubble),
            },
        };
        fileName = `saipet-preset-${preset.name.replace(/[^a-zA-Z0-9\u3131-\uD79D]/g, "_")}.json`;
    } else {
        // 현재 설정 전체 내보내기
        exportData = {
            _type: "SaiPet-Preset",
            _version: 1,
            preset: {
                name: state.settings.personality.name || "Custom",
                createdAt: new Date().toISOString(),
                appearance: structuredClone(state.settings.appearance),
                personality: stripUserInfo(state.settings.personality),
                customSpeeches: structuredClone(state.settings.customSpeeches),
                fallbackMessages: structuredClone(state.settings.fallbackMessages || {}),
                walk: { walkSprite: (state.settings.walk?.walkSprite || null) },
                speechBubble: structuredClone(state.settings.speechBubble),
            },
        };
        fileName = `saipet-preset-${state.settings.personality.name || "custom"}.json`;
    }
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

/**
 * 프리셋 가져오기 (JSON 파일에서)
 * @param {File} file - JSON 파일
 * @returns {Promise<boolean>}
 */
export async function importPreset(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if ((data._type !== "SaiPet-Preset" && data._type !== "ST-Virtual-Pet-Preset") || !data.preset) {
                    alert("유효하지 않은 프리셋 파일입니다.");
                    resolve(false);
                    return;
                }
                
                const preset = data.preset;
                // 새 ID 부여 (충돌 방지)
                preset.id = `preset_${Date.now()}`;
                preset.importedAt = new Date().toISOString();
                
                // 가져온 프리셋에 유저 정보가 없으면 현재 유저 정보 보존
                if (preset.personality && !preset.personality.ownerName) {
                    preset.personality.ownerName = state.settings.personality.ownerName || "";
                }
                if (preset.personality && !preset.personality.ownerPersona) {
                    preset.personality.ownerPersona = state.settings.personality.ownerPersona || "";
                }
                
                // fallbackMessages가 없으면 빈 객체
                if (!preset.fallbackMessages) {
                    preset.fallbackMessages = {};
                }
                
                // walk가 없으면 기본값 (enabled는 유저 기존값 유지)
                if (!preset.walk) {
                    preset.walk = { walkSprite: null };
                }
                // enabled가 포함되어 있으면 제거 (유저 기존값 보존)
                delete preset.walk.enabled;
                
                // speechBubble이 없으면 기본값 유지
                if (!preset.speechBubble) {
                    preset.speechBubble = structuredClone(state.settings.speechBubble);
                }
                
                if (!state.settings.savedPresets) {
                    state.settings.savedPresets = [];
                }
                
                state.settings.savedPresets.push(preset);
                saveSettings();
                
                resolve(true);
            } catch (err) {
                alert("파일 파싱 오류: " + err.message);
                resolve(false);
            }
        };
        reader.onerror = () => resolve(false);
        reader.readAsText(file);
    });
}

/**
 * 기본 미유 설정으로 초기화
 * 커스텀 이미지와 대사를 초기화하고 기본값으로 복원
 */
export function resetToDefaultMiyu() {
    // 커스텀 이미지 초기화
    state.settings.appearance.customSprites = {
        idle: null,
        happy: null,
        sad: null,
        excited: null,
        surprised: null,
        nervous: null,
        confident: null,
        shy: null,
        sleeping: null,
        thinking: null,
        angry: null,
        dragging: null,
    };
    
    // 커스텀 대사 전체 초기화
    state.settings.customSpeeches = {
        idle: [],
        sleeping: [],
        dragging: [],
        click: [],
        clickSpam: [],
        petting: [],
        greeting: [],
        latenight: [],
        morning: [],
        longAbsence: [],
        feeding: [],
        hungry: [],
    };
    
    // 기본 이름과 성격 복원
    state.settings.personality.name = "미유";
    state.settings.personality.prompt = "";
    
    // 실패 대사 초기화
    state.settings.fallbackMessages = {
        noResponse: "...뭐라고?",
        apiError: "...잘 안 들렸어.",
    };
    
    // 걷기 초기화 (기본 ON, 커스텀 이미지 제거)
    state.settings.walk = {
        enabled: true,
        walkSprite: null,
    };
    
    // 현재 프리셋 선택 해제
    state.settings.currentPresetId = null;
    
    saveSettings();
    
    // 스프라이트 업데이트
    import("./pet-core.js").then(({ updatePetSprite }) => {
        updatePetSprite();
    });
}

/**
 * 모든 설정 초기화 (확장 전체 리셋)
 */
export function resetAllSettings() {
    const freshSettings = structuredClone(DEFAULT_SETTINGS);
    
    // state.settings 전체 교체
    Object.keys(state.settings).forEach(key => delete state.settings[key]);
    Object.assign(state.settings, freshSettings);
    
    saveSettings();
    
    // 스프라이트 업데이트
    import("./pet-core.js").then(({ updatePetSprite, updatePetSize, updatePetPosition, updatePetOpacity }) => {
        updatePetSprite();
        updatePetSize();
        updatePetPosition();
        updatePetOpacity();
    });
}
