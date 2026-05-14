"use strict";

// ═══════════════════════════════════════════════
// Bob教练 — 覆盖层 UI + 决策引擎
// ═══════════════════════════════════════════════

// ── 状态 ──
const state = {
  // 游戏状态
  gameActive: false,
  turn: 1,
  gold: 3,
  maxGold: 3,
  tavernTier: 1,
  health: 30,
  heroCardId: "",
  heroName: "",
  boardMinions: [],     // [{cardId, name_cn, tier, attack, health, golden, position, tribes_cn}]
  handMinions: [],
  shopMinions: [],      // [{cardId, name_cn, tier, tribes_cn, position}]
  gamePhase: "shop",    // shop | combat | recruit
  activeAnomaly: null,  // string — 当前畸变ID（由 log-parser 写入）
  activeRewards: [],    // string[] — 已获得的任务奖励ID

  // 决策结果
  suggestion: null,     // Decision 对象: {type, priority, action, message, reason, confidence}
  secondaryHints: [],   // Decision[] — 次级提示
  highlightedCards: [], // [{cardId, highlightType, reasonShort, position}]
  compMatches: [],      // [{comp, matchPercent, missingCards, ...}]
  currentComp: null,

  // 插件状态
  agreementAccepted: false,
  panelOpen: false,
  settingsOpen: false,
  aboutOpen: false,
  legendOpen: false,
  rulesOpen: false,
  showCombatPredictor: true,
  combatSimSamples: 200,
  disconnectStatus: "online", // online | disconnecting | reconnecting
  dcCountdown: 3,
  demoMode: false,
  demoTurnIndex: 0,
  gearMenuOpen: false,
  badgeMinimized: false,
  badgeMinimizeTimer: null,

  // 加载的数据
  cards: null,
  compStrategies: [],
  heroStats: [],
  decisionTables: null,
  pendingUpdates: null,

  // 对手数据
  opponents: [],
  combatPrediction: null,  // { winPct, drawPct, lossPct }

  // 冻结/刷新状态
  frozenShop: false,
  freeRefreshCount: 0,
  hpRefreshRemaining: 0,

  // 账号管理
  userProfile: null,
  userStats: null,
  syncQueueStatus: null,
};

// ── DOM 引用缓存 ──
const $ = (id) => document.getElementById(id);
const dom = {};

function cacheDom() {
  dom.suggestionBadge = $("suggestion-badge");
  dom.sugText = $("sug-text");
  dom.sugReason = $("sug-reason");
  dom.cardHighlights = $("card-highlights");
  dom.disconnectBtn = $("disconnect-btn");
  dom.dcDot = $("dc-dot");
  dom.dcRing = $("dc-ring");
  dom.dcLabel = $("dc-label");
  dom.dcToast = $("dc-toast");
  dom.dcToastText = $("dc-toast-text");
  dom.dcProgressFill = $("dc-progress-fill");
  dom.gearMenu = $("gear-menu");
  dom.gearIcon = $("gear-icon");
  dom.gearDropdown = $("gear-dropdown");
  dom.compPanel = $("comp-panel");
  dom.compHandle = $("comp-handle");
  dom.compContent = $("comp-content");
  dom.compName = $("comp-name");
  dom.compMatch = $("comp-match");
  dom.currentBoard = $("current-board");
  dom.targetBoard = $("target-board");
  dom.missingCards = $("missing-cards");
  dom.positionTip = $("position-tip");
  dom.altComps = $("alt-comps");
  dom.compAltSection = $("comp-alt-section");
  dom.tacticalBoard = $("tactical-board");
  dom.tacticalTitle = $("tactical-title");
  dom.tacticalBody = $("tactical-body");
  dom.tacticalClose = $("tactical-close");
  dom.agreementOverlay = $("agreement-overlay");
  dom.agreementCheckbox = $("agreement-checkbox");
  dom.agreementDisabledNote = $("agreement-disabled-note");
  dom.settingsOverlay = $("settings-overlay");
  dom.aboutOverlay = $("about-overlay");
  dom.legendOverlay = $("legend-overlay");
  dom.rulesOverlay = $("rules-overlay");
  dom.demoIndicator = $("demo-indicator");
  dom.demoTurn = $("demo-turn");
  dom.secondaryHints = $("secondary-hints");
  dom.btnCheckUpdate = $("btn-check-update");
  dom.syncCardsVer = $("sync-cards-ver");
  dom.syncHeroDate = $("sync-hero-date");
  dom.syncCompCount = $("sync-comp-count");
  dom.syncLastCheck = $("sync-last-check");
  dom.combatPredictor = $("combat-predictor");
  dom.cpWinSeg = $("cp-win-seg");
  dom.cpDrawSeg = $("cp-draw-seg");
  dom.cpLossSeg = $("cp-loss-seg");
  dom.cpWinPct = $("cp-win-pct");
  dom.cpDrawPct = $("cp-draw-pct");
  dom.cpLossPct = $("cp-loss-pct");
  dom.heroSelectPanel = $("hero-select-panel");
  dom.heroSelectList = $("hero-select-list");
  dom.trinketSelectPanel = $("trinket-select-panel");
  dom.trinketSelectList = $("trinket-select-list");
  dom.accountStatusBadge = $("account-status-badge");
  dom.accountLoggedOut = $("account-logged-out");
  dom.accountLoggedIn = $("account-logged-in");
  dom.accountInfoText = $("account-info-text");
  dom.accountUserInfo = $("account-user-info");
  dom.accountUsername = $("account-username");
  dom.accountPassword = $("account-password");
  dom.setPrivacyLevel = $("set-privacy-level");
  dom.accountStats = $("account-stats");
  dom.statTotalGames = $("stat-total-games");
  dom.statTop4Rate = $("stat-top4-rate");
  dom.statFirstPlace = $("stat-first-place");
  dom.statAvgPlacement = $("stat-avg-placement");
  dom.syncQueueStatus = $("sync-queue-status");
  dom.sqPending = $("sq-pending");
  dom.sqSynced = $("sq-synced");
  dom.sqFailed = $("sq-failed");
  dom.apiEndpointsList = $("api-endpoints-list");
}

// ═══════════════════════════════════════════
// 卡牌名称中英回退翻译
// ═══════════════════════════════════════════

const CARD_NAME_FALLBACK = {
  "Alleycat": "小巷猫",
  "Selfless Hero": "无私的英雄",
  "Wrath Weaver": "愤怒编织者",
  "Deck Swabbie": "甲板杂兵",
  "Rockpool Hunter": "鱼人潮猎人",
  "Micro Machine": "微型战斗机甲",
  "Micro Mummy": "微型木乃伊",
  "Cat": "猎猫",
  "Mecharoo": "机械袋鼠",
  "Murloc Tidecaller": "鱼人招潮者",
  "Dragonspawn Lieutenant": "龙人军官",
  "Fiendish Servant": "恶魔仆从",
  "Vulgar Homunculus": "粗俗的矮劣魔",
  "Rabid Saurolisk": "疯狂的蜥蜴",
  "Refreshing Anomaly": "清爽的异常体",
  "Scavenging Hyena": "食腐土狼",
  "Kindly Grandmother": "慈祥的外婆",
  "Murloc Tidehunter": "鱼人猎潮者",
  "Twilight Whelp": "暮光雏龙",
  "Glyph Guardian": "雕文守护者",
  "Hangry Dragon": "暴怒的巨龙",
  "Prized Promo-Drake": "珍贵的促销龙",
  "Bronze Warden": "青铜守卫",
  "Amalgam": "融合怪",
  "Menagerie Mug": "万象水晶杯",
  "Menagerie Jug": "万象水晶壶",
  "Primalfin Lookout": "蛮鱼斥候",
  "Coldlight Seer": "寒光先知",
  "Soul Juggler": "灵魂杂耍者",
  "Imp Mama": "小鬼妈妈",
  "Baron Rivendare": "瑞文戴尔男爵",
  "Brann Bronzebeard": "布莱恩·铜须",
  "Titus Rivendare": "提图斯·瑞文戴尔",
  "Kangor's Apprentice": "坎格尔的学徒",
  "Mama Bear": "熊妈妈",
  "Gentle Djinni": "温和的灯神",
  "Kalecgos": "卡雷苟斯",
  "Amalgadon": "融合巨怪",
  "Nadina the Red": "红衣纳迪娜",
  "Cap'n Hoggarr": "霍格船长",
  "Murozond": "姆诺兹多",
  "Razorgore": "锋刃之喉",
  "Replicating Menace": "分裂威胁",
  "Defender of Argus": "阿古斯防御者",
  "Cobalt Scalebane": "钴制卫士",
  "Drakonid Enforcer": "龙人执行者",
  "Swolefin": "壮鳍鱼人",
  "Charlga": "查尔加",
  "Tarecgosa": "塔雷苟萨",
  "Young Murk-Eye": "幼鳞蓝龙",
  "Coral Keeper": "珊瑚培育者",
};

function translateCardName(cardId, fallbackName) {
  // Check fallback map
  if (fallbackName && CARD_NAME_FALLBACK[fallbackName]) {
    return CARD_NAME_FALLBACK[fallbackName];
  }
  // Try to derive Chinese from card ID patterns
  if (cardId && cardId.startsWith("BG")) {
    // Return the fallback as-is, which is likely the best we have
    return fallbackName || cardId;
  }
  return fallbackName || cardId;
}

// ═══════════════════════════════════════════
// 数据加载
// ═══════════════════════════════════════════

async function loadAllData() {
  try {
    state.decisionTables = await window.bobCoach.loadData("decision_tables");
    state.compStrategies = (await window.bobCoach.loadData("comp_strategies")) || [];
    state.heroStats = (await window.bobCoach.loadData("hero_stats")) || [];

    // Load hero_tips (tips + curves)
    var heroTipsRaw = (await window.bobCoach.loadData("hero_tips")) || {};
    state.heroTips = heroTipsRaw.tips || heroTipsRaw;
    state.heroCurves = heroTipsRaw.curves || [];

    // Load trinket tips
    state.trinketTips = (await window.bobCoach.loadData("trinket_tips")) || {};

    // Load spell interaction data (法术协同卡牌索引)
    state._spellInteractions = (await window.bobCoach.loadData("spell_interactions")) || {};

    // 校验 decision_tables 与 cards.json 的一致性（新英雄/畸变未登记时告警）
    if (typeof RulesEngine !== "undefined" && RulesEngine.validateConfig && state.cards) {
      var validation = RulesEngine.validateConfig(state.decisionTables, state.cards);
      if (validation.warnings && validation.warnings.length > 0) {
        console.warn("[RulesEngine] 配置校验警告:", validation.warnings);
      }
      if (validation.unknownHeroes && validation.unknownHeroes.length > 0) {
        console.warn("[RulesEngine] 未知英雄（将从配置中忽略）:", validation.unknownHeroes);
      }
    }

    // Build hero stats map for fast lookup
    state._heroStatsMap = {};
    for (var i = 0; i < state.heroStats.length; i++) {
      var hs = state.heroStats[i];
      state._heroStatsMap[hs.hero_card_id] = hs;
    }

    // Build card lookup map + hero power cost lookup
    var cardsArr = (await window.bobCoach.loadData("cards")) || [];
    state.cards = {};
    state._heroPowerCost = {}; // hp_id → mana_cost
    state._heroHpMap = {};     // hero_id → hp_ids[]
    for (var j = 0; j < cardsArr.length; j++) {
      var c = cardsArr[j];
      state.cards[c.str_id] = c;
      if (c.card_type === "hero power") {
        state._heroPowerCost[c.str_id] = c.mana_cost || 0;
      }
      if (c.card_type === "hero" && c.hp_ids) {
        state._heroHpMap[c.str_id] = c.hp_ids;
      }
    }

    console.log(
      "[Bob] Loaded " + cardsArr.length + " cards, " + state.compStrategies.length +
      " comps, " + state.heroStats.length + " heroes, " +
      Object.keys(state.heroTips || {}).length + " hero tips"
    );
    return true;
  } catch (e) {
    console.error("[Bob] Data load failed:", e);
    return false;
  }
}

function getCard(cardId) {
  return (state.cards && state.cards[cardId]) || null;
}

function getCardName(cardId) {
  const c = getCard(cardId);
  if (c) {
    if (c.name_cn) return c.name_cn;
    return translateCardName(cardId, c.name);
  }
  return translateCardName(cardId, cardId);
}

// ═══════════════════════════════════════════
// Demo 模式数据
// ═══════════════════════════════════════════

