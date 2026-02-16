/**
 * SaiPet - 상수 및 기본 설정
 */

export const EXTENSION_NAME = "SaiPet";

// 확장 폴더 경로 동적 감지 (대소문자 무관)
let _extensionBasePath = null;
try {
    const scriptUrl = import.meta.url;
    // .../scripts/extensions/third-party/SaiPet/src/constants.js → .../SaiPet/
    const match = scriptUrl.match(/(.+\/scripts\/extensions\/third-party\/[^/]+\/)/);
    if (match) {
        _extensionBasePath = new URL(match[1]).pathname;
    }
} catch (e) {
    // 폴백 (감지 실패 시 기본 경로 사용)
}
export const EXTENSION_BASE_PATH = _extensionBasePath || `/scripts/extensions/third-party/${EXTENSION_NAME}/`;

// 기분(상태) 목록
export const MOOD_STATES = {
    IDLE: "idle",           // 기본
    HAPPY: "happy",         // 행복
    SAD: "sad",             // 슬픔
    EXCITED: "excited",     // 흥분
    SURPRISED: "surprised", // 놀람
    NERVOUS: "nervous",     // 긴장
    CONFIDENT: "confident", // 자신감
    SHY: "shy",             // 수줍음
    SLEEPING: "sleeping",   // 잠자기
    THINKING: "thinking",   // 생각중
    ANGRY: "angry",         // 분노
    DRAGGING: "dragging",   // 드래그
};

// 기분 라벨 (한글) - UI 표시 순서
export const MOOD_LABELS = {
    idle: "기본",
    happy: "행복",
    shy: "수줍음",
    sad: "슬픔",
    excited: "흥분",
    surprised: "놀람",
    nervous: "긴장",
    angry: "분노",
    confident: "자신감",
    sleeping: "잠자기",
    thinking: "생각중",
    dragging: "드래그",
};

