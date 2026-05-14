"use strict";

// ═══════════════════════════════════════════════════════════
// TrinketModule — 饰品选择建议
// ═══════════════════════════════════════════════════════════

var TrinketModule = class TrinketModule extends BaseModule {
  constructor(config) {
    super("TrinketModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    var offers = ctx.trinketOffer || [];
    if (offers.length === 0) return decisions;

    var rules = this.config.trinket_rules || {};
    var weights = this.config.trinket_weights || {};
    var trinketTips = ctx.trinketTips || {};

    // 当前流派的核心种族
    var compTribe = null;
    if (ctx.currentComp && ctx.currentComp.comp) {
      compTribe = ctx.currentComp.comp.tribe || ctx.currentComp.comp.tribe_cn || null;
    }

    for (var i = 0; i < offers.length; i++) {
      var trinket = offers[i];
      var cardId = trinket.cardId || trinket.id || "";

      // 查配置权重
      var w = weights[cardId] || null;
      // 查社区 tips
      var tips = trinketTips[cardId] || null;

      var score = this._scoreTrinket(trinket, w, tips, compTribe, ctx, rules);
      if (score.skip) continue;

      decisions.push(this._decide(
        "trinket_pick",
        score.priority,
        "pick_trinket_" + i,
        (score.label || "选") + " " + (trinket.name_cn || cardId),
        score.reason || "饰品选择建议",
        score.confidence,
        { cardId: cardId, position: i, score: score.score }
      ));
    }

    return decisions;
  }

  // ── 饰品评分 ──

  _scoreTrinket(trinket, weightEntry, tips, compTribe, ctx, rules) {
    var score = 0;
    var reasonParts = [];

    // 1. 配置权重
    if (weightEntry) {
      score += weightEntry.score || weightEntry.weight || 5;
      if (weightEntry.reason) reasonParts.push(weightEntry.reason);
    }

    // 2. 社区 tips 质量
    if (tips && tips.tips && tips.tips.length > 0) {
      // tips 多且新鲜 → 加分
      var freshTipCount = 0;
      for (var t = 0; t < tips.tips.length; t++) {
        var tip = tips.tips[t];
        if (tip.freshness && tip.freshness.status !== "outdated") {
          freshTipCount++;
        }
      }
      if (freshTipCount >= 2) score += 3;
      else if (freshTipCount >= 1) score += 1;

      // 提取第一条新鲜 tip 的摘要
      var bestTip = tips.tips[0];
      if (bestTip.summary) {
        reasonParts.push("社区: " + bestTip.summary.slice(0, 60));
      }
    }

    // 3. 种族协同
    if (compTribe && trinket.text_cn) {
      var text = trinket.text_cn || "";
      if (text.indexOf(compTribe) !== -1) {
        score += 2;
        reasonParts.push("与" + compTribe + "流派协同");
      }
    }

    // 4. 根据分数确定优先级
    var priority, confidence, label;
    if (score >= 8) {
      priority = DecisionPriority.TRINKET_BEST;
      confidence = 0.8;
      label = "首选";
    } else if (score >= 5) {
      priority = DecisionPriority.TRINKET_OK;
      confidence = 0.6;
      label = "可选";
    } else {
      priority = DecisionPriority.INFO;
      confidence = 0.3;
      label = "备选";
    }

    return {
      score: score,
      priority: priority,
      confidence: confidence,
      label: label,
      reason: reasonParts.join("; ") || "饰品评估",
      skip: false,
    };
  }
};