const DEMO_SCENARIOS = [
  {
    turn: 1,
    gold: 3,
    maxGold: 3,
    tavernTier: 1,
    health: 30,
    heroCardId: "TB_BaconShop_HERO_53",
    heroName: "伊瑟拉",
    boardMinions: [],
    shopMinions: [
      { cardId: "BGS_041", name_cn: "碧蓝幼龙", tier: 1, tribes_cn: ["龙"], position: 0 },
      { cardId: "BGS_002", name_cn: "无私的英雄", tier: 1, tribes_cn: [], position: 1 },
      { cardId: "BGS_001", name_cn: "鱼人潮猎人", tier: 1, tribes_cn: ["鱼人"], position: 2 },
    ],
    gamePhase: "shop",
  },
  {
    turn: 3,
    gold: 5,
    maxGold: 5,
    tavernTier: 1,
    health: 28,
    heroCardId: "TB_BaconShop_HERO_53",
    heroName: "伊瑟拉",
    boardMinions: [
      { cardId: "BGS_041", name_cn: "碧蓝幼龙", tier: 1, attack: 3, health: 4, golden: false, position: 0, tribes_cn: ["龙"] },
      { cardId: "BGS_002", name_cn: "无私的英雄", tier: 1, attack: 2, health: 1, golden: false, position: 1, tribes_cn: [] },
    ],
    shopMinions: [
      { cardId: "BGS_041", name_cn: "碧蓝幼龙", tier: 1, tribes_cn: ["龙"], position: 0 },
      { cardId: "BG_LOE_077", name_cn: "布莱恩·铜须", tier: 5, tribes_cn: [], position: 1 },
    ],
    gamePhase: "shop",
  },
  {
    turn: 5,
    gold: 7,
    maxGold: 7,
    tavernTier: 2,
    health: 24,
    heroCardId: "TB_BaconShop_HERO_53",
    heroName: "伊瑟拉",
    boardMinions: [
      { cardId: "BGS_041", name_cn: "碧蓝幼龙", tier: 1, attack: 6, health: 5, golden: true, position: 0, tribes_cn: ["龙"] },
      { cardId: "BGS_047", name_cn: "龙人斥候", tier: 2, attack: 3, health: 5, golden: false, position: 1, tribes_cn: ["龙"] },
      { cardId: "BGS_002", name_cn: "无私的英雄", tier: 1, attack: 2, health: 1, golden: false, position: 2, tribes_cn: [] },
    ],
    shopMinions: [
      { cardId: "BGS_047", name_cn: "龙人斥候", tier: 2, tribes_cn: ["龙"], position: 0 },
      { cardId: "BG_LOE_077", name_cn: "布莱恩·铜须", tier: 5, tribes_cn: [], position: 1 },
      { cardId: "BGS_002", name_cn: "无私的英雄", tier: 1, tribes_cn: [], position: 2 },
    ],
    gamePhase: "shop",
  },
  {
    turn: 7,
    gold: 8,
    maxGold: 8,
    tavernTier: 3,
    health: 18,
    heroCardId: "TB_BaconShop_HERO_53",
    heroName: "伊瑟拉",
    boardMinions: [
      { cardId: "BGS_041", name_cn: "碧蓝幼龙", tier: 1, attack: 10, health: 8, golden: true, position: 0, tribes_cn: ["龙"] },
      { cardId: "BGS_047", name_cn: "龙人斥候", tier: 2, attack: 3, health: 5, golden: false, position: 1, tribes_cn: ["龙"] },
      { cardId: "BGS_045", name_cn: "暮光守护者", tier: 3, attack: 4, health: 4, golden: false, position: 2, tribes_cn: ["龙"] },
      { cardId: "BGS_002", name_cn: "无私的英雄", tier: 1, attack: 2, health: 1, golden: false, position: 3, tribes_cn: [] },
    ],
    shopMinions: [
      { cardId: "BGS_045", name_cn: "暮光守护者", tier: 3, tribes_cn: ["龙"], position: 0 },
      { cardId: "BG_LOE_077", name_cn: "布莱恩·铜须", tier: 5, tribes_cn: [], position: 1 },
      { cardId: "BGS_055", name_cn: "拉法姆的阴谋", tier: 3, tribes_cn: ["龙"], position: 2 },
    ],
    gamePhase: "shop",
  },
  {
    turn: 9,
    gold: 9,
    maxGold: 9,
    tavernTier: 4,
    health: 12,
    heroCardId: "TB_BaconShop_HERO_53",
    heroName: "伊瑟拉",
    boardMinions: [
      { cardId: "BGS_041", name_cn: "碧蓝幼龙", tier: 1, attack: 14, health: 12, golden: true, position: 0, tribes_cn: ["龙"] },
      { cardId: "BGS_047", name_cn: "龙人斥候", tier: 2, attack: 5, health: 7, golden: false, position: 1, tribes_cn: ["龙"] },
      { cardId: "BGS_045", name_cn: "暮光守护者", tier: 3, attack: 6, health: 5, golden: false, position: 2, tribes_cn: ["龙"] },
      { cardId: "BGS_055", name_cn: "拉法姆的阴谋", tier: 3, attack: 4, health: 4, golden: false, position: 3, tribes_cn: ["龙"] },
      { cardId: "BGS_002", name_cn: "无私的英雄", tier: 1, attack: 2, health: 1, golden: false, position: 4, tribes_cn: [] },
    ],
    shopMinions: [
      { cardId: "BGS_055", name_cn: "拉法姆的阴谋", tier: 3, tribes_cn: ["龙"], position: 0 },
      { cardId: "BG_LOE_077", name_cn: "布莱恩·铜须", tier: 5, tribes_cn: [], position: 1 },
      { cardId: "BGS_045", name_cn: "暮光守护者", tier: 3, tribes_cn: ["龙"], position: 2 },
    ],
    gamePhase: "shop",
  },
];

// ═══════════════════════════════════════════
// 实时对局状态接入（来自 HDT 日志解析）
// ═══════════════════════════════════════════

function applyGameState(gs) {
  // 检测新对局：hero 变化 或 gameActive 从 false → true
  var isNewSession = false;
  if (gs.gameActive && gs.heroCardId) {
    var prevHero = state.heroCardId || "";
    if (!state.gameActive || (gs.heroCardId !== prevHero)) {
      isNewSession = true;
    }
  }

  // 映射随从数据：补充 name_cn 和 tribes_cn
  function mapMinion(m) {
    const card = getCard(m.cardId);
    return {
      cardId: m.cardId,
      name_cn: card ? card.name_cn : m.cardId,
      tier: m.tier || (card ? card.tier : 1),
      attack: m.attack || 0,
      health: m.health || 0,
      golden: m.golden || false,
      position: m.position || 0,
      tribes_cn: card ? card.minion_types_cn || [] : (m.tribes || []),
    };
  }

  state.gameActive = gs.gameActive;
  state.turn = gs.turn || 1;
  state.gold = gs.gold || 0;
  state.maxGold = gs.maxGold || 3;
  state.tavernTier = gs.tavernTier || 1;
  state.health = gs.health || 30;
  state.heroCardId = gs.heroCardId || "";
  state.heroName = gs.heroName || (gs.heroCardId ? getCardName(gs.heroCardId) : "");
  state.gamePhase = gs.gamePhase || "shop";
  state.isHeroSelection = gs.isHeroSelection || false;
  state.heroOptions = gs.heroOptions || [];
  state.heroSlotCount = gs.heroSlotCount || 0;
  state.availableRaces = gs.availableRaces || [];
  state.trinketOffer = gs.trinketOffer || [];
  state.trinketTurn = gs.trinketTurn || 0;
  state.boardMinions = (gs.boardMinions || []).map(mapMinion);
  state.handMinions = (gs.handMinions || []).map(mapMinion);

  // 分离商店中的随从和法术
  var shopMinions = [];
  var shopSpells = [];
  var allShop = gs.shopMinions || [];
  for (var si = 0; si < allShop.length; si++) {
    var sm = allShop[si];
    var card = getCard(sm.cardId);
    if (card && (card.card_type === "tavern" || card.card_type === "spell")) {
      shopSpells.push({
        cardId: sm.cardId,
        name_cn: getCardName(sm.cardId),
        cardType: card.card_type,
        text_cn: card.text_cn || "",
        position: sm.position || si,
      });
    } else {
      shopMinions.push({
        cardId: sm.cardId,
        name_cn: getCardName(sm.cardId),
        tier: sm.tier || (card ? card.tier : 1),
        tribes_cn: card ? card.minion_types_cn || [] : [],
        position: sm.position || si,
      });
    }
  }
  state.shopMinions = shopMinions;
  state.shopSpells = shopSpells;

  state.frozenShop = gs.frozenShop || false;
  state.freeRefreshCount = gs.freeRefreshCount || 0;
  state.hpRefreshRemaining = gs.hpRefreshRemaining || 0;

  // 存储对手数据
  state.opponents = gs.opponents || [];

  // 新对局 → 启动记录会话
  if (isNewSession && decisionsLogger) {
    decisionsLogger.startSession(state.heroCardId, state.heroName);
  }

  computeCombatPrediction();
  runDecisionEngine();
  renderAll();
}

// ═══════════════════════════════════════════
// 决策引擎（模块化）
// ═══════════════════════════════════════════

var orchestrator = null;
var decisionsLogger = null;

function initOrchestrator() {
  if (orchestrator) return;
  orchestrator = new Orchestrator();

  var dt = state.decisionTables || {};

  orchestrator.register(new LevelingModule(dt));
  orchestrator.register(new MinionPickModule(dt));
  orchestrator.register(new HeroPowerModule(dt));
  orchestrator.register(new SpellModule(dt));
  orchestrator.register(new TrinketModule(dt));
  orchestrator.register(new RefreshModule(dt));
  orchestrator.register(new FreezeModule(dt));
  orchestrator.register(new OpponentAnalysisModule({
    counter_tags: (dt && dt.counter_tags) || {},
    opponent_analysis: (dt && dt.opponent_analysis) || {},
  }));

  orchestrator.loadPriorityConfig(dt.priority_config || null);
}

function buildContext() {
  var boardPower = estimateBoardPower(state.boardMinions);
  var dominantTribe = getDominantTribe(state.boardMinions);
  var compMatches = matchBoardToComps(state.boardMinions);
  var currentComp = compMatches.length > 0 ? compMatches[0] : null;

  // 构建流派核心卡 ID 集合（用于自动加权）
  var coreCardIds = new Set();
  if (currentComp && currentComp.comp && currentComp.comp.cards) {
    for (var i = 0; i < currentComp.comp.cards.length; i++) {
      var c = currentComp.comp.cards[i];
      if (c.status === "CORE") coreCardIds.add(c.cardId || c.card_id || "");
    }
  }

  // Compute hero power cost from current hero's hp_ids
  var heroPowerCost = 0;
  var heroPowerUsable = state.heroPowerUsable !== false;
  if (state.heroCardId && state._heroHpMap) {
    var hpIds = state._heroHpMap[state.heroCardId];
    if (hpIds && hpIds.length > 0 && state._heroPowerCost) {
      heroPowerCost = state._heroPowerCost[hpIds[0]] || 0;
      // Cost 0 hero powers are typically passive — skip prompting
    }
  }

  // Check hero-specific tips for extra context
  var heroTipList = null;
  if (state.heroTips && state.heroCardId) {
    var ht = state.heroTips[state.heroCardId];
    if (ht && ht.tips) heroTipList = ht.tips;
  }

  return {
    turn: state.turn,
    gold: state.gold,
    maxGold: state.maxGold,
    tavernTier: state.tavernTier,
    health: state.health,
    heroCardId: state.heroCardId,
    heroName: state.heroName,
    boardMinions: state.boardMinions,
    handMinions: state.handMinions,
    shopMinions: state.shopMinions,
    gamePhase: state.gamePhase,
    heroTips: state.heroTips || null,
    heroTipList: heroTipList,
    heroStats: state._heroStatsMap || null,
    boardPower: boardPower,
    dominantTribe: dominantTribe,
    compMatches: compMatches,
    currentComp: currentComp,
    curveType: selectCurveType(),
    decisionTables: state.decisionTables,
    heroPowerCost: heroPowerCost,
    heroPowerUsable: heroPowerUsable,
    activeAnomaly: state.activeAnomaly || null,
    activeRewards: state.activeRewards || [],
    activeMechanics: {
      trinkets: (state.trinketOffer && state.trinketOffer.length > 0) || false,
      quests: (state.activeRewards && state.activeRewards.length > 0) || false,
      buddies: false,
      anomalies: state.activeAnomaly !== null,
    },
    shopSpells: state.shopSpells || [],
    trinketOffer: state.trinketOffer || [],
    trinketTurn: state.trinketTurn || 0,
    availableRaces: state.availableRaces || [],
    trinketTips: state.trinketTips || {},
    _heroHpMap: state._heroHpMap || {},
    _heroPowerCost: state._heroPowerCost || {},
    _compCoreCardIds: coreCardIds,
    _spellInteractions: _buildSpellInteractionLookup(state._spellInteractions),
    _cardsById: state.cards || null,
    _shopEvaluations: null,
    frozenShop: state.frozenShop,
    freeRefreshCount: state.freeRefreshCount,
    hpRefreshRemaining: state.hpRefreshRemaining,
    hasSmartRefresh: true,
  };
}