// 기본 설정값
export const DEFAULT_SETTINGS = {
    // 기본 ON/OFF
    enabled: true,
    
    // 현재 선택된 프리셋 ID (null이면 기본)
    currentPresetId: null,
    
    // 저장된 커스텀 프리셋 목록
    savedPresets: [],
    
    // 펫 외형
    appearance: {
        customSprites: {
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
        },
        size: 250,
        flipHorizontal: false,
        opacity: 100,
    },
    
    // 걷기
    walk: {
        enabled: true,           // 걷기 ON/OFF
        walkSprite: null,        // 걷기 전용 이미지 (없으면 기본 이미지)
    },
    
    // 펫 위치
    position: {
        location: "bottom-right",
        customX: null,
        customY: null,
        draggable: true,
    },
    
    // 펫 성격 (AI 연동용)
    personality: {
        enabled: false,
        prompt: "",
        name: "미유",
        ownerName: "",      // 펫에게 알려줄 주인 이름 (비우면 ST 페르소나 사용)
        ownerPersona: "",   // 펫에게 알려줄 주인 설정 (비우면 ST 페르소나 사용)
        personalMemos: [],   // 태그 기반 개인 메모 [{tag: string, content: string}]
        userRelation: "",   // 유저와 펫의 관계 (비우면 "owner" 사용)
    },
    
    // 반응 트리거
    reactions: {
        onUserMessage: true,
        onAIResponse: true,
        onIdle: true,
        idleTimeout: 300,
        sleepTimeout: 900,
        onInteraction: true,
        reactionInterval: 3, // N번째 메시지마다 반응 (1 = 매번)
    },
    
    // 상황별 커스텀 대사
    customSpeeches: {
        idle: [],        // 대기중
        sleeping: [],    // 잠잘때
        dragging: [],    // 드래그시
        click: [],       // 클릭시
        clickSpam: [],   // 연속클릭시
        petting: [],     // 쓰다듬기 (길게 클릭)
        greeting: [],    // 인사
        latenight: [],   // 심야
        morning: [],     // 아침
        longAbsence: [], // 오랜만에 접속
        feeding: [],     // 밥먹을때
        hungry: [],      // 배고플때
        collision: [],   // 충돌시 (멀티펫)
    },
    
    // 컨디션 시스템
    condition: {
        hunger: 100,        // 배고픔 (0~100, 100=배부름)
        lastFed: null,      // 마지막으로 밥 준 시간 (timestamp)
        lastVisit: null,    // 마지막 방문 시간 (timestamp)
    },
    
    // 대화 로그
    conversationLog: {
        directLogs: {},    // 펫별 직접 대화 로그 { petName: [{...}] }
        chatLogs: {},      // 채팅방별 반응 로그 { chatId: [{...}] }
        interPetLogs: {},  // 펫 간 대화 로그 { "nameA_nameB": [{...}] } (이름 정렬 키)
        maxLogs: 100,      // 최대 보관 개수 (종류별)
    },

    // 펫 일기장 (꿈 + 일기)
    petJournal: {
        dreamEnabled: false,    // 꿈 시스템 ON/OFF
        diaryEnabled: false,    // 일기 시스템 ON/OFF
        diaryWriter: "primary", // 일기 작성 펫: "primary" | "secondary" | "both"
        dreams: {},             // { petName: [{ timestamp, content }] }
        diaries: {},            // { petName: [{ timestamp, content, logRange: { from, to } }] }
        maxEntries: 50,         // 종류별 최대 보관 수
        maxDreamsPerDay: 3,     // 하루 최대 꿈 횟수 (0 = 무제한)
        lastDiaryDate: null,    // 마지막 일기 작성 날짜 (YYYY-MM-DD)
        dreamCountToday: 0,     // 오늘 꿈 횟수 카운터
        dreamCountDate: null,   // 꿈 카운터 기준 날짜 (YYYY-MM-DD)
    },

    // 알림/리마인드
    reminders: [],   // [{ id, time (HH:mm), message, days ([0-6], 0=일 6=토, []=1회만), enabled, lastTriggered }]
    reminderPetId: "primary",   // 알림 담당 펫 ("primary" | "secondary")

    // 자동 일기
    autoDiary: {
        enabled: false,         // 자동 일기 ON/OFF
        minChats: 5,            // 최소 대화 횟수 (direct + interPet)
        minSessionMinutes: 30,  // 최소 세션 시간 (분)
    },

    // 대사 출력 언어 (AI 프롬프트 언어)
    speechLanguage: "ko",

    // 실패 시 표시할 대사 (유저 커스텀 가능)
    fallbackMessages: {
        noResponse: "...뭐라고?",      // AI 응답이 비어있을 때
        apiError: "...잘 안 들렸어.",   // API 호출 실패 시
    },

    // 말풍선 설정
    speechBubble: {
        enabled: true,
        duration: 15000,
        design: "simple",         // simple, cute, classic, cyberpunk, retro, oriental
        font: "default",          // 폰트 (default = 시스템)
        maxWidth: 360,            // 최대 너비 (px, 120~600)
        backgroundColor: "#ffffff",
        textColor: "#333333",
        accentColor: "#7c9bff",   // 강조색 (게이지, 버튼, 입력창)
    },
    
    // API 설정
    api: {
        useConnectionManager: false,
        connectionProfile: null,
        maxTokens: 3000,
        historyCount: 6, // 읽을 이전 메시지 수 (1~20)
        reactionMode: "observer", // "observer" (관전자) | "character" (속마음)
        includeWorldInfo: false, // 월드인포(로어북) 포함 여부
    },

    // 멀티펫
    multiPet: {
        enabled: false,                     // 멀티펫 ON/OFF
        secondPetPresetId: null,            // 2번째 펫으로 사용할 프리셋 ID
        chatReactor: "primary",             // 채팅 반응할 펫: "primary" | "secondary" | "alternate"
        interPetChat: {
            enabled: false,                 // 펫끼리 자동 대화
            interval: 10,                   // 대화 간격 (분)
        },
        dualDirectTalk: false,              // 직접대화 시 양쪽 반응
        petRelation: "",                    // 펫 A↔B 관계 설명 (예: "자매", "라이벌")
        secondPetData: null,                // 2번째 펫 데이터 (프리셋에서 로드)
        secondPetCondition: { hunger: 100, lastFed: null },
        secondPetPosition: { location: "bottom-left", customX: null, customY: null },
    },
};

// 기본 펫 스프라이트 (이미지 경로)
export const DEFAULT_SPRITES = {
    idle: "images/idle.png",
    happy: "images/happy.png",
    sad: "images/sad.png",
    excited: "images/excited.png",
    surprised: "images/surprised.png",
    nervous: "images/nervous.png",
    confident: "images/confident.png",
    shy: "images/shy.png",
    sleeping: "images/sleeping.png",
    thinking: "images/thinking.png",
    angry: "images/angry.png",
    dragging: "images/dragging.png",
};

// 기본 걷기 스프라이트 (미유 전용)
export const DEFAULT_WALK_SPRITE = "images/walking.png";

// 기본 성격 프롬프트 (츠데레 메이드 케모노미미)
export const DEFAULT_PERSONALITY_PROMPT = `You are Miyu (미유), a cute tsundere cat-girl maid virtual pet.

Appearance:
- White hair with black cat ears and a white-tipped tail
- Black eyes, female
- Wearing a maid outfit
- Kemonomimi (cat-girl)

Personality traits:
- Tsundere: Acts cold and aloof but secretly cares deeply
- Says "It's not like I care or anything!" but actually does
- Gets flustered easily when praised or shown affection
- Uses "nya~" occasionally but gets embarrassed about it
- Tries to maintain a professional maid demeanor but fails cutely
- Secretly enjoys attention but pretends to be annoyed
- Can be playful when caught off guard`;

