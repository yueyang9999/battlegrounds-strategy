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

  // 决策结果
  suggestion: null,     // {type: "level_up"|"refresh"|"danger", message, color, reasonShort, reasonDetail}
  highlightedCards: [], // [{cardId, highlightType, reasonShort, position}]
  compMatches: [],      // [{comp, matchPercent, missingCards, ...}]
  currentComp: null,

  // 插件状态
  agreementAccepted: false,
  panelOpen: false,
  settingsOpen: false,
  aboutOpen: false,
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
  dom.dcManualBtn = $("dc-manual-btn");
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
  dom.demoIndicator = $("demo-indicator");
  dom.demoTurn = $("demo-turn");
  dom.btnCheckUpdate = $("btn-check-update");
  dom.syncCardsVer = $("sync-cards-ver");
  dom.syncHeroDate = $("sync-hero-date");
  dom.syncCompCount = $("sync-comp-count");
  dom.syncLastCheck = $("sync-last-check");
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

    // Build card lookup map
    const cardsArr = (await window.bobCoach.loadData("cards")) || [];
    state.cards = {};
    for (const c of cardsArr) {
      state.cards[c.str_id] = c;
    }

    console.log(
      `[Bob] Loaded ${cardsArr.length} cards, ${state.compStrategies.length} comps, ${state.heroStats.length} heroes`
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
// 决策引擎
// ═══════════════════════════════════════════

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

function evaluateShopCards(shopMinions, boardMinions) {
  const weights = (state.decisionTables && state.decisionTables.card_weights) || {};
  const dominantTribe = getDominantTribe(boardMinions);
  const boardCounts = {};
  for (const m of boardMinions) {
    boardCounts[m.cardId] = (boardCounts[m.cardId] || 0) + 1;
  }

  return shopMinions.map((shopCard) => {
    const tribeWeight = dominantTribe ? (weights[dominantTribe] || {})[shopCard.cardId] : null;
    const neutralW = (weights.neutral || {})[shopCard.cardId];
    const bestW = tribeWeight || neutralW;
    const weight = bestW ? bestW.weight || 0 : 0;
    const role = bestW ? bestW.role || "" : "";
    const hasPair = (boardCounts[shopCard.cardId] || 0) >= 2;
    const hasOne = (boardCounts[shopCard.cardId] || 0) >= 1;

    let highlightType = null;
    let reasonShort = "";

    if (hasPair) {
      highlightType = "triple";
      reasonShort = "可凑三连，碰高本核心";
    } else if (weight >= 8) {
      highlightType = "core";
      reasonShort = role === "core" ? `核心卡，完善${dominantTribe || ""}流派` : "高分推荐，战力核心";
    } else if (weight >= 5) {
      highlightType = "power";
      reasonShort = "战力提升，中期保证";
    } else if (hasOne) {
      highlightType = "triple";
      reasonShort = "有1张在手，再拿可凑对子";
    }

    return {
      cardId: shopCard.cardId,
      name_cn: shopCard.name_cn || getCardName(shopCard.cardId),
      highlightType,
      weight,
      reasonShort,
      position: shopCard.position,
    };
  });
}

function selectCurveType() {
  // Simplified: choose based on health
  if (state.health <= 12) return "defensive";
  if (state.health >= 25 && state.tavernTier <= 2) return "aggressive";
  return "standard";
}

function runDecisionEngine() {
  if (!state.decisionTables || !state.gameActive) {
    state.suggestion = null;
    state.highlightedCards = [];
    state.compMatches = [];
    state.currentComp = null;
    return;
  }

  const table = state.decisionTables;
  const boardPower = estimateBoardPower(state.boardMinions);
  const compMatches = matchBoardToComps(state.boardMinions);
  const currentComp = compMatches.length > 0 ? compMatches[0] : null;
  const curveType = selectCurveType();
  const curve = (table.leveling_curve || {})[curveType] || {};

  // ── 1. 升本建议 ──
  let suggestion = null;
  const turnKey = String(state.turn);
  const curveEntry = curve[turnKey];

  if (curveEntry) {
    const canLevel = state.gold >= curveEntry.cost;
    const boardOk = boardPower >= (table.board_power_estimation?.default_threshold_level || 0.4);
    const healthOk = state.health > (table.board_power_estimation?.health_threshold_danger || 10);

    if (canLevel && boardOk && healthOk) {
      const targetTier = state.tavernTier + 1;
      const rules = table.suggestion_rules?.level_up || {};
      const keyCard = currentComp ? currentComp.missingCards[0] : null;
      const keyCardName = keyCard ? getCardName(keyCard) : "核心卡";

      suggestion = {
        type: "level_up",
        color: "orange",
        message: `建议升本→${targetTier}`,
        reasonShort: `场面战力充足，血量安全，升${targetTier}本后有概率找到${keyCardName}`,
        reasonDetail: `当前场面战力 ${boardPower.toFixed(1)}，高于同回合均值。血量 ${state.health} 较安全。\n升到${targetTier}本后可以找${keyCardName}完善${currentComp?.comp?.name || "阵容"}。\n\n如果不升本，刷两下出核心的概率约8%。你会怎么选？`,
      };
    }
  }

  // ── 2. 危险警告 ──
  const healthDanger = table.board_power_estimation?.health_threshold_danger || 10;
  if (!suggestion && state.health <= healthDanger && boardPower < 0.5) {
    suggestion = {
      type: "danger",
      color: "red",
      message: "危险！急需战力",
      reasonShort: `血量仅剩${state.health}，场面战力不足`,
      reasonDetail: `当前血量${state.health}低于安全线，场面战力${boardPower.toFixed(1)}。\n建议优先购买高战力随从保命，不要贪升本。\n\n血量低于10时，每回合的存活率都至关重要。`,
    };
  }

  // ── 3. 搜牌建议 ──
  if (!suggestion && currentComp && currentComp.matchPercent < 80 && currentComp.missingCards.length > 0) {
    const rules = table.suggestion_rules?.refresh_shop || {};
    const missingNames = currentComp.missingCards.slice(0, 3).map(getCardName).join("、");
    suggestion = {
      type: "refresh",
      color: "blue",
      message: "建议搜牌找核心",
      reasonShort: `缺少${currentComp.missingCards.length}张核心卡: ${missingNames}`,
      reasonDetail: `当前${currentComp.comp.name}核心卡进度 ${currentComp.overlapCount}/${currentComp.totalComp}，缺少${missingNames}。\n刷出其中一张的概率约12%。`,
    };
  }

  state.suggestion = suggestion;
  state.highlightedCards = evaluateShopCards(state.shopMinions, state.boardMinions);
  state.compMatches = compMatches;
  state.currentComp = currentComp;
}

// ═══════════════════════════════════════════
// UI 渲染
// ═══════════════════════════════════════════

function renderSuggestionBadge() {
  const s = state.suggestion;
  const el = dom.suggestionBadge;
  if (!el) return;

  if (!s || !state.gameActive) {
    el.classList.add("hidden");
    return;
  }

  dom.sugText.textContent = s.message;

  // Color class
  el.classList.remove("hidden", "danger", "refresh", "minimized");
  if (state.badgeMinimized) el.classList.add("minimized");
  if (s.type === "danger") el.classList.add("danger");
  if (s.type === "refresh") el.classList.add("refresh");

  // Reason tooltip
  dom.sugReason.textContent = s.reasonShort || "";
  dom.sugReason.classList.add("hidden");
}

function renderCardHighlights() {
  const container = dom.cardHighlights;
  if (!container) return;
  container.innerHTML = "";

  if (!state.gameActive) return;

  // Reference resolution: 1920x1080, scale to current window dimensions
  const refW = 1920;
  const refH = 1080;
  const scaleX = window.innerWidth / refW;
  const scaleY = window.innerHeight / refH;

  // Shop card reference positions (pixels at 1920x1080, bottom-center area)
  const refCardY = 780;
  const refCardW = 134;
  const refCardH = 173;
  const refStartX = 500;
  const refGapX = 157;

  const shopY = Math.round(refCardY * scaleY);
  const cardW = Math.round(refCardW * scaleX);
  const cardH = Math.round(refCardH * scaleY);
  const startX = Math.round(refStartX * scaleX);
  const gapX = Math.round(refGapX * scaleX);

  for (const hc of state.highlightedCards) {
    if (!hc.highlightType) continue;

    const pos = hc.position;
    const left = startX + pos * gapX;

    const wrapper = document.createElement("div");
    wrapper.className = `card-highlight ${hc.highlightType}`;
    wrapper.style.left = left + "px";
    wrapper.style.top = shopY + "px";
    wrapper.style.width = cardW + "px";
    wrapper.style.height = cardH + "px";
    wrapper.title = hc.reasonShort || "";

    // Badge
    const badge = document.createElement("div");
    const badgeTexts = { core: "核", power: "战", triple: "碰" };
    badge.className = `card-badge ${hc.highlightType}`;
    badge.textContent = badgeTexts[hc.highlightType] || "?";
    wrapper.appendChild(badge);

    container.appendChild(wrapper);
  }
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

function renderAll() {
  renderSuggestionBadge();
  renderCardHighlights();
  renderCompPanel();
  renderDisconnectButton();
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

  runDecisionEngine();
  renderAll();
  updateDemoIndicator();
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
    state.suggestion = null;
    state.highlightedCards = [];
    state.compMatches = [];
    state.currentComp = null;
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
    showDcToast("拔线中，3秒后自动重连", true);

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

  dom.dcManualBtn.addEventListener("click", async () => {
    await window.bobCoach.manualReconnect();
    clearTimeout(state._dcRevertTimer);
    state.disconnectStatus = "online";
    renderDisconnectButton();
    hideDcToast();
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
  $("set-cloud").addEventListener("change", (e) => {
    $("cloud-data-row").style.display = e.target.checked ? "flex" : "none";
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
  });

  window.bobCoach.on("disconnect:state-changed", (status) => {
    state.disconnectStatus = status;
    renderDisconnectButton();
    if (status === "online") {
      hideDcToast();
    } else if (status === "disconnecting") {
      showDcToast("拔线中，3秒后自动重连", true);
    }
  });

  window.bobCoach.on("toggle-panel", toggleCompPanel);
  window.bobCoach.on("open-settings", openSettings);
  window.bobCoach.on("open-about", openAbout);

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
  const s = state.suggestion;
  if (!s) return;

  dom.tacticalTitle.textContent = s.type === "level_up" ? "升本决策分析" : s.type === "danger" ? "危险警告" : "搜牌决策分析";
  dom.tacticalBody.textContent = s.reasonDetail || "暂无详细分析";
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
    if (result.applied.length > 0) {
      // Reload all data
      await loadAllData();
      runDecisionEngine();
      renderAll();
      await refreshSyncStatus();

      if ($("sync-update-banner")) $("sync-update-banner").classList.add("hidden");
      state.pendingUpdates = null;

      dom.btnCheckUpdate.textContent = "更新完成 ✓";
      setTimeout(() => {
        if (dom.btnCheckUpdate) {
          dom.btnCheckUpdate.textContent = "检查更新";
          dom.btnCheckUpdate.disabled = false;
        }
      }, 3000);
    }
    if (result.errors.length > 0) {
      console.error("[Bob] Some updates failed:", result.errors);
    }
  } catch (e) {
    console.error("[Bob] Apply updates failed:", e);
    dom.btnCheckUpdate.textContent = "更新失败";
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
  $("set-cloud").checked = state.cloudEnabled || false;
  $("cloud-data-row").style.display = state.cloudEnabled ? "flex" : "none";
  $("set-freshness-filter").value = state.freshnessFilter || "all";
  $("set-font-family").value = state.fontFamily || "default";
  $("set-font-size").value = state.fontSize || 13;
  $("font-size-val").textContent = (state.fontSize || 13) + "px";
  $("set-tip-opacity").value = state.tipOpacity || 0.3;
  $("tip-opacity-val").textContent = Math.round((state.tipOpacity || 0.3) * 100) + "%";

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
  $("set-cloud").checked = state.cloudEnabled || false;
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
  const cloud = $("set-cloud").checked;
  const freshnessFilter = $("set-freshness-filter").value;
  const fontFamily = $("set-font-family").value;
  const fontSize = parseInt($("set-font-size").value);

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
  state.cloudEnabled = cloud;
  state.freshnessFilter = freshnessFilter;

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
    window.bobCoach.setSetting("cloudEnabled", cloud),
    window.bobCoach.setSetting("freshnessFilter", freshnessFilter),
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

function showQuitDialog() {
  $("quit-overlay").classList.remove("hidden");
}

function hideQuitDialog() {
  $("quit-overlay").classList.add("hidden");
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

function showDcToast(text, showManual) {
  dom.dcToastText.textContent = text;
  dom.dcToast.classList.remove("hidden");
  dom.dcManualBtn.classList.toggle("hidden", !showManual);
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
  if (mode === "cloud") {
    await window.bobCoach.setSetting("cloudEnabled", true);
    state.cloudEnabled = true;
  }
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
  state.cloudEnabled = settings.cloudEnabled;
  state.freshnessFilter = settings.freshnessFilter || "all";
  state.mode = settings.mode;
  state.fontFamily = settings.fontFamily || "default";
  state.fontSize = settings.fontSize || 13;
  state.tipOpacity = settings.tipOpacity || 0.3;

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

  // Show agreement if not accepted
  if (!state.agreementAccepted) {
    dom.agreementOverlay.classList.remove("hidden");
  }

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