// ── 将 spell_interactions.json 的数组转为 cardId lookup sets ──
function _buildSpellInteractionLookup(raw) {
  if (!raw) return null;
  var result = {
    buffAmplifierIds: {},
    castTriggerIds: {},
    duplicatorIds: {},
    generatorIds: {},
    costReducerIds: {},
    trinketInteractIds: {},
  };
  var keys = ["spell_buff_amplifiers", "spell_cast_triggers", "spell_duplicators",
              "spell_generators", "spell_cost_reducers"];
  var targets = [result.buffAmplifierIds, result.castTriggerIds, result.duplicatorIds,
                 result.generatorIds, result.costReducerIds];
  for (var k = 0; k < keys.length; k++) {
    var arr = raw[keys[k]];
    if (arr) {
      for (var a = 0; a < arr.length; a++) {
        targets[k][arr[a].id] = true;
      }
    }
  }
  // 饰品交互：合并所有 spell 相关 trinket
  var trinketKeys = ["spell_buff_amplifiers", "spell_duplicators", "spell_generators",
                     "spell_cast_triggers", "spell_cost_reducers"];
  for (var tk = 0; tk < trinketKeys.length; tk++) {
    var tArr = raw[trinketKeys[tk]];
    if (tArr) {
      for (var ta = 0; ta < tArr.length; ta++) {
        var entry = tArr[ta];
        if (entry.type === "trinket") {
          result.trinketInteractIds[entry.id] = true;
        }
      }
    }
  }
  return result;
}

function runDecisionEngine() {
  if (!state.decisionTables || !state.gameActive) {
    clearDecisionState();
    return;
  }

  // 确保 orchestrator 已初始化
  if (!orchestrator) initOrchestrator();

  var ctx = buildContext();
  var result = orchestrator.run(ctx);

  // 将 orchestrator 输出写入 state
  state.suggestion = result.primarySuggestion;
  state.secondaryHints = result.secondaryHints || [];
  state.highlightedCards = result.cardHighlights || [];
  state.compMatches = result.compPanelData.compMatches || [];
  state.currentComp = result.compPanelData.currentComp || null;

  // 记录本回合决策到反馈日志
  if (decisionsLogger) {
    decisionsLogger.logTurn(state);
  }
}

// ── 工具函数（保留在 overlay.js，供 buildContext 使用） ──

function estimateBoardPower(boardMinions) {
  const table = (state.decisionTables && state.decisionTables.board_power_estimation) || {};
  const base = table.minion_base_power || {
    1: 0.3, 2: 0.5, 3: 0.8, 4: 1.2, 5: 1.8, 6: 2.5, 7: 3.5,
  };
  const goldenMul = table.golden_multiplier || 1.5;

  let power = 0;
  for (const m of boardMinions) {
    let p = base[m.tier] || 0.3;
    if (m.golden) p *= goldenMul;
    power += p;
  }
  // Normalize by expected board size at this turn
  const expectedSize = Math.min(boardMinions.length, state.turn);
  return expectedSize > 0 ? power / expectedSize : 0;
}