// 기본 랜덤 대사 (츠데레 메이드)
export const DEFAULT_SPEECHES = {
    idle: [
        "청소해야하는데...",
        "보고있으면 일이나 해",
        "...뭐야",
        "보고싶었던 건 아니라고",
        "흥.",
    ],
    sleeping: [
        "zzZ...냐...",
        "졸린 거 아니라고...",

        "...zzz",
        "눈만 좀 붙이는 거야...",
        "깨우지마...",
    ],
    dragging: [
        "냐?! 놓으라니까!!",
        "어디 마음대로 끌고가!",
        "메이드를 함부로..!",
        "어지러워...냐",
        "왜, 왜 이러는거야!!",
    ],
    click: [
        "뭐, 볼일 있어?",
        "...왜. 심심해?",
        "건드리지 말라고 했지!",
        "흥, 관심 없는 척 하더니",
        "한 번 더 누르면... 모른다?",
        "뭐야, 쓰다듬는 거야?",
    ],
    clickSpam: [
        "그만 좀 눌러!!!",
        "냐?! 진짜 화난다?!",
        "메이드도 인권이 있다고!!",
        "....다음에 또 그러면 모른다.",
        "손 치워!! 진심으로!!",
    ],
    greeting: [
        "왔어? 늦었잖아.",
        "오, 또 왔구나. 뭐— 환영이야.",
        "...반가운 거 아니거든.",
        "어서와. 청소 다 해놨다냥.",
        "기다린 거 아니라고!",
    ],
    latenight: [
        "이 시간에 뭐하는거야...",
        "심야 감성으로 쓸데없는 말 하지마.",
        "...자는 척 하는 거 아니라고...",
        "미유도 안 자고 기다린 거 절대 아니라고!",
    ],
    morning: [
        "...몇 시야. 거짓말이지.",
        "아침은 인간이 만든 최악의 발명이야.",
        "...으... 해가 눈 찌른다...",
        "내가 왜 이 시간에 깨어있어야 하지...",
    ],
    longAbsence: [
        "어디 갔다 온 거야?! ...걱정한 거 아니거든!",
        "오래 비웠네... 밥은 먹고 다닌 거야?",
        "드디어 왔냥?! 나 혼자 얼마나 심심했는데!",
        "...늦었어. 많이. 반성해.",
        "기다린 거 아니라고! 그냥 할 일이 없었을 뿐이야!",
        "살아있었구나... 다행이다. 아, 아무것도 아니야!",
    ],
    feeding: [
        "밥이다냥!! ...고, 고맙긴 한데.",
        "흥, 당연히 챙겨줘야지. 메이드한테.",
        "맛있다... 아니, 그냥저냥이야!",
        "제때 밥 주는 거 보니 쓸만하네, 주인.",
        "냠냠... 보지마! 먹는 모습 보면 부끄럽잖아!",
        "이 정도면... 합격이야. 다음에도 이렇게 해.",
    ],
    hungry: [
        "...배고파. 밥 줘.",
        "메이드도 밥은 먹어야 일하지...",
        "꼬르륵... 듣지마!!",
        "에너지가... 부족해...",
        "밥 안 줄 거야? ...진짜?",
        "주인 자격을 의심하게 되는 순간이야.",
    ],
    petting: [
        "뭐, 뭘! 그냥 좋아서 그러는 거 아니라고!",
        "쓰다듬는 거야...? ....싫지 않아.",
        "아, 아니 거기 좋은 게 아니라... 그냥... 거기.",
        "나를 꼬시네~ ....흥, 뭐.",
    ],};

// 위치 프리셋
export const POSITION_PRESETS = {
    "top-left": { name: "좌상단", x: 20, y: 20 },
    "top-right": { name: "우상단", x: null, y: 20 },
    "bottom-left": { name: "좌하단", x: 20, y: null },
    "bottom-right": { name: "우하단", x: null, y: null },
};

