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
    getLevelUpCost: getLevelUpCost,
    getSpellCost: getSpellCost,
    getDecisionCost: getDecisionCost,

    validateConfig: validateConfig,
    getConfigVersion: getConfigVersion,
  };
})();