function getDominantTribe(boardMinions) {
  const counts = {};
  for (const m of boardMinions) {
    for (const t of m.tribes_cn || []) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  if (Object.keys(counts).length === 0) return null;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function matchBoardToComps(boardMinions) {
  const table = (state.decisionTables && state.decisionTables.comp_matching) || {};
  const minOverlap = table.min_overlap_for_match || 2;
  const displayMax = table.display_max_comps || 3;
  const coreThreshold = table.core_weight_threshold || 7;

  const boardCardIds = new Set(boardMinions.map((m) => m.cardId));
  const matches = [];

  for (const comp of state.compStrategies) {
    if (!comp.cards) continue;
    const compCardIds = comp.cards.map((c) => c.cardId || c.card_id || "");
    const overlap = compCardIds.filter((id) => boardCardIds.has(id));
    const overlapCount = overlap.length;
    const totalComp = compCardIds.length;
    const matchPercent = totalComp > 0 ? Math.round((overlapCount / totalComp) * 100) : 0;
    const missingCards = compCardIds.filter((id) => !boardCardIds.has(id));

    if (overlapCount >= minOverlap) {
      matches.push({
        comp,
        matchPercent,
        overlapCount,
        totalComp,
        missingCards,
        matchedCards: overlap,
      });
    }
  }

  matches.sort((a, b) => b.matchPercent - a.matchPercent);
  return matches.slice(0, displayMax);
}

function selectCurveType() {
  // 1. Check hero-specific overrides from decision_tables
  var heroOverrides = (state.decisionTables && state.decisionTables.leveling_curve &&
    state.decisionTables.leveling_curve.hero_overrides) || {};
  if (state.heroCardId && heroOverrides[state.heroCardId]) {
    return heroOverrides[state.heroCardId].curve_type || "standard";
  }

  // 2. Check hero_stats avg_position — top-tier heroes can play more aggressively
  if (state._heroStatsMap && state.heroCardId) {
    var hs = state._heroStatsMap[state.heroCardId];
    if (hs && hs.avg_position) {
      if (hs.avg_position <= 3.5) return "aggressive";
      if (hs.avg_position >= 5.0) return "defensive";
    }
  }

  // 3. Health-based fallback
  if (state.health <= 12) return "defensive";
  if (state.health >= 25 && state.tavernTier <= 2) return "aggressive";
  return "standard";
}

// ═══════════════════════════════════════════
// UI 渲染
// ═══════════════════════════════════════════

function renderSuggestionBadge() {
  var s = state.suggestion;
  var el = dom.suggestionBadge;
  if (!el) return;

  if (!s || !state.gameActive) {
    el.classList.add("hidden");
    return;
  }

  dom.sugText.textContent = s.message || "";

  // Color class — map Decision type to CSS class
  el.classList.remove("hidden", "danger", "refresh", "minimized", "hero-power", "spell", "freeze");
  if (state.badgeMinimized) el.classList.add("minimized");
  if (s.type === "danger") el.classList.add("danger");
  if (s.type === "refresh") el.classList.add("refresh");
  if (s.type === "hero_power") el.classList.add("hero-power");
  if (s.type === "spell_buy" || s.type === "spell_use") el.classList.add("spell");
  if (s.type === "freeze" || s.type === "unfreeze") el.classList.add("freeze");
  if (s.type === "refresh_smart") el.classList.add("refresh");

  // Reason tooltip — 含模块来源
  var sourceLabel = {
    LevelingModule: "升本策略",
    MinionPickModule: "选牌引擎",
    HeroPowerModule: "英雄技能",
    SpellModule: "法术评估",
    TrinketModule: "饰品分析",
    RefreshModule: "刷新策略",
    FreezeModule: "冻结策略",
  };
  var src = sourceLabel[s.source] || s.source || "";
  var conf = Math.round((s.confidence || 0) * 100);
  var tipText = (src ? "[" + src + "] " : "") + "置信度 " + conf + "%\n" + (s.reason || s.reasonShort || "");
  dom.sugReason.textContent = tipText;
  dom.sugReason.classList.add("hidden");

  // 次级提示条
  renderSecondaryHints();
}

function renderSecondaryHints() {
  var hints = state.secondaryHints || [];
  var container = document.getElementById("secondary-hints");
  if (!container) return;

  if (!state.gameActive || hints.length === 0) {
    container.classList.add("hidden");
    return;
  }

  var sourceLabel = {
    LevelingModule: "升本策略",
    MinionPickModule: "选牌引擎",
    HeroPowerModule: "英雄技能",
    SpellModule: "法术评估",
    TrinketModule: "饰品分析",
    RefreshModule: "刷新策略",
    FreezeModule: "冻结策略",
  };

  container.classList.remove("hidden");
  var html = "";
  for (var i = 0; i < Math.min(hints.length, 4); i++) {
    var h = hints[i];
    var icon = _hintIcon(h.type);
    var label = h.message || h.action || "";
    var src = sourceLabel[h.source] || h.source || "";
    var conf = Math.round((h.confidence || 0) * 100);
    var tooltip = (src ? "[" + src + "] " : "") + "置信度 " + conf + "%" +
      (h.reason ? "\n" + h.reason : "");
    html += '<span class="hint-item ' + (h.type || "") + '" title="' + tooltip.replace(/"/g, "&quot;") + '">' + icon + " " + label + "</span>";
  }
  container.innerHTML = html;
}

function _hintIcon(type) {
  switch (type) {
    case "hero_power": return "&#9889;";
    case "spell_buy":
    case "spell_use": return "&#128220;";
    case "trinket_pick": return "&#128142;";
    case "refresh":
    case "refresh_smart": return "&#128259;";
    case "minion_pick": return "&#9764;";
    case "freeze": return "&#10052;";
    case "unfreeze": return "&#9728;";
    default: return "&#9654;";
  }
}

function renderCardHighlights() {
  var container = dom.cardHighlights;
  if (!container) return;
  container.innerHTML = "";
  if (!state.gameActive) return;

  // 参考分辨率缩放
  var refW = 1920, refH = 1080;
  var scaleX = window.innerWidth / refW;
  var scaleY = window.innerHeight / refH;

  // 商店卡牌参考坐标
  var refCardY = 780, refCardW = 134, refCardH = 173;
  var refStartX = 500, refGapX = 157;
  var shopY = Math.round(refCardY * scaleY);
  var cardW = Math.round(refCardW * scaleX);
  var cardH = Math.round(refCardH * scaleY);
  var startX = Math.round(refStartX * scaleX);
  var gapX = Math.round(refGapX * scaleX);

  // ── 买随从费用判断（统一由 RulesEngine 计算洋葱层修正） ──
  var buyCost = RulesEngine.getBuyCost(state);
  var firstMinionFree = RulesEngine.isFirstMinionFree(state);
  var maxBuys = RulesEngine.getMaxBuys(state);

  // ── 1. 用途标签（右上角） + 购买图标（左侧），按权重截取 ──
  var sorted = (state.highlightedCards || []).slice().sort(function (a, b) {
    return (b.weight || 0) - (a.weight || 0);
  });

  var purposeTags = { core: "核", power: "战", triple: "碰" };
  var markedCount = 0;

  for (var i = 0; i < sorted.length; i++) {
    var hc = sorted[i];
    if (!hc.highlightType) continue;

    // 铸币预算限制：权重>=5 的才有资格占预算位，碰(三连)不受预算限制
    if (hc.highlightType !== "triple" && hc.weight < 5) continue;
    if (hc.highlightType !== "triple" && markedCount >= maxBuys && maxBuys > 0) break;
    if (hc.highlightType !== "triple") markedCount++;

    var pos = hc.position;
    var left = startX + pos * gapX;

    var wrapper = document.createElement("div");
    wrapper.className = "card-marker";
    wrapper.style.left = left + "px";
    wrapper.style.top = shopY + "px";
    wrapper.style.width = cardW + "px";
    wrapper.style.height = cardH + "px";
    wrapper.title = (hc.reasonShort || "") + " | 权重 " + (hc.weight || 0);

    // 用途标签（右上角）
    var tagText = purposeTags[hc.highlightType] || "";
    if (tagText) {
      var tag = document.createElement("div");
      tag.className = "card-purpose-tag " + hc.highlightType;
      tag.textContent = tagText;
      wrapper.appendChild(tag);
    }

    // 行为图标（左侧边缘中部）
    var actionDot = document.createElement("div");
    var actionClass = hc.highlightType === "core" ? "buy_core" :
                      hc.highlightType === "triple" ? "buy_triple" :
                      hc.highlightType === "power" ? "buy_power" : "buy";
    actionDot.className = "card-action-dot " + actionClass;
    actionDot.textContent = "买";
    wrapper.appendChild(actionDot);

    container.appendChild(wrapper);
  }

  // ── 2. 出售标记：我方阵容非核心低战力随从 ──
  var coreSet = new Set();
  if (state.currentComp && state.currentComp.comp && state.currentComp.comp.cards) {
    var compCards = state.currentComp.comp.cards;
    for (var ci = 0; ci < compCards.length; ci++) {
      var cc = compCards[ci];
      if (cc.status === "CORE") {
        coreSet.add(cc.cardId || cc.card_id || "");
      }
    }
  }

  // 阵容卡牌参考坐标（下方偏左区域，7个位置）
  var refBoardY = 870, refBoardW = 120, refBoardH = 150;
  var refBoardStartX = 340, refBoardGapX = 128;
  var boardY = Math.round(refBoardY * scaleY);
  var boardCardW = Math.round(refBoardW * scaleX);
  var boardCardH = Math.round(refBoardH * scaleY);
  var boardStartX = Math.round(refBoardStartX * scaleX);
  var boardGapX = Math.round(refBoardGapX * scaleX);

  var sellSuggestions = findSellableMinions(coreSet);

  for (var si = 0; si < sellSuggestions.length; si++) {
    var sm = sellSuggestions[si];
    var sPos = sm.position;
    var sLeft = boardStartX + sPos * boardGapX;

    var sWrapper = document.createElement("div");
    sWrapper.className = "card-marker";
    sWrapper.style.left = sLeft + "px";
    sWrapper.style.top = boardY + "px";
    sWrapper.style.width = boardCardW + "px";
    sWrapper.style.height = boardCardH + "px";
    sWrapper.title = sm.reason || "可考虑出售换铸币";

    var sDot = document.createElement("div");
    sDot.className = "card-action-dot sell";
    sDot.textContent = "卖";
    sWrapper.appendChild(sDot);

    container.appendChild(sWrapper);
  }
}

// ── 出售判断：非核心、低星级、无三连潜力的随从 ──

function findSellableMinions(coreSet) {
  var result = [];
  var board = state.boardMinions || [];

  // 只在场面满员或急需铸币时标记出售
  var boardFull = board.length >= 7;
  var needGold = state.gold < 3 && board.length >= 4;

  if (!boardFull && !needGold) return result;

  // 统计卡牌出现次数（检测三连潜力）
  var cardCounts = {};
  for (var i = 0; i < board.length; i++) {
    var cid = board[i].cardId;
    cardCounts[cid] = (cardCounts[cid] || 0) + 1;
  }

  for (var j = 0; j < board.length; j++) {
    var m = board[j];
    var cid = m.cardId;

    // 跳过核心卡
    if (coreSet.has(cid)) continue;
    // 跳过金色卡
    if (m.golden) continue;
    // 跳过有对子潜力的卡（已有2张）
    if (cardCounts[cid] >= 2) continue;

    var tier = m.tier || 1;
    // 高星卡不轻易建议卖（5-6星通常有战力价值）
    if (tier >= 5) continue;

    // 1-2星非核心卡，在场面满员时最值得卖
    var reason = "";
    if (tier <= 2) {
      var bonusGold = hasSellBonus(cid);
      reason = "低星非核心，可出售换" + (bonusGold || 1) + "铸币";
    } else if (boardFull) {
      reason = "场面满员，非核心可替换";
    } else {
      continue;
    }

    result.push({
      cardId: cid,
      position: j,
      tier: tier,
      reason: reason,
    });
  }

  // 最多标记2个，避免用户误操作
  return result.slice(0, Math.min(result.length, boardFull ? 2 : 1));
}

function hasSellBonus(cardId) {
  // 委托给 RulesEngine 统一计算（洋葱层模型：基础1 + 英雄修正 + 饰品修正 + 畸变）
  var price = RulesEngine.getSellPrice(cardId, state);
  return price > 1 ? price : 0;
}

function renderCompPanel() {
  if (!dom.currentBoard) return;

  const match = state.currentComp;
  if (!match) {
    dom.compName.textContent = "未匹配到流派";
    dom.compMatch.textContent = "--";
    dom.currentBoard.innerHTML = renderMiniBoard(state.boardMinions, []);
    dom.targetBoard.innerHTML = "";
    dom.missingCards.innerHTML = "<div class='missing-item'>继续构建阵容以匹配流派</div>";
    dom.positionTip.textContent = "暂无可推荐的站位建议";
    dom.compAltSection.style.display = "none";
    return;
  }

  const comp = match.comp;
  const freshness = comp.freshness;
  let freshnessBadge = "";
  if (freshness) {
    const statusText = freshness.status === "fresh" ? "新鲜" : freshness.status === "stale" ? "较旧" : "过时";
    freshnessBadge = `<span class="fresh-badge ${freshness.status}" title="攻略新鲜度: ${freshness.score}/100&#10;卡牌完整度: ${freshness.cardValidity ? freshness.cardValidity.valid + '/' + freshness.cardValidity.total : '?'}&#10;当前版本Patch: ${freshness.currentPatch || '?'}">${statusText} ${freshness.score}</span>`;
  }
  dom.compName.innerHTML = (comp.name_cn || comp.name || "未知流派") + " " + freshnessBadge;
  dom.compMatch.textContent = `匹配度 ${match.matchPercent}%`;

  // Current board
  const coreCardIds = new Set(comp.cards.map((c) => c.cardId || c.card_id || ""));
  dom.currentBoard.innerHTML = renderMiniBoard(state.boardMinions, coreCardIds);

  // Target board
  dom.targetBoard.innerHTML = renderTargetBoard(comp, state.boardMinions);

  // Missing cards
  const missingNames = match.missingCards.map((id) => getCardName(id));
  dom.missingCards.innerHTML = match.missingCards
    .slice(0, 5)
    .map(
      (id, i) =>
        `<div class="missing-item">缺：${missingNames[i] || id} ${getCardTierStr(id)}</div>`
    )
    .join("") || "<div class='missing-item'>阵容已齐！</div>";

  // Position tip
  dom.positionTip.textContent = getPositionTip(comp);

  // Alternative comps
  const filter = state.freshnessFilter || "all";
  let altMatches = state.compMatches.slice(1);
  if (filter === "fresh") altMatches = altMatches.filter((m) => m.comp.freshness && m.comp.freshness.score >= 80);
  else if (filter === "no_outdated") altMatches = altMatches.filter((m) => !m.comp.freshness || m.comp.freshness.score >= 50);

  if (altMatches.length > 0) {
    dom.compAltSection.style.display = "block";
    dom.altComps.innerHTML = altMatches
      .map((m) => {
        const f = m.comp.freshness;
        let dot = "";
        let faded = "";
        if (f) {
          dot = `<span class="fresh-dot ${f.status}" title="新鲜度: ${f.score}"></span>`;
          if (f.status === "outdated") faded = ' style="opacity:0.5"';
        }
        return `<div class="alt-comp-item"${faded}>${dot}${m.comp.name_cn || m.comp.name} · 匹配度 ${m.matchPercent}%</div>`;
      })
      .join("");
  } else {
    dom.compAltSection.style.display = "none";
  }
}

function renderMiniBoard(minions, coreCardIds) {
  const slots = 7;
  let html = "";
  for (let i = 0; i < slots; i++) {
    const m = minions[i];
    if (m) {
      const isCore = coreCardIds.has(m.cardId);
      html += `<div class="mini-slot${isCore ? " core" : ""}">
        <span class="ms-name">${m.name_cn || getCardName(m.cardId)}</span>
      </div>`;
    } else {
      html += '<div class="mini-slot"><span class="ms-empty">?</span></div>';
    }
  }
  return html;
}

function renderTargetBoard(comp, currentMinions) {
  const boardCardIds = new Set(currentMinions.map((m) => m.cardId));
  const compCards = comp.cards || [];
  const slots = 7;
  let html = "";
  for (let i = 0; i < Math.min(slots, compCards.length); i++) {
    const c = compCards[i];
    const cid = c.cardId || c.card_id || "";
    const hasIt = boardCardIds.has(cid);
    html += `<div class="mini-slot${hasIt ? " core" : " missing"}">
      <span class="ms-name">${c.name || c.name_cn || getCardName(cid) || cid}</span>
      ${!hasIt ? '<span style="position:absolute;top:2px;right:2px;font-size:8px;color:var(--c-danger)">缺</span>' : ""}
    </div>`;
  }
  for (let i = compCards.length; i < slots; i++) {
    html += '<div class="mini-slot"><span class="ms-empty">-</span></div>';
  }
  return html;
}

function getCardTierStr(cardId) {
  const c = getCard(cardId);
  return c && c.tier ? `${c.tier}星` : "";
}

function getPositionTip(comp) {
  const tips = comp.tips || [];
  let text;
  if (tips.length > 0) {
    const tip = typeof tips[0] === "string" ? tips[0] : tips[0].tip || tips[0].summary || "";
    text = tip || "将核心随从放在嘲讽位后方，保护其不被早期攻击";
  } else {
    text = "将核心随从放在嘲讽位后方，保护其不被早期攻击";
  }
  if (tips[0] && tips[0].freshness && tips[0].freshness.status === "outdated") {
    text = "[攻略较旧，仅供参考] " + text;
  }
  return text;
}

// ═══════════════════════════════════════════
// 对战胜率预测（蒙特卡洛）
// ═══════════════════════════════════════════

function computeCombatPrediction() {
  // 仅在招募阶段且有对手数据时计算
  if (state.gamePhase !== "shop" && state.gamePhase !== "recruit") {
    state.combatPrediction = null;
    return;
  }

  var myBoard = state.boardMinions || [];
  if (myBoard.length === 0) {
    state.combatPrediction = null;
    return;
  }

  // 找到下一对手的 board（取第一个有 board 数据的对手）
  var oppBoard = null;
  var opponents = state.opponents || [];
  for (var oi = 0; oi < opponents.length; oi++) {
    var opp = opponents[oi];
    if (opp.boardMinions && opp.boardMinions.length > 0) {
      oppBoard = opp.boardMinions;
      break;
    }
  }

  if (!oppBoard || oppBoard.length === 0) {
    state.combatPrediction = null;
    return;
  }

  // 将 minion 映射为 CombatResolver 需要的格式
  function mapToUnit(minion) {
    var card = state.cards ? state.cards[minion.cardId] : null;
    return {
      cardId: minion.cardId,
      attack: minion.attack || 1,
      health: minion.health || 1,
      tier: minion.tier || (card ? card.tier : 1),
      golden: minion.golden || false,
      mechanics: card ? (card.mechanics || []) : [],
      tribes_cn: card ? (card.minion_types_cn || []) : [],
      position: minion.position || 0,
    };
  }

  var myUnits = myBoard.map(mapToUnit);
  var oppUnits = oppBoard.map(mapToUnit);

  // 蒙特卡洛：使用用户配置的模拟次数
  var SAMPLES = state.combatSimSamples || 200;
  var wins = 0, draws = 0, losses = 0;

  for (var s = 0; s < SAMPLES; s++) {
    var rng = new SeededRNG(s * 7919 + state.turn * 31);
    var result = CombatResolver.simulateCombat(myUnits, oppUnits, state.tavernTier, rng);

    if (result.win) {
      wins++;
    } else if (result.attackerAlive === 0 && result.defenderAlive === 0) {
      draws++;
    } else {
      losses++;
    }
  }

  state.combatPrediction = {
    winPct: Math.round((wins / SAMPLES) * 100),
    drawPct: Math.round((draws / SAMPLES) * 100),
    lossPct: Math.round((losses / SAMPLES) * 100),
    opponentHero: opponents.length > 0 ? opponents[0].heroCardId : null,
  };
}

function renderCombatPredictor() {
  var el = dom.combatPredictor;
  if (!el) return;

  if (!state.showCombatPredictor) {
    el.classList.add("hidden");
    return;
  }

  var pred = state.combatPrediction;

  if (!pred || !state.gameActive || state.gamePhase === "combat") {
    el.classList.add("hidden");
    return;
  }

  el.classList.remove("hidden");

  // 更新色段宽度
  dom.cpWinSeg.style.width = pred.winPct + "%";
  dom.cpDrawSeg.style.width = pred.drawPct + "%";
  dom.cpLossSeg.style.width = pred.lossPct + "%";

  // 更新百分比文字
  dom.cpWinPct.textContent = pred.winPct + "%";
  dom.cpDrawPct.textContent = pred.drawPct + "%";
  dom.cpLossPct.textContent = pred.lossPct + "%";

  // 修正色段圆角
  if (pred.winPct > 0) dom.cpWinSeg.style.borderRadius = "4px 0 0 4px";
  else dom.cpWinSeg.style.borderRadius = "0";
  if (pred.lossPct > 0) dom.cpLossSeg.style.borderRadius = "0 4px 4px 0";
  else dom.cpLossSeg.style.borderRadius = "0";
}

// ═══════════════════════════════════════════
// 英雄选择评分与展示
// ═══════════════════════════════════════════

function computeHeroScores(heroOptions) {
  var statsMap = state._heroStatsMap || {};
  var heroScores = [];
  var availableRaces = state.availableRaces || [];

  for (var i = 0; i < heroOptions.length; i++) {
    var opt = heroOptions[i];
    var stats = statsMap[opt.cardId];
    var name_cn = getCardName(opt.cardId);

    if (!stats) {
      heroScores.push({
        cardId: opt.cardId,
        name_cn: name_cn,
        score: 43,
        tier: "d",
        tierLabel: "D",
        avgPosition: 0,
        top4Rate: 0,
        dataPoints: 0,
        synergyTribes: [],
      });
      continue;
    }

    // rank_score: avg_position 越低越好 (1=最佳, 8=最差)
    var rankScore = (8.5 - stats.avg_position) / 7.5 * 55;

    // win_rate_score: 吃鸡率 + top4率
    var placements = stats.placements || [];
    var rank1 = placements.length > 0 ? placements[0].percentage || 0 : 0;
    var top4Rate = 0;
    for (var r = 0; r < placements.length && r < 4; r++) {
      top4Rate += placements[r].percentage || 0;
    }
    var winRateScore = (rank1 + top4Rate * 0.25) / 100 * 30;

    // data_confidence: 数据量信度
    var dataConf = Math.min(8, (stats.data_points || 0) / 15000 * 8);

    var baseScore = rankScore + winRateScore + dataConf;

    // tribe synergy: 与该局可用种族的适配度加成 (最多 +10)
    var tribeBonus = 0;
    var synergyTribes = [];
    var tribeStats = stats.tribe_stats || [];
    if (availableRaces.length > 0 && tribeStats.length > 0) {
      for (var t = 0; t < tribeStats.length; t++) {
        if (tribeStats[t].impactAveragePosition < -0.08) {
          tribeBonus += Math.abs(tribeStats[t].impactAveragePosition) * 35;
          synergyTribes.push(tribeStats[t].tribe);
        }
      }
    }
    tribeBonus = Math.min(10, tribeBonus);

    var score = Math.round(baseScore + tribeBonus);

    // S/A/B/C/D 五级映射 (参考 HDT/Firestone 评级体系)
    var tier, tierLabel;
    if (score >= 52)      { tier = "s"; tierLabel = "S"; }
    else if (score >= 49) { tier = "a"; tierLabel = "A"; }
    else if (score >= 46) { tier = "b"; tierLabel = "B"; }
    else if (score >= 44) { tier = "c"; tierLabel = "C"; }
    else                  { tier = "d"; tierLabel = "D"; }

    heroScores.push({
      cardId: opt.cardId,
      name_cn: name_cn,
      score: score,
      tier: tier,
      tierLabel: tierLabel,
      avgPosition: stats.avg_position,
      top4Rate: top4Rate,
      dataPoints: stats.data_points,
      synergyTribes: synergyTribes,
    });
  }

  // 按分数降序排序
  heroScores.sort(function(a, b) { return b.score - a.score; });

  return heroScores;
}

function renderHeroSelection() {
  var panel = dom.heroSelectPanel;
  if (!panel) return;

  if (!state.isHeroSelection || !state.heroOptions || state.heroOptions.length < 2) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");

  var scores = computeHeroScores(state.heroOptions);
  var list = dom.heroSelectList;
  if (!list) return;

  // 更新 header 显示槽位数
  var header = panel.querySelector(".hero-select-header");
  var slotCount = state.heroSlotCount || state.heroOptions.length;
  if (header) {
    header.textContent = "选择英雄 (" + slotCount + "选1)";
  }

  var html = "";
  for (var i = 0; i < scores.length; i++) {
    var h = scores[i];
    var rankText = h.avgPosition > 0 ? h.avgPosition.toFixed(1) : "--";
    var top4Text = h.top4Rate > 0 ? h.top4Rate.toFixed(0) + "%" : "";

    html += '<div class="hero-option hero-tier-' + h.tier + '">';
    html += '<span class="hero-tier-badge">' + h.tierLabel + '</span>';
    html += '<span class="hero-option-name">' + h.name_cn + '</span>';
    html += '<span class="hero-option-stats">';
    html += '<span class="hero-avg-rank" title="平均排名">#' + rankText + '</span>';
    if (top4Text) {
      html += '<span class="hero-top4" title="前四率">T4 ' + top4Text + '</span>';
    }
    html += '</span>';
    html += '</div>';
  }

  list.innerHTML = html;
}

// ═══════════════════════════════════════════
// 饰品选择评分与展示
// ═══════════════════════════════════════════

function computeTrinketScores(trinketOffer) {
  var results = [];
  var dominantTribe = getDominantTribe(state.boardMinions);
  var boardKeywords = [];
  for (var bi = 0; bi < (state.boardMinions || []).length; bi++) {
    var card = state.cards && state.cards[state.boardMinions[bi].cardId];
    if (card && card.mechanics) {
      boardKeywords = boardKeywords.concat(card.mechanics);
    }
  }

  var context = {
    dominantTribe: dominantTribe || "",
    boardKeywords: boardKeywords,
    health: state.health,
    availableRaces: state.availableRaces || [],
  };

  for (var i = 0; i < trinketOffer.length; i++) {
    var trinket = trinketOffer[i];
    var cardId = trinket.cardId || "";

    // 1. 优先使用预计算权重
    var weights = (state.decisionTables && state.decisionTables.trinket_weights) || {};
    var w = weights[cardId];

    if (w) {
      results.push({
        cardId: cardId,
        name_cn: trinket.name_cn || cardId,
        text_cn: trinket.text_cn || "",
        score: w.score,
        tier: w.tier || "B",
        reason: w.reason || "",
        dimensions: w.dimensions || {},
        source: "precomputed",
      });
      continue;
    }

    // 2. 回退: MechanicScoring 文本分析
    if (typeof MechanicScoring !== "undefined") {
      var card = { cardId: cardId, name_cn: trinket.name_cn, text_cn: trinket.text_cn, tier: 3 };
      var ms = MechanicScoring.score(card, context);

      // 社区 tips 置信度加成
      var tips = (state.trinketTips || {})[cardId];
      if (tips && tips.tips && tips.tips.length > 0) {
        var freshCount = 0;
        for (var t = 0; t < tips.tips.length; t++) {
          if (tips.tips[t].freshness && tips.tips[t].freshness.status !== "outdated") {
            freshCount++;
          }
        }
        if (freshCount >= 2) ms.totalScore = Math.min(10, ms.totalScore + 1);
      }

      var tier = ms.tier;
      results.push({
        cardId: cardId,
        name_cn: trinket.name_cn || cardId,
        text_cn: trinket.text_cn || "",
        score: ms.totalScore,
        tier: tier,
        reason: (ms.reasons || []).join("; ") || "文本分析评分",
        dimensions: ms.dimensions || {},
        source: "text_analysis",
      });
    } else {
      // 3. 无数据回退
      results.push({
        cardId: cardId,
        name_cn: trinket.name_cn || cardId,
        text_cn: trinket.text_cn || "",
        score: 3,
        tier: "C",
        reason: "暂无评分数据",
        dimensions: {},
        source: "fallback",
      });
    }
  }

  results.sort(function(a, b) { return b.score - a.score; });
  return results;
}

function renderTrinketSelection() {
  var panel = dom.trinketSelectPanel;
  if (!panel) return;

  var offers = state.trinketOffer || [];
  if (offers.length === 0 || !state.gameActive) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");

  var scores = computeTrinketScores(offers);
  var list = dom.trinketSelectList;
  if (!list) return;

  var header = panel.querySelector(".trinket-select-header");
  if (header) {
    header.textContent = "选择饰品 (回合" + (state.trinketTurn || "?") + ")";
  }

  var html = "";
  for (var i = 0; i < scores.length; i++) {
    var t = scores[i];
    var tierClass = "trinket-tier-" + t.tier.toLowerCase();
    html += '<div class="trinket-option ' + tierClass + '">';
    html += '<span class="trinket-tier-badge">' + t.tier + '</span>';
    html += '<span class="trinket-option-name">' + t.name_cn + '</span>';
    html += '<span class="trinket-option-reason" title="' + t.reason.replace(/"/g, "&quot;") + '">' + (t.reason || "") + '</span>';
    html += '</div>';
  }

  list.innerHTML = html;
}

function renderFreezeIndicator() {
  var el = document.getElementById("freeze-indicator");
  if (!el) return;
  if (state.frozenShop && state.gamePhase === "shop" && state.gameActive) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderAll() {
  renderSuggestionBadge();
  renderCardHighlights();
  renderCompPanel();
  renderDisconnectButton();
  renderCombatPredictor();
  renderHeroSelection();
  renderTrinketSelection();
  renderFreezeIndicator();
}

// ═══════════════════════════════════════════
// 拔线按钮渲染
// ═══════════════════════════════════════════

function renderDisconnectButton() {
  const status = state.disconnectStatus;
  dom.dcDot.className = "dc-dot " + status;

  if (status === "disconnecting") {
    dom.disconnectBtn.classList.add("active");
    dom.dcRing.classList.add("active");
    dom.dcLabel.textContent = "拔线中...";
  } else {
    dom.disconnectBtn.classList.remove("active");
    dom.dcRing.classList.remove("active");
    dom.dcLabel.textContent = "一键拔线";
  }
}

// ═══════════════════════════════════════════
// Demo 模式
// ═══════════════════════════════════════════

function applyDemoScenario(index) {
  if (index >= DEMO_SCENARIOS.length) {
    // Loop back to start
    index = 0;
  }
  const scenario = DEMO_SCENARIOS[index];
  state.demoTurnIndex = index;
  state.gameActive = true;
  state.turn = scenario.turn;
  state.gold = scenario.gold;
  state.maxGold = scenario.maxGold;
  state.tavernTier = scenario.tavernTier;
  state.health = scenario.health;
  state.heroCardId = scenario.heroCardId;
  state.heroName = scenario.heroName;
  state.boardMinions = scenario.boardMinions;
  state.shopMinions = scenario.shopMinions;
  state.gamePhase = scenario.gamePhase;

  computeCombatPrediction();
  runDecisionEngine();
  renderAll();
  updateDemoIndicator();
}

function clearDecisionState() {
  state.suggestion = null;
  state.secondaryHints = [];
  state.highlightedCards = [];
  state.compMatches = [];
  state.currentComp = null;
  state.combatPrediction = null;
}

function nextDemoTurn() {
  const next = state.demoTurnIndex + 1;
  applyDemoScenario(next >= DEMO_SCENARIOS.length ? 0 : next);
}

function toggleDemoMode() {
  state.demoMode = !state.demoMode;
  if (state.demoMode) {
    dom.demoIndicator.classList.remove("hidden");
    applyDemoScenario(0);
  } else {
    dom.demoIndicator.classList.add("hidden");
    state.gameActive = false;
    clearDecisionState();
    renderAll();
  }
}

function updateDemoIndicator() {
  if (state.demoMode) {
    dom.demoTurn.textContent = `回合 ${state.turn} | ${state.heroName} | ${state.tavernTier}本 | ${state.gold}费 | ${state.health}血`;
  }
}

// ═══════════════════════════════════════════
// 事件处理
// ═══════════════════════════════════════════

function setupEvents() {
  // ── 拔线按钮 ──
  dom.disconnectBtn.addEventListener("click", async () => {
    if (state.disconnectStatus === "disconnecting") return;

    // Always show visual feedback immediately (don't wait for netsh result)
    state.disconnectStatus = "disconnecting";
    renderDisconnectButton();
    showDcToast("拔线中，3秒后自动重连");

    // Try actual firewall block (may fail without admin, but visuals already work)
    window.bobCoach.triggerDisconnect();

    // Auto-revert visuals after 3 seconds
    clearTimeout(state._dcRevertTimer);
    state._dcRevertTimer = setTimeout(() => {
      state.disconnectStatus = "online";
      renderDisconnectButton();
      hideDcToast();
    }, 3000);
  });

  setupDisconnectDrag();

  // ── 齿轮菜单 ──
  dom.gearIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_gearWasDragged) {
      _gearWasDragged = false;
      return;
    }
    state.gearMenuOpen = !state.gearMenuOpen;
    dom.gearDropdown.classList.toggle("hidden", !state.gearMenuOpen);
  });

  dom.gearDropdown.addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    state.gearMenuOpen = false;
    dom.gearDropdown.classList.add("hidden");

    switch (action) {
      case "toggle-demo":
        toggleDemoMode();
        break;
      case "next-turn":
        if (state.demoMode) nextDemoTurn();
        break;
      case "toggle-panel":
        toggleCompPanel();
        break;
      case "open-settings":
        openSettings();
        break;
      case "open-legend":
        openLegend();
        break;
      case "open-rules":
        openRules();
        break;
      case "open-about":
        openAbout();
        break;
      case "quit":
        showQuitDialog();
        break;
    }
  });

  // 点击其他地方关闭齿轮菜单
  document.addEventListener("click", () => {
    if (state.gearMenuOpen) {
      state.gearMenuOpen = false;
      dom.gearDropdown.classList.add("hidden");
    }
  });

  setupGearDrag();

  // ── 阵容面板 ──
  dom.compHandle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCompPanel();
  });
  $("comp-close-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeCompPanel();
  });

  setupCompPanelDrag();

  // ── 建议徽章 hover/minimize ──
  dom.suggestionBadge.addEventListener("mouseenter", () => {
    if (state.badgeMinimized) {
      state.badgeMinimized = false;
      dom.suggestionBadge.classList.remove("minimized");
    }
    dom.sugReason.classList.remove("hidden");
  });
  dom.suggestionBadge.addEventListener("mouseleave", () => {
    dom.sugReason.classList.add("hidden");
  });
  dom.suggestionBadge.addEventListener("click", () => {
    // Open tactical board with detail
    openTacticalBoard();
  });

  // ── 协议对话框 ──
  $("btn-local-mode").addEventListener("click", () => acceptAgreement("local"));
  $("btn-cloud-mode").addEventListener("click", () => acceptAgreement("cloud"));

  // ── 设置面板关闭 ──
  dom.tacticalClose.addEventListener("click", closeTacticalBoard);
  $("settings-close").addEventListener("click", closeSettings);
  $("about-close").addEventListener("click", closeAbout);

  // ── 退出确认对话框 ──
  $("btn-quit-app").addEventListener("click", async () => {
    await window.bobCoach.quitApp();
  });
  $("btn-quit-tray").addEventListener("click", async () => {
    hideQuitDialog();
    await window.bobCoach.hideWindow();
  });
  $("btn-quit-cancel").addEventListener("click", hideQuitDialog);

  // ── 设置控件即时预览 ──
  $("set-show-combat").addEventListener("change", (e) => {
    $("combat-samples-row").style.display = e.target.checked ? "flex" : "none";
  });
  $("set-font-size").addEventListener("input", (e) => {
    applyFontSize(parseInt(e.target.value));
    $("font-size-val").textContent = e.target.value + "px";
    $("font-preview").classList.remove("hidden");
  });
  $("set-font-family").addEventListener("change", (e) => {
    applyFontFamily(e.target.value);
    $("font-preview").classList.remove("hidden");
  });
  $("set-transparency").addEventListener("input", (e) => {
    $("transparency-val").textContent = Math.round(parseFloat(e.target.value) * 100) + "%";
    window.bobCoach.setSetting("transparency", parseFloat(e.target.value));
  });
  $("set-tip-opacity").addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    applyTipOpacity(val);
    $("tip-opacity-val").textContent = Math.round(val * 100) + "%";
  });

  // ── 账号管理 ──
  $("btn-account-register").addEventListener("click", handleRegister);
  $("btn-account-login").addEventListener("click", handleLogin);
  $("btn-account-logout").addEventListener("click", handleLogout);
  $("btn-export-data").addEventListener("click", handleExportData);
  $("btn-import-data").addEventListener("click", handleImportData);
  $("btn-delete-data").addEventListener("click", handleDeleteData);
  dom.setPrivacyLevel.addEventListener("change", handlePrivacyChange);
  $("api-endpoints-toggle").addEventListener("click", function() {
    var list = dom.apiEndpointsList;
    if (list.classList.contains("hidden")) {
      list.classList.remove("hidden");
      $("api-endpoints-toggle").innerHTML = "&#128225; 云端 API 接口状态 &#9650;";
    } else {
      list.classList.add("hidden");
      $("api-endpoints-toggle").innerHTML = "&#128225; 云端 API 接口状态 &#9660;";
    }
  });

  // ── 数据同步 ──
  $("btn-check-update").addEventListener("click", checkForUpdates);
  $("btn-apply-update").addEventListener("click", applyUpdates);
  $("btn-dismiss-update").addEventListener("click", () => {
    $("sync-update-banner").classList.add("hidden");
    state.pendingUpdates = null;
  });

  // ── 设置保存/取消 ──
  $("btn-save-settings").addEventListener("click", saveSettings);
  $("btn-cancel-settings").addEventListener("click", closeSettings);

  // ── IPC 事件监听 ──
  window.bobCoach.on("window-moved", (rect) => {
    // Positional recalculation can happen here
    // Re-render highlights with new window size
    if (state.gameActive) renderCardHighlights();
  });

  window.bobCoach.on("disconnect:state-changed", (status) => {
    state.disconnectStatus = status;
    renderDisconnectButton();
    if (status === "online") {
      hideDcToast();
    } else if (status === "disconnecting") {
      showDcToast("拔线中，3秒后自动重连");
    }
  });

  window.bobCoach.on("toggle-panel", toggleCompPanel);
  window.bobCoach.on("open-settings", openSettings);
  window.bobCoach.on("open-about", openAbout);

  // ── 实时游戏状态（来自 HDT 日志解析） ──
  window.bobCoach.on("game-state-update", (gameState) => {
    if (!gameState || !gameState.gameActive) return;

    // 真实对局开始 → 禁用 demo 模式
    if (state.demoMode) {
      state.demoMode = false;
      dom.demoIndicator.classList.add("hidden");
    }

    applyGameState(gameState);
  });

  window.bobCoach.on("sync:update-available", (available) => {
    showUpdateAvailable(available);
  });

  window.bobCoach.on("sync:applied", async (result) => {
    // Reload all data into decision engine
    await loadAllData();
    runDecisionEngine();
    renderAll();
    await refreshSyncStatus();
    if ($("sync-update-banner")) $("sync-update-banner").classList.add("hidden");
    state.pendingUpdates = null;
    console.log("[Bob] Data reloaded after sync:", result.applied);
  });
}