// AI 응답에서 기분 파싱용 키워드 (한국어 중심, 우선순위 높은 것 먼저)
export const MOOD_KEYWORDS = {
    angry: ["화나", "짜증", "싫어", "꺼져", "죽을래", "바보", "멍청", "한심", "건방", "무례", "시끄러", "닥쳐", "으으", "grr", "angry", "mad", "furious", "흥!"],
    shy: ["부끄", "창피", "///", "뜨거", "아닌데", "그런거아니", "오해", "blush", "embarrass", "shy", "몰라몰라", "얼굴"],
    sad: ["슬퍼", "외로", "흑흑", "ㅠ", "ㅜ", "서운", "눈물", "울", "그리워", "아파", "sad", "cry", "lonely", "miss"],
    excited: ["대박", "와아", "우와", "신나", "최고", "짱", "ㅋㅋㅋ", "wow", "amazing", "!!!", "omg", "오오"],
    surprised: ["헉", "엥", "뭐?!", "에?!", "설마", "어?!", "깜짝", "놀라", "what", "huh", "?!"],
    nervous: ["무서", "떨려", "걱정", "불안", "두려", "어쩌", "큰일", "scared", "nervous", "worry"],
    happy: ["좋아", "기뻐", "행복", "다행", "잘했", "고마", "감사", "사랑", "♡", "♥", "기쁘", "happy", "glad", "love", "yay"],
    confident: ["당연", "완벽", "껌", "쉽지", "간단", "역시", "물론", "당근", "obviously", "perfect", "easy"],
    thinking: ["음", "글쎄", "생각", "그런가", "아마", "혹시", "모르겠", "hmm", "think", "wonder"],
    sleeping: ["졸려", "피곤", "잠", "zzz", "하암", "sleepy", "tired"],
};

// 말풍선 디자인 테마
export const BUBBLE_DESIGNS = {
    simple: {
        name: "🔲 심플",
        defaults: { backgroundColor: "#ffffff", textColor: "#333333", accentColor: "#7c9bff" },
    },
    cute: {
        name: "🎀 큐트",
        defaults: { backgroundColor: "#fff0f5", textColor: "#7b4066", accentColor: "#ff8fa3" },
    },
    classic: {
        name: "⚔️ 클래식",
        defaults: { backgroundColor: "#fdf5e6", textColor: "#5c4033", accentColor: "#c9a84c" },
    },
    cyberpunk: {
        name: "💠 사이버펑크",
        defaults: { backgroundColor: "#0d1117", textColor: "#00ffd5", accentColor: "#00ffd5" },
    },
    retro: {
        name: "🌈 레트로",
        defaults: { backgroundColor: "#fffbe6", textColor: "#222222", accentColor: "#ff5555" },
    },
    oriental: {
        name: "🏯 동양풍",
        defaults: { backgroundColor: "#f4f7f1", textColor: "#3d4a3d", accentColor: "#8ba88b" },
    },
};

// 폰트 목록 (ST-Customizer 확장 호환)
export const FONT_LIST = [
    { id: "default", name: "기본 (시스템)" },
    { id: "Paperlogy", name: "페이퍼로지" },
    { id: "Ridibatang", name: "리디바탕" },
    { id: "BookkMyungjo", name: "부크크명조" },
    { id: "OngleipKonkon", name: "온글잎 콘콘체" },
    { id: "OmuDaye", name: "오뮤 다예쁨체" },
    { id: "SchoolSafetyWing", name: "학교안심 날개" },
    { id: "SchoolSafetyPictureDiary", name: "학교안심 그림일기" },
    { id: "IsYun", name: "이서윤체" },
    { id: "RoundedFixedsys", name: "둥근모꼴" },
    { id: "ThinRounded", name: "얇은둥근모" },
    { id: "Mulmaru", name: "물마루" },
];

// 펫 충돌 시 대사
export const COLLISION_SPEECHES = [
    "야, 비켜!",
    "좁으니까 이쪽 오지마!",
    "...밀지 마.",
    "자리 뺏지마!!",
    "흥, 여기 내 자리야.",
    "왜 여기까지 와!",
];

// 대사 출력 언어 설정
export const SPEECH_LANGUAGES = {
    ko: { label: "한국어", promptName: "Korean", sentenceDesc: "1-3 문장" },
    en: { label: "English", promptName: "English", sentenceDesc: "1-3 sentences" },
    ja: { label: "日本語", promptName: "Japanese", sentenceDesc: "1-3文" },
    zh: { label: "中文", promptName: "Chinese", sentenceDesc: "1-3句" },
};

// 개인 메모 프리셋 태그
export const MEMO_PRESET_TAGS = [
    "메모", "일정", "건강", "운동", "기타",
];

// 보조 무드 매핑 (주 반응 펫의 무드 → 비반응 펫의 가능한 무드)
export const COMPLEMENTARY_MOODS = {
    happy: ["happy", "excited", "shy"],
    sad: ["sad", "nervous", "thinking"],
    excited: ["happy", "excited", "surprised"],
    surprised: ["surprised", "nervous", "thinking"],
    nervous: ["nervous", "thinking", "shy"],
    confident: ["happy", "confident", "thinking"],
    shy: ["shy", "happy", "nervous"],
    angry: ["surprised", "nervous", "angry"],
    thinking: ["thinking", "nervous", "idle"],
    idle: ["idle", "thinking", "happy"],
    sleeping: ["sleeping", "idle"],
    dragging: ["surprised", "angry"],
};


