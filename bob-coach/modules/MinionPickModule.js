"use strict";

// ═══════════════════════════════════════════════════════════
// MinionPickModule — 随从选取建议 + 搜牌提示 + 三连检测 (v2)
// ═══════════════════════════════════════════════════════════
//
// v2 增强:
//   1. 三连检测：链接 upgrade_id 预测金色效果
//   2. 金色交互卡识别：双倍速/虚妄神像2张即三连等
//   3. 三连奖励估值：发现高一级随从的价值
//   4. 发现类随从识别：战吼发现随从/法术的估值加成

var MinionPickModule = class MinionPickModule extends BaseModule {
  constructor(config) {
    super("MinionPickModule", config);
    this._cardsById = null; // lazy load from config
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    if (!ctx) return decisions;

    // 1. 评估商店随从，产出选牌高亮 + 购买建议
    var shopEval = this._evaluateShopCards(ctx);
    if (shopEval.highlights && shopEval.highlights.length > 0) {
      for (var i = 0; i < shopEval.highlights.length; i++) {
        var h = shopEval.highlights[i];
        if (!h.highlightType) continue;
        decisions.push(this._pickDecision(h, ctx));
      }
    }

    // 2. 搜牌建议
    var refreshDec = this._checkRefresh(ctx);
    if (refreshDec) decisions.push(refreshDec);

    // 附高亮数据到第一个 minion_pick 上
    if (decisions.length > 0 && shopEval.highlights.length > 0) {
      for (var j = 0; j < decisions.length; j++) {
        if (decisions[j].type === "minion_pick") {
          decisions[j].data.highlights = shopEval.highlights;
          break;
        }
      }
    }

    return decisions;
  }

  // ── 商店随从评估 (v2 三连增强) ──

  _evaluateShopCards(ctx) {
    var weights = (ctx.decisionTables && ctx.decisionTables.card_weights) || {};
    var tripleRules = (ctx.decisionTables && ctx.decisionTables.triple_rules) || {};
    var dominantTribe = ctx.dominantTribe;
    var boardMinions = ctx.boardMinions || [];
    var shopMinions = ctx.shopMinions || [];

    // 统计场面已有卡牌 (区分金色/非金色)
    var boardCounts = {};
    var goldenCounts = {};
    for (var i = 0; i < boardMinions.length; i++) {
      var bm = boardMinions[i];
      var cid = bm.cardId;
      if (bm.golden) {
        goldenCounts[cid] = (goldenCounts[cid] || 0) + 1;
      } else {
        boardCounts[cid] = (boardCounts[cid] || 0) + 1;
      }
    }

    // 检测金色交互 (2张即三连的规则)
    var needsOnly2 = this._needsOnly2Copies(ctx, tripleRules);

    var highlights = [];

    for (var j = 0; j < shopMinions.length; j++) {
      var shopCard = shopMinions[j];
      var cid = shopCard.cardId;

      // 查权重
      var tribeWeights = dominantTribe ? weights[dominantTribe] : null;
      var neutralW = weights.neutral || {};
      var bestW = (tribeWeights && tribeWeights[cid])
        ? tribeWeights[cid]
        : neutralW[cid];

      var weight = bestW ? (bestW.weight || 0) : 0;
      var role = bestW ? (bestW.role || "") : "";

      // 自动加权：流派核心卡
      if (weight === 0 && ctx._compCoreCardIds && ctx._compCoreCardIds.has(cid)) {
        weight = 7;
        role = "core";
      }

      // 基础加权：无明确权重的卡按等级给 fallback 分
      if (weight === 0) {
        weight = shopCard.tier ? Math.min(shopCard.tier + 1, 7) : 1;
        role = "tempo";
      }

      var nonGoldCount = boardCounts[cid] || 0;
      var goldCount = goldenCounts[cid] || 0;
      var copiesNeeded = needsOnly2 ? 2 : 3;
      var hasPair = nonGoldCount >= (copiesNeeded - 1);
      var hasOne = nonGoldCount >= 1;
      var canTriple = nonGoldCount >= (copiesNeeded - 1) && !goldCount;

      // 发现类随从检测
      var isDiscoverMinion = this._isDiscoverMinion(shopCard, ctx);

      var highlightType = null;
      var reasonShort = "";
      var goldenEffectHint = "";

      if (canTriple) {
        highlightType = "triple";
        goldenEffectHint = this._predictGoldenEffect(cid, ctx);
        reasonShort = needsOnly2
          ? "仅需2张即可三连! " + (goldenEffectHint || "碰高本核心")
          : "可凑三连，碰高本核心" + (goldenEffectHint ? " (" + goldenEffectHint + ")" : "");
      } else if (hasPair && goldCount) {
        // 已有金色版本，再拿意义小
        highlightType = "power";
        reasonShort = "已有金色，重复价值降低";
      } else if (weight >= 8) {
        highlightType = "core";
        reasonShort = role === "core" ? "核心卡，完善" + (dominantTribe || "") + "流派" : "高分推荐，战力核心";
        if (isDiscoverMinion) reasonShort += "，自带发现补资源";
      } else if (weight >= 5) {
        highlightType = "power";
        reasonShort = "战力提升，中期保证";
        if (isDiscoverMinion) reasonShort += "，发现可补牌";
      } else if (hasOne) {
        highlightType = "triple";
        reasonShort = "有1张在手，再拿可凑对子";
      } else if (isDiscoverMinion) {
        highlightType = "power";
        reasonShort = "发现类随从，补充手牌资源";
      }

      highlights.push({
        cardId: cid,
        name_cn: shopCard.name_cn || cid,
        highlightType: highlightType,
        weight: weight,
        reasonShort: reasonShort,
        position: shopCard.position || j,
        canTriple: canTriple,
        copiesOnBoard: nonGoldCount + goldCount,
        goldenEffectHint: goldenEffectHint,
        isDiscoverMinion: isDiscoverMinion,
      });
    }

    // 安全兜底：若所有随从都无高亮，至少推荐最优的一张
    var anyHighlighted = false;
    for (var j = 0; j < highlights.length; j++) {
      if (highlights[j].highlightType) { anyHighlighted = true; break; }
    }
    if (!anyHighlighted && highlights.length > 0) {
      var bestIdx = 0;
      var bestScore = -1;
      for (var j = 0; j < highlights.length; j++) {
        var sc = highlights[j].weight * 2 + (shopMinions[j].attack || 1) * 0.3 + (shopMinions[j].health || 1) * 0.3;
        if (sc > bestScore) { bestScore = sc; bestIdx = j; }
      }
      highlights[bestIdx].highlightType = "power";
      highlights[bestIdx].reasonShort = "推荐购买（基础过渡）";
    }

    return { highlights: highlights };
  }

  // ── 检测是否只需2张即可三连 ──

  _needsOnly2Copies(ctx, tripleRules) {
    // 检查英雄技能
    if (ctx.heroCardId === "BG34_HERO_002p" || ctx.heroCardId === "BG34_HERO_002") return true;
    // 检查畸变
    if (ctx.activeAnomaly === "BG27_Anomaly_301") return true;
    // 检查奖励
    if (ctx.activeRewards && ctx.activeRewards.indexOf("BG24_Reward_350") !== -1) return true;
    // 检查饰品 (特定种族)
    if (ctx.trinketOffer) {
      for (var i = 0; i < ctx.trinketOffer.length; i++) {
        if (ctx.trinketOffer[i].cardId === "BG30_MagicItem_439") return "pirate"; // 仅海盗
      }
    }
    return false;
  }

  // ── 预测金色效果 ──

  _predictGoldenEffect(cardId, ctx) {
    var cardsById = this._ensureCardsById(ctx);
    var card = cardsById ? cardsById[cardId] : null;
    if (!card) return "";

    var mechanics = card.mechanics || [];
    var goldenRules = (ctx.decisionTables && ctx.decisionTables.triple_rules
      && ctx.decisionTables.triple_rules.golden_effect_rules) || {};

    var effects = [];
    for (var m = 0; m < mechanics.length; m++) {
      var rule = goldenRules[mechanics[m]];
      if (rule) {
        if (rule.multiplier === 2) {
          effects.push(mechanics[m] === "BATTLECRY" ? "战吼x2" :
                       mechanics[m] === "DEATHRATTLE" ? "亡语x2" :
                       mechanics[m] === "AVENGE" ? "复仇x2" :
                       mechanics[m] === "END_OF_TURN_TRIGGER" ? "回合结束x2" :
                       mechanics[m] === "AURA" ? "光环翻倍" :
                       mechanics[m] === "MAGNETIC" ? "磁力翻倍" : "效果x2");
        }
      }
    }
    return effects.slice(0, 2).join("/");
  }

  // ── 检测发现类随从 ──

  _isDiscoverMinion(shopCard, ctx) {
    var cardsById = this._ensureCardsById(ctx);
    var card = cardsById ? cardsById[shopCard.cardId] : null;
    if (!card) return false;

    var text = (card.text_cn || "").replace(/\s+/g, "");
    var mechanics = card.mechanics || [];
    // 卡牌文本含"发现" 或 mechanics 含 DISCOVER
    return text.indexOf("发现") !== -1 || mechanics.indexOf("DISCOVER") !== -1;
  }

  _ensureCardsById(ctx) {
    if (this._cardsById) return this._cardsById;
    if (ctx._cardsById) {
      this._cardsById = ctx._cardsById;
      return this._cardsById;
    }
    // fallback: 尝试从全局获取
    if (typeof global !== "undefined" && global._cardsById) {
      this._cardsById = global._cardsById;
      return this._cardsById;
    }
    return null;
  }

  // ── 决策生成 ──

  _pickDecision(h, ctx) {
    var typeMap = { core: "minion_pick", power: "minion_pick", triple: "minion_pick" };
    var priMap = {
      core: DecisionPriority.CORE_MINION,
      power: DecisionPriority.POWER_MINION,
      triple: DecisionPriority.CORE_MINION,
    };

    // 三连优先级加成
    var priority = priMap[h.highlightType] || DecisionPriority.POWER_MINION;
    var confidence = 0.5 + (h.weight / 20);

    if (h.canTriple) {
      confidence = Math.min(0.95, confidence + 0.2);
    }
    if (h.isDiscoverMinion) {
      confidence = Math.min(0.95, confidence + 0.05);
    }

    var label = h.highlightType === "core" ? "核 买 " + h.name_cn :
                h.highlightType === "triple" ? "碰 买 " + h.name_cn :
                "买 " + h.name_cn;

    return this._decide(
      typeMap[h.highlightType] || "minion_pick",
      priority,
      "buy_card_" + (h.position !== undefined ? h.position : "?"),
      label,
      h.reasonShort || "",
      confidence,
      {
        cardId: h.cardId,
        position: h.position,
        weight: h.weight,
        canTriple: h.canTriple,
        goldenEffectHint: h.goldenEffectHint,
        isDiscoverMinion: h.isDiscoverMinion,
      }
    );
  }

  // ── 搜牌建议 ──

  _checkRefresh(ctx) {
    if (!ctx.currentComp) return null;
    if (ctx.currentComp.matchPercent >= 80) return null;
    if (!ctx.currentComp.missingCards || ctx.currentComp.missingCards.length === 0) return null;

    var targetMissing = ctx.currentComp.missingCards.slice(0, 3);

    return this._decide(
      "refresh",
      DecisionPriority.REFRESH_HINT,
      "refresh_shop",
      "建议搜牌找核心",
      "当前" + (ctx.currentComp.comp.name_cn || ctx.currentComp.comp.name) +
      "核心卡进度 " + ctx.currentComp.overlapCount + "/" + ctx.currentComp.totalComp +
      "，缺少: " + targetMissing.join("、") + "。刷出其中一张的概率约12%。",
      0.55,
      { missingCards: targetMissing }
    );
  }
};