// ═══════════════════════════════════════════
// 面板控制
// ═══════════════════════════════════════════

function toggleCompPanel() {
  state.panelOpen = !state.panelOpen;
  if (state.panelOpen) {
    dom.compPanel.classList.remove("hidden");
    dom.compHandle.title = "点击收起教练面板";
    $("comp-handle-icon").classList.add("flipped");
    renderCompPanel();
  } else {
    dom.compPanel.classList.add("hidden");
    dom.compHandle.title = "点击展开教练面板";
    $("comp-handle-icon").classList.remove("flipped");
  }
}

function closeCompPanel() {
  state.panelOpen = false;
  dom.compPanel.classList.add("hidden");
  dom.compHandle.title = "点击展开教练面板";
  $("comp-handle-icon").classList.remove("flipped");
}

// ═══════════════════════════════════════════
// 阵容面板拖拽（基于 transform 偏移，不冲突 CSS right 定位）
// ═══════════════════════════════════════════

function setupCompPanelDrag() {
  const panel = dom.compPanel;

  // Restore saved drag offset
  _compDx = parseInt(state.compPanelDx) || 0;
  _compDy = parseInt(state.compPanelDy) || 0;
  if (_compDx || _compDy) {
    applyCompPanelOffset(_compDx, _compDy);
  }

  // Drag from the handle tab
  dom.compHandle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    compDragInfo = {
      startX: e.clientX,
      startY: e.clientY,
      origDx: _compDx,
      origDy: _compDy,
    };
    panel.style.transition = "none";
  });

  // Also allow drag from the panel header when open
  const header = dom.compContent.querySelector(".comp-header");
  if (header) {
    header.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button")) return;
      e.preventDefault();
      compDragInfo = {
        startX: e.clientX,
        startY: e.clientY,
        origDx: _compDx,
        origDy: _compDy,
      };
      panel.style.transition = "none";
    });
  }

  document.addEventListener("mousemove", (e) => {
    if (!compDragInfo) return;
    _compDx = compDragInfo.origDx + (e.clientX - compDragInfo.startX);
    _compDy = compDragInfo.origDy + (e.clientY - compDragInfo.startY);
    applyCompPanelOffset(_compDx, _compDy);
  });

  document.addEventListener("mouseup", () => {
    if (!compDragInfo) return;
    panel.style.transition = "";
    state.compPanelDx = String(Math.round(_compDx));
    state.compPanelDy = String(Math.round(_compDy));
    window.bobCoach.setSetting("compPanelDx", state.compPanelDx);
    window.bobCoach.setSetting("compPanelDy", state.compPanelDy);
    compDragInfo = null;
  });
}

