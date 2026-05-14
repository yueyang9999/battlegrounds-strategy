"use strict";

// ═══════════════════════════════════════════════════════════
// RulesEngine — 统一费用计算引擎（洋葱层修正模型）
// ═══════════════════════════════════════════════════════════
//
// 修正优先级（由低到高，高层覆盖低层）：
//   base → hero_power → trinkets → anomaly → board_auras
//
// 所有费用计算均通过此模块，避免逻辑分散导致不一致。
// 游戏内容更新时，只需更新 decision_tables.json。
// 未知实体（新英雄/新畸变）使用安全默认值，不会崩溃。

var RulesEngine = (function () {
  "use strict";

  var DEFAULT_BUY_COST = 3;
  var DEFAULT_REFRESH_COST = 1;
  var DEFAULT_SELL_PRICE = 1;
  var DEFAULT_LEVEL_UP_BASE = 4;

  // ── 公共 API ──

  /**
   * 获取购买随从的实际费用
   * 洋葱层：base(3) → hero_power → trinkets → anomaly
   */
  function getBuyCost(ctx) {
    var cost = DEFAULT_BUY_COST;
    var rules = _rules(ctx);

    // Layer 1: Hero power modifiers
    if (ctx.heroCardId && rules.buy_cost_overrides) {
      var override = rules.buy_cost_overrides[ctx.heroCardId];
      if (override) {
        if (typeof override.cost === "number") cost = override.cost;
      }
    }

    // Layer 2: Trinkets (未来实现 — 读取 ctx.trinketOffer 中已装备的)
    // cost = _applyTrinketBuyModifiers(cost, ctx, rules);

    // Layer 3: Anomaly (最高优先级，可覆盖前两层)
    if (ctx.activeAnomaly && rules.anomaly_rules) {
      var aRule = rules.anomaly_rules[ctx.activeAnomaly];
      if (aRule && typeof aRule.minion_cost === "number") cost = aRule.minion_cost;
    }

    // Layer 4: Rewards (与anomaly同级)
    if (ctx.activeRewards && ctx.activeRewards.length > 0 && rules.reward_rules) {
      for (var i = 0; i < ctx.activeRewards.length; i++) {
        var rRule = rules.reward_rules[ctx.activeRewards[i]];
        if (rRule && typeof rRule.minion_cost === "number") cost = rRule.minion_cost;
      }
    }

    return Math.max(0, cost);
  }

  /**
   * 购买第一个随从是否免费（阿兰娜、泰坦诸神的钩爪等）
   */
  function isFirstMinionFree(ctx) {
    var rules = _rules(ctx);

    if (ctx.heroCardId && rules.buy_cost_overrides) {
      var override = rules.buy_cost_overrides[ctx.heroCardId];
      if (override && override.first_free) return true;
    }
    if (ctx.activeAnomaly && rules.anomaly_rules) {
      var aRule = rules.anomaly_rules[ctx.activeAnomaly];
      if (aRule && aRule.first_minion_free) return true;
    }

    return false;
  }

  /**
   * 计算在当前金币下最多能买几个随从
   */
  function getMaxBuys(ctx) {
    var cost = getBuyCost(ctx);
    var gold = ctx.gold || 0;
    if (isFirstMinionFree(ctx)) {
      return 1 + Math.floor(gold / cost);
    }
    return Math.floor(gold / cost);
  }

  /**
   * 获取出售随从的价格
   * sellPrice = 1 (base) + heroSellBonus + trinketSellBonus
   * 特殊随从可 override（如白赚赌徒返3）
   */
  function getSellPrice(minionCardId, ctx) {
    var price = DEFAULT_SELL_PRICE;
    var rules = _rules(ctx);

    // 特殊随从出售价格
    if (rules.sell_bonus_cards) {
      var bonus = rules.sell_bonus_cards[minionCardId];
      if (bonus && typeof bonus.sell_gold === "number") return bonus.sell_gold;
    }

    // Hero sell bonus (未来: 读取 hero_power effects)
    // Trinket sell bonus (未来: 读取 trinket effects)
    // Anomaly sell override (未来)

    return price;
  }

  /**
   * 获取刷新费用
   */
  function getRefreshCost(ctx) {
    var cost = DEFAULT_REFRESH_COST;
    var rules = _rules(ctx);

    // 米尔豪斯: 法力风暴 — refresh costs 2
    if (ctx.heroCardId === "TB_BaconShop_HERO_49") cost = 2;

    // Anomaly override
    if (ctx.activeAnomaly && rules.anomaly_rules) {
      var aRule = rules.anomaly_rules[ctx.activeAnomaly];
      if (aRule && typeof aRule.refresh_cost === "number") cost = aRule.refresh_cost;
    }

    return Math.max(0, cost);
  }

  /**
   * 获取有效刷新费用（考虑免费刷新次数和HP消耗）
   */
  function getEffectiveRefreshCost(ctx) {
    var freeCount = countFreeRefreshes(ctx);
    if (freeCount > 0) return 0;
    return getRefreshCost(ctx);
  }

  /**
   * 统计当前可用的免费刷新次数
   * 来源：BGS_116 刷新畸体战吼(+2) / BG28_827 快速浏览法术 / BG30_MagicItem_435 免费刷新饰品
   */
  function countFreeRefreshes(ctx) {
    var rules = _rules(ctx);
    var refreshRules = rules.refresh_rules || {};
    var freeTrinketIds = refreshRules.free_refresh_trinket_ids || [];
    var freeCardIds = refreshRules.free_refresh_card_ids || [];
    var count = 0;

    // 1. 免费刷新饰品（BG30_MagicItem_435 = 无限免费）
    var trinkets = ctx.trinketOffer || [];
    for (var t = 0; t < trinkets.length; t++) {
      if (freeTrinketIds.indexOf(trinkets[t].cardId) !== -1) return Infinity;
    }

    // 2. 刷新畸体 BGS_116 — 在场提供2次免费刷新（战吼效果）
    var board = ctx.boardMinions || [];
    for (var b = 0; b < board.length; b++) {
      if (freeCardIds.indexOf(board[b].cardId) !== -1) count += 2;
    }

    // 3. 快速浏览 BG28_827 — 已购买则+2次
    var freeRefreshCount = ctx.freeRefreshCount || 0;
    count += freeRefreshCount;

    return count;
  }

  /**
   * 统计 HP 刷新剩余次数（BG26_524 舞蹈王子玛克扎尔）
   */
  function countHpRefreshes(ctx) {
    var rules = _rules(ctx);
    var refreshRules = rules.refresh_rules || {};
    var hpMinionIds = refreshRules.hp_refresh_minion_ids || [];
    var board = ctx.boardMinions || [];
    for (var b = 0; b < board.length; b++) {
      if (hpMinionIds.indexOf(board[b].cardId) !== -1) {
        return refreshRules.max_hp_refreshes_per_turn || 2;
      }
    }
    return 0;
  }

  /**
   * 评估当前酒馆价值（供 RefreshModule 和 FreezeModule 共用）
   * @returns {{ totalScore: number, highlights: Array, hasCoreCard: boolean, hasTripleCard: boolean, hasGoldenSpell: boolean }}
   */
  function estimateShopValue(ctx) {
    var rules = _rules(ctx);
    var cardWeights = (ctx.decisionTables && ctx.decisionTables.card_weights) || {};
    var spellWeights = (ctx.decisionTables && ctx.decisionTables.spell_weights) || {};
    var freezeRules = rules.freeze_rules || {};
    var valueWeights = freezeRules.shop_value_weights || {};
    var goldenSpellIds = freezeRules.golden_spell_ids || [];
    var pointOfGoldTargets = freezeRules.point_of_gold_targets || {};

    // 统计场上卡牌出现次数（三连检测）
    var boardCounts = {};
    var handCounts = {};
    var boardMinions = ctx.boardMinions || [];
    var handMinions = ctx.handMinions || [];
    for (var bi = 0; bi < boardMinions.length; bi++) {
      var bcid = boardMinions[bi].cardId;
      boardCounts[bcid] = (boardCounts[bcid] || 0) + 1;
    }
    for (var hi = 0; hi < handMinions.length; hi++) {
      var hcid = handMinions[hi].cardId;
      handCounts[hcid] = (handCounts[hcid] || 0) + 1;
    }

    var scores = [];
    var hasCoreCard = false;
    var hasTripleCard = false;
    var hasGoldenSpell = false;

    // 评分商店随从
    var shopMinions = ctx.shopMinions || [];
    for (var sm = 0; sm < shopMinions.length; sm++) {
      var m = shopMinions[sm];
      var cardScore = 0;
      // 查卡牌权重
      var matchedWeight = null;
      var tribes = Object.keys(cardWeights);
      for (var tw = 0; tw < tribes.length; tw++) {
        var w = cardWeights[tribes[tw]][m.cardId];
        if (w && (!matchedWeight || w.weight > matchedWeight.weight)) {
          matchedWeight = w;
        }
      }
      if (matchedWeight) {
        if (matchedWeight.role === "core") {
          cardScore += valueWeights.core_card || 10;
          hasCoreCard = true;
        } else if (matchedWeight.role === "power") {
          cardScore += valueWeights.power_card || 5;
        }
        cardScore += matchedWeight.weight || 0;
      }
      // 三连潜力检测
      var totalCopies = (boardCounts[m.cardId] || 0) + (handCounts[m.cardId] || 0);
      if (totalCopies >= 2) {
        cardScore += valueWeights.triple_card || 12;
        hasTripleCard = true;
      }
      // 点金目标检测
      if (pointOfGoldTargets[m.cardId]) {
        cardScore += 5;
      }
      scores.push({ cardId: m.cardId, score: cardScore, type: "minion" });
    }

    // 评分商店法术
    var shopSpells = ctx.shopSpells || [];
    for (var ss = 0; ss < shopSpells.length; ss++) {
      var sp = shopSpells[ss];
      var spellScore = 0;
      // 点金法术
      if (goldenSpellIds.indexOf(sp.cardId) !== -1) {
        spellScore += valueWeights.golden_spell || 15;
        hasGoldenSpell = true;
      }
      // 查法术权重
      var sw = spellWeights[sp.cardId];
      if (sw) {
        if (sw.category === "economy") spellScore += valueWeights.economy_spell || 4;
        if (sw.category === "discover") spellScore += valueWeights.discover_spell || 6;
        spellScore += (sw.cost === 0) ? 3 : 0;
      }
      scores.push({ cardId: sp.cardId, score: spellScore, type: "spell" });
    }

    // 降序排列，取前3张
    scores.sort(function(a, b) { return b.score - a.score; });
    var totalScore = 0;
    for (var top = 0; top < Math.min(3, scores.length); top++) {
      totalScore += scores[top].score;
    }

    return {
      totalScore: totalScore,
      highlights: scores.slice(0, 3),
      hasCoreCard: hasCoreCard,
      hasTripleCard: hasTripleCard,
      hasGoldenSpell: hasGoldenSpell,
    };
  }

  /**
   * 获取升本费用估算
   * 注意：升本费用受英雄（米尔豪斯+1）、畸变等影响
   */
  function getLevelUpCost(ctx) {
    var rules = _rules(ctx);

    // 从曲线表获取基础升本费用
    var curveTable = (ctx.decisionTables && ctx.decisionTables.leveling_curve) || {};
    var curve = curveTable[ctx.curveType] || curveTable.standard || {};
    var entry = curve[String(ctx.turn || 0)];
    var baseCost = (entry && entry.cost) ? entry.cost : DEFAULT_LEVEL_UP_BASE;

    // 米尔豪斯: 法力风暴 — 升本费用+1
    if (ctx.heroCardId === "TB_BaconShop_HERO_49") baseCost += 1;

    // Anomaly override (未来)
    // if (ctx.activeAnomaly && rules.anomaly_rules) { ... }

    return Math.max(0, baseCost);
  }

  /**
   * 获取酒馆法术的实际费用
   */
  function getSpellCost(spellCardId, ctx) {
    var rules = _rules(ctx);
    var spellWeights = (ctx.decisionTables && ctx.decisionTables.spell_weights) || {};
    var spellRules = (ctx.decisionTables && ctx.decisionTables.spell_rules) || {};

    // 基础费用：查 spell_weights → fallback 到 default_cost
    var w = spellWeights[spellCardId] || {};
    var cost = (typeof w.cost === "number") ? w.cost : (spellRules.default_cost || 1);

    // Hero spell discount
    if (ctx.heroCardId && rules.spell_cost_overrides) {
      var sOverride = rules.spell_cost_overrides[ctx.heroCardId];
      if (sOverride && sOverride.first_discount) {
        cost -= sOverride.first_discount;
      }
    }

    // Reward spell discount
    if (ctx.activeRewards && ctx.activeRewards.length > 0 && rules.reward_rules) {
      for (var i = 0; i < ctx.activeRewards.length; i++) {
        var rRule = rules.reward_rules[ctx.activeRewards[i]];
        if (rRule && typeof rRule.spell_discount === "number") cost -= rRule.spell_discount;
      }
    }

    return Math.max(0, cost);
  }

  /**
   * 获取决策对应的金币花费（供 Orchestrator 预算检查使用）
   */
  function getDecisionCost(decision, ctx) {
    switch (decision.type) {
      case "level_up":
        return getLevelUpCost(ctx);
      case "minion_pick":
        return getBuyCost(ctx);
      case "hero_power":
        return ctx.heroPowerCost || 0;
      case "spell_buy":
      case "spell_use":
        return (decision.data && typeof decision.data.cost === "number")
          ? decision.data.cost
          : getSpellCost(decision.data && decision.data.cardId, ctx);
      case "refresh":
        return getRefreshCost(ctx);
      case "trinket_pick":
        return 0;
      case "sell_minion":
        return -(getSellPrice(decision.data && decision.data.cardId, ctx) || 1);
      default:
        return 0;
    }
  }

  /**
   * 校验配置与当前卡牌数据的一致性
   * 返回 { valid: boolean, warnings: string[], unknownHeroes: string[] }
   */
  function validateConfig(decisionTables, cardsData) {
    var warnings = [];
    var unknownHeroes = [];

    if (!decisionTables || !decisionTables.hero_power_rules) {
      return { valid: true, warnings: ["decision_tables.json 缺少 hero_power_rules 节点"], unknownHeroes: [] };
    }

    var rules = decisionTables.hero_power_rules;

    // 校验 buy_cost_overrides 中的英雄是否在 cards.json 中存在
    if (rules.buy_cost_overrides && cardsData) {
      var heroIds = _buildIdSet(cardsData, "hero");
      var overrides = rules.buy_cost_overrides;
      for (var hid in overrides) {
        if (!heroIds[hid]) {
          unknownHeroes.push(hid);
          warnings.push("buy_cost_overrides 引用未知英雄: " + hid + " — 将从配置中忽略");
        }
      }
    }

    // 校验 spell_cost_overrides
    if (rules.spell_cost_overrides && cardsData) {
      var heroIds2 = _buildIdSet(cardsData, "hero");
      var sOverrides = rules.spell_cost_overrides;
      for (var sid in sOverrides) {
        if (!heroIds2[sid]) {
          warnings.push("spell_cost_overrides 引用未知英雄: " + sid + " — 将从配置中忽略");
        }
      }
    }

    return {
      valid: warnings.length === 0 || warnings.every(function (w) { return w.indexOf("忽略") !== -1; }),
      warnings: warnings,
      unknownHeroes: unknownHeroes,
    };
  }

  /**
   * 获取规则引擎版本信息（用于检测 game data 更新后是否需要同步 config）
   */
  function getConfigVersion(decisionTables) {
    return (decisionTables && decisionTables._meta)
      ? decisionTables._meta.version
      : "unknown";
  }

  // ── 内部工具 ──

  function _rules(ctx) {
    if (ctx && ctx.decisionTables && ctx.decisionTables.hero_power_rules) {
      return ctx.decisionTables.hero_power_rules;
    }
    return {};
  }

  function _buildIdSet(cards, cardType) {
    var set = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.card_type === cardType || (cardType === "hero" && c.card_type === "hero")) {
        set[c.str_id || c.id] = true;
      }
    }
    return set;
  }

  // ── HP-cost 卡牌 ──

  var HP_COST_CARDS = {
    "BG28_571": 3,
    "BG25_520": 3,
    "BG26_524": 1,
    "BG30_MagicItem_701": 3,
    "BG35_MagicItem_152": 3,
  };

  function isHpCostCard(cardId) {
    return !!HP_COST_CARDS[cardId];
  }

  function getHpCostAmount(cardId) {
    return HP_COST_CARDS[cardId] || 0;
  }

  // ── 护甲法术 ──

  var ARMOR_SPELL_IDS = {
    "BG28_500": "set_5",
    "BG34_Treasure_934": "add_10",
  };

  function isArmorSpell(cardId) {
    return !!ARMOR_SPELL_IDS[cardId];
  }

  function getArmorSpellType(cardId) {
    return ARMOR_SPELL_IDS[cardId] || null;
  }

  // ── 智慧球 ──

  var WISDOM_BALL_IDS = {
    "BG30_802": true,
    "BG24_Reward_313": true,
  };

  function isWisdomBall(cardId) {
    return !!WISDOM_BALL_IDS[cardId];
  }

  // ── 导出 ──

  return {
    DEFAULT_BUY_COST: DEFAULT_BUY_COST,
    DEFAULT_REFRESH_COST: DEFAULT_REFRESH_COST,
    DEFAULT_SELL_PRICE: DEFAULT_SELL_PRICE,

    getBuyCost: getBuyCost,
    isFirstMinionFree: isFirstMinionFree,
    getMaxBuys: getMaxBuys,
    getSellPrice: getSellPrice,
    getRefreshCost: getRefreshCost,
    getEffectiveRefreshCost: getEffectiveRefreshCost,
    countFreeRefreshes: countFreeRefreshes,
    countHpRefreshes: countHpRefreshes,
    estimateShopValue: estimateShopValue,
    getLevelUpCost: getLevelUpCost,
    getSpellCost: getSpellCost,
    getDecisionCost: getDecisionCost,

    // HP-cost
    isHpCostCard: isHpCostCard,
    getHpCostAmount: getHpCostAmount,
    HP_COST_CARDS: HP_COST_CARDS,

    // Armor spells
    isArmorSpell: isArmorSpell,
    getArmorSpellType: getArmorSpellType,
    ARMOR_SPELL_IDS: ARMOR_SPELL_IDS,

    // Wisdom ball
    isWisdomBall: isWisdomBall,
    WISDOM_BALL_IDS: WISDOM_BALL_IDS,

    validateConfig: validateConfig,
    getConfigVersion: getConfigVersion,
  };
})();