function applyCompPanelOffset(dx, dy) {
  dom.compPanel.style.transform = `translate(${dx}px, ${dy}px)`;
}

function openTacticalBoard() {
  var s = state.suggestion;
  if (!s) return;

  var titleMap = {
    level_up: "升本决策分析",
    danger: "危险警告",
    minion_pick: "选牌决策分析",
    hero_power: "技能使用分析",
    spell_buy: "法术购买分析",
    spell_use: "法术使用分析",
    trinket_pick: "饰品选择分析",
    refresh: "搜牌决策分析",
    refresh_smart: "智能搜牌分析",
    freeze: "冻结酒馆分析",
    unfreeze: "解冻提醒分析",
  };
  dom.tacticalTitle.textContent = titleMap[s.type] || "决策分析";

  // 汇总所有建议（主要 + 次级）
  var allDecisions = [];
  if (s) allDecisions.push(s);
  var hints = state.secondaryHints || [];
  for (var i = 0; i < hints.length; i++) {
    allDecisions.push(hints[i]);
  }

  // 模块来源中文映射
  var sourceLabel = {
    LevelingModule: "升本策略",
    MinionPickModule: "选牌引擎",
    HeroPowerModule: "英雄技能",
    SpellModule: "法术评估",
    TrinketModule: "饰品分析",
    RefreshModule: "刷新策略",
    FreezeModule: "冻结策略",
  };

  var html = "";
  for (var j = 0; j < allDecisions.length; j++) {
    var d = allDecisions[j];
    var isPrimary = (j === 0);
    var src = sourceLabel[d.source] || d.source || "决策引擎";
    var confPct = Math.round((d.confidence || 0) * 100);
    var confColor = confPct >= 70 ? "var(--c-accent)" : confPct >= 40 ? "var(--c-secondary)" : "var(--text-muted)";

    html += '<div class="dc-card' + (isPrimary ? ' primary' : '') + '">';
    html += '<div class="dc-card-head">';
    html += '<span class="dc-card-type">' + (d.message || d.action || "") + '</span>';
    html += '<span class="dc-card-src">' + src + '</span>';
    html += '</div>';
    html += '<div class="dc-card-body">' + (d.reason || "暂无详细分析").replace(/\n/g, "<br>") + '</div>';
    html += '<div class="dc-card-foot">';
    html += '<span class="dc-conf-bar" style="width:' + confPct + '%;background:' + confColor + '"></span>';
    html += '<span class="dc-conf-label" style="color:' + confColor + '">置信度 ' + confPct + '%</span>';
    html += '</div>';
    html += '</div>';
  }

  dom.tacticalBody.innerHTML = html;
  dom.tacticalBoard.classList.remove("hidden");
}

function closeTacticalBoard() {
  dom.tacticalBoard.classList.add("hidden");
}

async function refreshSyncStatus() {
  try {
    const status = await window.bobCoach.getSyncStatus();
    if (dom.syncCardsVer) dom.syncCardsVer.textContent = status.cardsVersion;
    if (dom.syncHeroDate) dom.syncHeroDate.textContent = status.heroStatsDate;
    if (dom.syncCompCount) dom.syncCompCount.textContent = status.compStrategyCount;
    if (dom.syncLastCheck) {
      dom.syncLastCheck.textContent = status.lastSyncCheck
        ? new Date(status.lastSyncCheck).toLocaleString("zh-CN")
        : "从未检查";
    }
    return status;
  } catch (e) {
    console.error("[Bob] Sync status load failed:", e);
  }
}

function showUpdateAvailable(available) {
  const names = {
    cards: "卡牌图鉴",
    heroStats: "英雄胜率",
    compStrategies: "流派策略",
    heroStrategies: "英雄策略",
    trinketTips: "饰品策略",
  };
  const list = Object.keys(available)
    .map((k) => {
      const n = names[k] || k;
      const detail = available[k];
      if (detail.count !== undefined) {
        return `${n}: ${detail.oldCount} → ${detail.count} 条`;
      }
      if (detail.version) return `${n}: ${detail.oldVersion} → ${detail.version}`;
      if (detail.date) return `${n}: 更新于 ${detail.date}`;
      return `${n}: 有更新`;
    })
    .join("\n");

  // Show inline update banner in settings
  if ($("sync-update-banner")) {
    $("sync-update-banner").classList.remove("hidden");
    $("sync-update-text").textContent = list;
  }

  // Store available updates for apply
  state.pendingUpdates = Object.keys(available);
}

async function checkForUpdates() {
  if (!dom.btnCheckUpdate) return;
  dom.btnCheckUpdate.disabled = true;
  dom.btnCheckUpdate.textContent = "检查中...";

  try {
    const result = await window.bobCoach.checkSyncUpdates();
    await refreshSyncStatus();

    const keys = Object.keys(result.available);
    if (keys.length > 0) {
      showUpdateAvailable(result.available);
    } else {
      if ($("sync-update-banner")) $("sync-update-banner").classList.add("hidden");
      // Brief "已是最新" feedback
      dom.btnCheckUpdate.textContent = "已是最新 ✓";
      setTimeout(() => {
        if (dom.btnCheckUpdate) {
          dom.btnCheckUpdate.textContent = "检查更新";
          dom.btnCheckUpdate.disabled = false;
        }
      }, 2000);
      return;
    }
  } catch (e) {
    console.error("[Bob] Check updates failed:", e);
    dom.btnCheckUpdate.textContent = "网络错误 - 重试";
    // Also show error in sync status area
    if (dom.syncLastCheck) dom.syncLastCheck.textContent = "检查失败: " + (e.message || "网络异常");
  }

  dom.btnCheckUpdate.textContent = "检查更新";
  dom.btnCheckUpdate.disabled = false;
}

async function applyUpdates() {
  if (!state.pendingUpdates || state.pendingUpdates.length === 0) return;
  if (!dom.btnCheckUpdate) return;
  dom.btnCheckUpdate.disabled = true;
  dom.btnCheckUpdate.textContent = "更新中...";

  try {
    const result = await window.bobCoach.applySyncUpdates(state.pendingUpdates);
    if (result.errors.length > 0) {
      // 展示具体错误信息
      dom.btnCheckUpdate.textContent = "部分失败 - 重试";
      if ($("sync-update-text")) {
        $("sync-update-text").textContent = "更新出错: " + result.errors.join("; ");
        $("sync-update-banner").classList.remove("hidden");
      }
      console.error("[Bob] Some updates failed:", result.errors);
    }
    if (result.applied.length > 0) {
      await loadAllData();
      runDecisionEngine();
      renderAll();
      await refreshSyncStatus();

      if ($("sync-update-banner")) $("sync-update-banner").classList.add("hidden");
      state.pendingUpdates = null;

      dom.btnCheckUpdate.textContent = "更新完成 ✓";
      setTimeout(function () {
        if (dom.btnCheckUpdate) {
          dom.btnCheckUpdate.textContent = "检查更新";
          dom.btnCheckUpdate.disabled = false;
        }
      }, 3000);
    }
  } catch (e) {
    console.error("[Bob] Apply updates failed:", e);
    dom.btnCheckUpdate.textContent = "网络错误 - 重试";
    if ($("sync-update-text")) {
      $("sync-update-text").textContent = "网络连接失败: " + (e.message || "请检查网络后重试");
      $("sync-update-banner").classList.remove("hidden");
    }
  }
  dom.btnCheckUpdate.disabled = false;
}

function openSettings() {
  state.settingsOpen = true;
  dom.settingsOverlay.classList.remove("hidden");
  // Load current values into form
  $("set-transparency").value = state.transparency || 0.7;
  $("transparency-val").textContent = Math.round((state.transparency || 0.7) * 100) + "%";
  $("set-shortcut").value = state.disconnectShortcut || "F5";
  $("set-show-dc-btn").checked = state.showDcBtn !== false;
  $("set-dc-scope").value = state.dcShortcutScope || "always";
  $("set-show-combat").checked = state.showCombatPredictor !== false;
  $("set-combat-samples").value = String(state.combatSimSamples || 200);
  $("combat-samples-row").style.display = state.showCombatPredictor !== false ? "flex" : "none";
  $("set-freshness-filter").value = state.freshnessFilter || "all";
  $("set-font-family").value = state.fontFamily || "default";
  $("set-font-size").value = state.fontSize || 13;
  $("font-size-val").textContent = (state.fontSize || 13) + "px";
  $("set-tip-opacity").value = state.tipOpacity || 0.3;
  $("tip-opacity-val").textContent = Math.round((state.tipOpacity || 0.3) * 100) + "%";

  // Refresh account UI
  refreshAccountUI();

  // Refresh sync status
  refreshSyncStatus();
}

function closeSettings() {
  state.settingsOpen = false;
  dom.settingsOverlay.classList.add("hidden");
  // Restore actual saved values (revert preview)
  $("set-transparency").value = state.transparency || 0.7;
  $("set-shortcut").value = state.disconnectShortcut || "F5";
  $("set-show-dc-btn").checked = state.showDcBtn !== false;
  $("set-dc-scope").value = state.dcShortcutScope || "always";
  $("set-show-combat").checked = state.showCombatPredictor !== false;
  $("set-combat-samples").value = String(state.combatSimSamples || 200);
  applyDcBtnVisibility(state.showDcBtn !== false);
  $("set-font-family").value = state.fontFamily || "default";
  $("set-font-size").value = state.fontSize || 13;
  $("set-tip-opacity").value = state.tipOpacity || 0.3;
  applyFontFamily(state.fontFamily || "default");
  applyFontSize(state.fontSize || 13);
  applyTipOpacity(state.tipOpacity || 0.3);
}

async function saveSettings() {
  const transparency = parseFloat($("set-transparency").value);
  const tipOpacity = parseFloat($("set-tip-opacity").value);
  const shortcut = $("set-shortcut").value;
  const showDcBtn = $("set-show-dc-btn").checked;
  const dcScope = $("set-dc-scope").value;
  const freshnessFilter = $("set-freshness-filter").value;
  const fontFamily = $("set-font-family").value;
  const fontSize = parseInt($("set-font-size").value);
  const showCombat = $("set-show-combat").checked;
  const combatSamples = parseInt($("set-combat-samples").value);

  // Apply immediately
  applyFontFamily(fontFamily);
  applyFontSize(fontSize);
  applyTipOpacity(tipOpacity);
  applyDcBtnVisibility(showDcBtn);
  window.bobCoach.setSetting("transparency", transparency);

  // Persist all
  state.fontFamily = fontFamily;
  state.fontSize = fontSize;
  state.tipOpacity = tipOpacity;
  state.transparency = transparency;
  state.disconnectShortcut = shortcut;
  state.showDcBtn = showDcBtn;
  state.dcShortcutScope = dcScope;
  state.freshnessFilter = freshnessFilter;
  state.showCombatPredictor = showCombat;
  state.combatSimSamples = combatSamples;

  // Register / unregister shortcut based on scope + visibility
  applyDcShortcutScope(shortcut, dcScope, showDcBtn);

  await Promise.all([
    window.bobCoach.setSetting("fontFamily", fontFamily),
    window.bobCoach.setSetting("fontSize", fontSize),
    window.bobCoach.setSetting("tipOpacity", tipOpacity),
    window.bobCoach.setSetting("transparency", transparency),
    window.bobCoach.setSetting("disconnectShortcut", shortcut),
    window.bobCoach.setSetting("showDcBtn", showDcBtn),
    window.bobCoach.setSetting("dcShortcutScope", dcScope),
    window.bobCoach.setSetting("freshnessFilter", freshnessFilter),
    window.bobCoach.setSetting("showCombatPredictor", showCombat),
    window.bobCoach.setSetting("combatSimSamples", combatSamples),
  ]);

  $("font-preview").classList.add("hidden");
  closeSettings();
}

function openAbout() {
  state.aboutOpen = true;
  dom.aboutOverlay.classList.remove("hidden");
}

function closeAbout() {
  state.aboutOpen = false;
  dom.aboutOverlay.classList.add("hidden");
}

function openLegend() {
  state.legendOpen = true;
  dom.legendOverlay.classList.remove("hidden");
}
function closeLegend() {
  state.legendOpen = false;
  dom.legendOverlay.classList.add("hidden");
}
dom.legendOverlay && dom.legendOverlay.addEventListener("click", function(e) {
  if (e.target === dom.legendOverlay) closeLegend();
});
$("legend-close") && $("legend-close").addEventListener("click", closeLegend);

function openRules() {
  state.rulesOpen = true;
  dom.rulesOverlay.classList.remove("hidden");
}
function closeRules() {
  state.rulesOpen = false;
  dom.rulesOverlay.classList.add("hidden");
}
dom.rulesOverlay && dom.rulesOverlay.addEventListener("click", function(e) {
  if (e.target === dom.rulesOverlay) closeRules();
});
$("rules-close") && $("rules-close").addEventListener("click", closeRules);

function showQuitDialog() {
  $("quit-overlay").classList.remove("hidden");
}

function hideQuitDialog() {
  $("quit-overlay").classList.add("hidden");
}

// ═══════════════════════════════════════════
// 账号管理
// ═══════════════════════════════════════════

async function loadUserProfile() {
  try {
    state.userProfile = await window.bobCoach.getUserProfile();
    state.userStats = await window.bobCoach.getUserStats();
    state.syncQueueStatus = await window.bobCoach.getSyncQueueStatus();
  } catch (e) {
    console.error("[Bob] Failed to load user profile:", e);
    state.userProfile = null;
    state.userStats = null;
  }
}

function refreshAccountUI() {
  if (!dom.accountStatusBadge) return;
  var profile = state.userProfile;
  if (!profile) return;

  var isLoggedIn = profile.accountType === "registered";

  // 状态徽章
  dom.accountStatusBadge.textContent = isLoggedIn ? profile.username : "未登录";
  dom.accountStatusBadge.className = "account-status-badge " + (isLoggedIn ? "registered" : "anonymous");

  // 表单切换
  if (isLoggedIn) {
    dom.accountLoggedOut.classList.add("hidden");
    dom.accountLoggedIn.classList.remove("hidden");
    dom.accountUserInfo.textContent = "已登录: " + profile.username +
      (profile.email ? " (" + profile.email + ")" : "") +
      " | 账号ID: " + (profile.userId || "").substring(0, 8) + "...";
  } else {
    dom.accountLoggedOut.classList.remove("hidden");
    dom.accountLoggedIn.classList.add("hidden");
    dom.accountInfoText.textContent = "注册账号后可云端备份对战数据、参与策略优化。也可直接使用匿名模式，所有数据仅存储于本地。";
  }

  // 隐私级别
  if (dom.setPrivacyLevel) {
    dom.setPrivacyLevel.value = profile.privacyLevel || "local";
  }

  // 统计数据
  var stats = state.userStats;
  if (stats && dom.statTotalGames) {
    dom.statTotalGames.textContent = stats.totalGames || 0;
    if (stats.totalGames > 0) {
      var top4Rate = stats.top4Count ? Math.round((stats.top4Count / stats.totalGames) * 100) : 0;
      dom.statTop4Rate.textContent = top4Rate + "%";
      dom.statAvgPlacement.textContent = (stats.avgPlacement || 0).toFixed(1);
    } else {
      dom.statTop4Rate.textContent = "--";
      dom.statAvgPlacement.textContent = "--";
    }
    dom.statFirstPlace.textContent = stats.firstPlaceCount || 0;
  }

  // 同步队列
  var sq = state.syncQueueStatus;
  if (sq && sq.total > 0 && dom.syncQueueStatus) {
    dom.syncQueueStatus.style.display = "block";
    dom.sqPending.textContent = sq.pending || 0;
    dom.sqSynced.textContent = sq.synced || 0;
    dom.sqFailed.textContent = sq.failed || 0;
  } else if (dom.syncQueueStatus) {
    dom.syncQueueStatus.style.display = "none";
  }

  // API 端点列表
  renderApiEndpoints();
}

async function renderApiEndpoints() {
  if (!dom.apiEndpointsList) return;
  try {
    var endpoints = await window.bobCoach.getApiEndpoints();
    var html = "";
    for (var i = 0; i < endpoints.length; i++) {
      var ep = endpoints[i];
      html += '<div class="api-endpoint-row">' +
        '<span class="api-endpoint-method ' + ep.method.toLowerCase() + '">' + ep.method + '</span>' +
        '<span class="api-endpoint-path">' + ep.path + '</span>' +
        '<span class="api-endpoint-desc" style="font-size:8px;color:var(--text-muted)">' + ep.desc + '</span>' +
        '<span class="api-endpoint-status ' + ep.status + '">' + (ep.status === "reserved" ? "预留" : "在线") + '</span>' +
        '</div>';
    }
    dom.apiEndpointsList.innerHTML = html;
  } catch (e) {}
}

async function handleRegister() {
  var username = (dom.accountUsername.value || "").trim();
  var password = (dom.accountPassword.value || "").trim();
  if (!username || !password) {
    alert("请输入用户名和密码");
    return;
  }
  if (username.length < 3) {
    alert("用户名至少3个字符");
    return;
  }
  if (password.length < 6) {
    alert("密码至少6个字符");
    return;
  }
  var result = await window.bobCoach.userRegister(username, password, "");
  if (result.error) {
    alert("注册失败: " + result.error);
    return;
  }
  await loadUserProfile();
  refreshAccountUI();
}

async function handleLogin() {
  var username = (dom.accountUsername.value || "").trim();
  var password = (dom.accountPassword.value || "").trim();
  if (!username || !password) {
    alert("请输入用户名和密码");
    return;
  }
  var result = await window.bobCoach.userLogin(username, password);
  if (result.error) {
    alert("登录失败: " + result.error);
    return;
  }
  await loadUserProfile();
  refreshAccountUI();
}

async function handleLogout() {
  if (!confirm("确定要注销登录吗？游戏记录将保留在本地。")) return;
  await window.bobCoach.userLogout();
  await loadUserProfile();
  refreshAccountUI();
}

async function handleExportData() {
  try {
    var data = await window.bobCoach.exportUserData();
    var jsonStr = JSON.stringify(data, null, 2);
    // 通过 Electron 保存文件对话框
    var blob = new Blob([jsonStr], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "bob-coach-data-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("导出失败: " + e.message);
  }
}

async function handleImportData() {
  var input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async function() {
    var file = input.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      var result = await window.bobCoach.importUserData(data);
      if (result.error) {
        alert("导入失败: " + result.error);
        return;
      }
      alert("导入成功! 合并了 " + result.importedCount + " 条记录。");
      await loadUserProfile();
      refreshAccountUI();
    } catch (e) {
      alert("导入失败: 文件格式不正确");
    }
  };
  input.click();
}

async function handleDeleteData() {
  if (!confirm("确定要清除所有本地数据吗？此操作不可撤销！\n\n将删除：所有游戏记录、决策日志、个人统计。\n\n建议先导出数据备份。")) return;
  if (!confirm("再次确认：清除所有本地数据？")) return;
  await window.bobCoach.deleteAllUserData();
  await loadUserProfile();
  refreshAccountUI();
}

async function handlePrivacyChange() {
  var level = dom.setPrivacyLevel.value;
  await window.bobCoach.setPrivacyLevel(level);
  state.userProfile = await window.bobCoach.getUserProfile();
  state.syncQueueStatus = await window.bobCoach.getSyncQueueStatus();
  refreshAccountUI();
}

// ═══════════════════════════════════════════
// 拔线 Toast
// ═══════════════════════════════════════════

let dcToastTimer = null;
let dcCountdownInterval = null;
let dcDragInfo = null;
let compDragInfo = null;
let gearDragInfo = null;
let _compDx = 0;
let _compDy = 0;
let _gearDx = 0;
let _gearDy = 0;
let _gearWasDragged = false;

function showDcToast(text) {
  dom.dcToastText.textContent = text;
  dom.dcToast.classList.remove("hidden");
  dom.dcProgressFill.style.width = "0%";

  // 3 second countdown
  let progress = 0;
  const stepMs = 100;
  const totalMs = 3000;
  const steps = totalMs / stepMs;
  const increment = 100 / steps;

  dcCountdownInterval = setInterval(() => {
    progress += increment;
    if (progress >= 100) {
      progress = 100;
      clearInterval(dcCountdownInterval);
      dcCountdownInterval = null;
    }
    dom.dcProgressFill.style.width = progress + "%";
  }, stepMs);

  // Auto-hide after 4 seconds
  clearTimeout(dcToastTimer);
  dcToastTimer = setTimeout(() => {
    hideDcToast();
  }, 4000);
}

function hideDcToast() {
  dom.dcToast.classList.add("hidden");
  dom.dcProgressFill.style.width = "0%";
  if (dcCountdownInterval) {
    clearInterval(dcCountdownInterval);
    dcCountdownInterval = null;
  }
  clearTimeout(dcToastTimer);
}

// ═══════════════════════════════════════════
// 拔线按钮拖拽
// ═══════════════════════════════════════════

function setupDisconnectDrag() {
  const el = dom.disconnectBtn;

  // Restore saved position if any
  if (state.dcBtnLeft && state.dcBtnTop) {
    el.style.left = state.dcBtnLeft;
    el.style.top = state.dcBtnTop;
    el.style.bottom = "auto";
    el.style.transform = "none";
  }

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (state.disconnectStatus === "disconnecting") return;
    const rect = el.getBoundingClientRect();
    dcDragInfo = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    el.style.cursor = "grabbing";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dcDragInfo) return;
    const dx = e.clientX - dcDragInfo.startX;
    const dy = e.clientY - dcDragInfo.startY;
    const newLeft = dcDragInfo.origLeft + dx;
    const newTop = dcDragInfo.origTop + dy;
    el.style.left = newLeft + "px";
    el.style.top = newTop + "px";
    el.style.bottom = "auto";
    el.style.transform = "none";
  });

  document.addEventListener("mouseup", () => {
    if (!dcDragInfo) return;
    el.style.cursor = "grab";
    state.dcBtnLeft = el.style.left;
    state.dcBtnTop = el.style.top;
    window.bobCoach.setSetting("dcBtnLeft", el.style.left);
    window.bobCoach.setSetting("dcBtnTop", el.style.top);
    dcDragInfo = null;
  });
}

// ═══════════════════════════════════════════
// 齿轮菜单拖拽（带屏幕边界限制）
// ═══════════════════════════════════════════

function setupGearDrag() {
  const el = dom.gearMenu;

  // Restore saved position
  _gearDx = parseInt(state.gearDx) || 0;
  _gearDy = parseInt(state.gearDy) || 0;
  if (_gearDx || _gearDy) {
    applyGearOffset(_gearDx, _gearDy);
  }

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".gear-item")) return;
    _gearWasDragged = false;
    gearDragInfo = {
      startX: e.clientX,
      startY: e.clientY,
      origDx: _gearDx,
      origDy: _gearDy,
    };
    el.style.transition = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!gearDragInfo) return;
    const dx = e.clientX - gearDragInfo.startX;
    const dy = e.clientY - gearDragInfo.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      _gearWasDragged = true;
    }
    let newDx = gearDragInfo.origDx + dx;
    let newDy = gearDragInfo.origDy + dy;

    // Clamp to screen bounds (gear icon size ~38px, keep fully visible)
    const maxX = window.innerWidth - 44;
    const maxY = window.innerHeight - 44;
    newDx = Math.max(-el.offsetLeft + 4, Math.min(newDx, maxX - el.offsetLeft));
    newDy = Math.max(-el.offsetTop + 4, Math.min(newDy, maxY - el.offsetTop));

    _gearDx = newDx;
    _gearDy = newDy;
    applyGearOffset(_gearDx, _gearDy);
  });

  document.addEventListener("mouseup", () => {
    if (!gearDragInfo) return;
    el.style.transition = "";
    state.gearDx = String(Math.round(_gearDx));
    state.gearDy = String(Math.round(_gearDy));
    window.bobCoach.setSetting("gearDx", state.gearDx);
    window.bobCoach.setSetting("gearDy", state.gearDy);
    gearDragInfo = null;
  });
}

function applyGearOffset(dx, dy) {
  dom.gearMenu.style.transform = `translate(${dx}px, ${dy}px)`;
}

// ═══════════════════════════════════════════
// 协议处理
// ═══════════════════════════════════════════

async function acceptAgreement(mode) {
  if (!$("agreement-checkbox").checked) {
    $("agreement-disabled-note").classList.remove("hidden");
    return;
  }
  await window.bobCoach.setSetting("agreementAccepted", true);
  await window.bobCoach.setSetting("mode", mode);
  await window.bobCoach.setSetting("firstRun", false);

  // 初始化用户数据
  if (mode === "cloud") {
    // 云端模式：初始化匿名用户后可升级为注册账号
    await window.bobCoach.initAnonymous();
    await window.bobCoach.setPrivacyLevel("anonymous_stats");
  } else {
    // 本地模式：纯本地，不上传任何数据
    await window.bobCoach.initAnonymous();
    await window.bobCoach.setPrivacyLevel("local");
  }

  await loadUserProfile();
  state.agreementAccepted = true;
  $("agreement-overlay").classList.add("hidden");
}

// 建议自动最小化（2秒后缩小）
function setupBadgeAutoMinimize() {
  // Watched via state changes - when a new suggestion appears, reset timer
  const origRun = runDecisionEngine;
  // We hook into the render path instead
}

// ═══════════════════════════════════════════
// 字体设置
// ═══════════════════════════════════════════

const FONT_FAMILIES = {
  default: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", sans-serif',
  serif: '"SimSun", "宋体", "Noto Serif CJK SC", serif',
  "sans-serif": '"Microsoft YaHei", "微软雅黑", "PingFang SC", "黑体", sans-serif',
  monospace: '"Fira Code", "Cascadia Code", "Consolas", "Microsoft YaHei", monospace',
  cursive: '"KaiTi", "楷体", "STKaiti", cursive',
};

function applyFontFamily(key) {
  const val = FONT_FAMILIES[key] || FONT_FAMILIES.default;
  document.documentElement.style.setProperty("--font-family", val);
}

function applyFontSize(px) {
  document.documentElement.style.setProperty("--font-size", px + "px");
}

function applyTipOpacity(val) {
  document.documentElement.style.setProperty("--tip-opacity", val);
}

function applyDcBtnVisibility(show) {
  dom.disconnectBtn.style.display = show ? "flex" : "none";
  // Update shortcut registration when visibility changes
  applyDcShortcutScope(
    state.disconnectShortcut || "F5",
    state.dcShortcutScope || "always",
    show
  );
}

function applyDcShortcutScope(shortcut, scope, btnVisible) {
  const shouldRegister = scope === "always" || btnVisible;
  if (shouldRegister) {
    window.bobCoach.registerShortcut(shortcut);
  } else {
    window.bobCoach.unregisterShortcut(shortcut);
  }
}

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

async function init() {
  cacheDom();
  setupEvents();

  // Load settings
  const settings = await window.bobCoach.getSettings();
  state.agreementAccepted = settings.agreementAccepted;
  state.transparency = settings.transparency;
  state.disconnectShortcut = settings.disconnectShortcut;
  state.showDcBtn = settings.showDcBtn !== false;
  state.dcShortcutScope = settings.dcShortcutScope || "always";
  state.freshnessFilter = settings.freshnessFilter || "all";
  state.mode = settings.mode;
  state.fontFamily = settings.fontFamily || "default";
  state.fontSize = settings.fontSize || 13;
  state.tipOpacity = settings.tipOpacity || 0.3;
  state.showCombatPredictor = settings.showCombatPredictor !== false;
  state.combatSimSamples = settings.combatSimSamples || 200;

  // Saved disconnect button position
  state.dcBtnLeft = settings.dcBtnLeft || null;
  state.dcBtnTop = settings.dcBtnTop || null;

  // Saved comp panel drag offset
  state.compPanelDx = settings.compPanelDx || "0";
  state.compPanelDy = settings.compPanelDy || "0";

  // Saved gear menu position
  state.gearDx = settings.gearDx || "0";
  state.gearDy = settings.gearDy || "0";

  // Apply saved font settings
  applyFontFamily(state.fontFamily);
  applyFontSize(state.fontSize);
  applyTipOpacity(state.tipOpacity);
  applyDcBtnVisibility(state.showDcBtn !== false);
  applyDcShortcutScope(
    state.disconnectShortcut || "F5",
    state.dcShortcutScope || "always",
    state.showDcBtn !== false
  );

  // Load user profile (account data)
  await loadUserProfile();

  // Show agreement if not accepted
  if (!state.agreementAccepted) {
    dom.agreementOverlay.classList.remove("hidden");
  }

  // 初始化决策记录器（反馈闭环）
  decisionsLogger = new DecisionsLogger(function (entry) {
    window.bobCoach.logDecision(entry).catch(function () {});
  });

  // Load data
  const dataLoaded = await loadAllData();

  // Set initial opacity
  if (state.transparency) {
    // Handled by main process via IPC, but we store locally too
  }

  if (dataLoaded && state.agreementAccepted) {
    // Auto-start demo mode for quick validation
    // (In production, this would wait for HDT log detection)
    console.log("[Bob] Ready. Open gear menu -> Demo mode to test.");
  }

  console.log("[Bob] Initialized");
}

// Start
init().catch(console.error);
