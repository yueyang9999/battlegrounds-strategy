"use strict";

// ═══════════════════════════════════════════════════════════
// TrinketModule — 饰品选择建议
// ═══════════════════════════════════════════════════════════
//
// 评分层级:
//   1. decision_tables.trinket_weights 预计算数据（最高优先级）
//   2. MechanicScoring 文本分析引擎回退（新赛季/新卡当天可用）
//   3. 社区 trinket_tips 新鲜度置信度加成
//   4. 种族协同动态加权

var TrinketModule = class TrinketModule extends BaseModule {
  constructor(config) {
    super("TrinketModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    var offers = ctx.trinketOffer || [];
    if (offers.length === 0) return decisions;

    var weights = this.config.trinket_weights || {};
    var trinketTips = ctx.trinketTips || {};

    // 构建 MechanicScoring 上下文
    var msContext = {
      dominantTribe: ctx.dominantTribe || "",
      boardKeywords: this._extractBoardKeywords(ctx),
      health: ctx.health || 30,
      availableRaces: ctx.availableRaces || [],
    };

    for (var i = 0; i < offers.length; i++) {
      var trinket = offers[i];
      var cardId = trinket.cardId || trinket.id || "";

      // 查配置权重
      var w = weights[cardId] || null;
      // 查社区 tips
      var tips = trinketTips[cardId] || null;

      var score = this._scoreTrinket(trinket, w, tips, msContext, ctx);
      if (score.skip) continue;

      decisions.push(this._decide(
        "trinket_pick",
        score.priority,
        "pick_trinket_" + i,
        (score.label || "选") + " " + (trinket.name_cn || cardId),
        score.reason || "饰品选择建议",
        score.confidence,
        { cardId: cardId, position: i, score: score.score, tier: score.tier }
      ));
    }

    return decisions;
  }

  // ── 饰品评分 ──

  _scoreTrinket(trinket, weightEntry, tips, msContext, ctx) {
    var score = 0;
    var reasonParts = [];
    var tier = "C";
    var confidence = 0.4;

    // 1. 预计算权重（最高优先级）
    if (weightEntry) {
      score = weightEntry.score || weightEntry.weight || 5;
      tier = weightEntry.tier || "B";
      if (weightEntry.reason) reasonParts.push(weightEntry.reason);
      confidence = 0.75;
    }
    // 2. MechanicScoring 文本分析回退
    else if (typeof MechanicScoring !== "undefined") {
      var card = {
        cardId: trinket.cardId || trinket.id || "",
        name_cn: trinket.name_cn || "",
        text_cn: trinket.text_cn || "",
        tier: 3,
      };
      var ms = MechanicScoring.score(card, msContext);
      score = ms.totalScore;
      tier = ms.tier;
      if (ms.reasons && ms.reasons.length > 0) {
        reasonParts.push(ms.reasons.join("; "));
      }
      confidence = 0.55;
    }
    // 3. 基础回退
    else {
      score = 3;
      tier = "C";
      reasonParts.push("暂无评分数据");
      confidence = 0.3;
    }

    // 4. 社区 tips 质量加成
    if (tips && tips.tips && tips.tips.length > 0) {
      var freshTipCount = 0;
      for (var t = 0; t < tips.tips.length; t++) {
        var tip = tips.tips[t];
        if (tip.freshness && tip.freshness.status !== "outdated") {
          freshTipCount++;
        }
      }
      if (freshTipCount >= 2) {
        score = Math.min(10, score + 1);
        confidence = Math.min(1.0, confidence + 0.1);
      } else if (freshTipCount >= 1) {
        confidence = Math.min(1.0, confidence + 0.05);
      }

      // 提取社区摘要
      var bestTip = tips.tips[0];
      if (bestTip.summary) {
        var summaryShort = bestTip.summary.slice(0, 60);
        if (reasonParts.indexOf("社区: " + summaryShort) === -1) {
          reasonParts.push("社区: " + summaryShort);
        }
      }
    }

    // 5. 确定优先级和标签（统一 S/A/B/C/D）
    var priority, label;
    if (tier === "S" || score >= 8) {
      priority = DecisionPriority.TRINKET_BEST;
      label = "S首选";
    } else if (tier === "A" || score >= 6) {
      priority = DecisionPriority.TRINKET_BEST;
      label = "A优选";
    } else if (tier === "B" || score >= 4) {
      priority = DecisionPriority.TRINKET_OK;
      label = "B可选";
    } else {
      priority = DecisionPriority.INFO;
      label = tier + "备选";
    }

    return {
      score: score,
      tier: tier,
      priority: priority,
      confidence: confidence,
      label: label,
      reason: reasonParts.join("; ") || "饰品评估",
      skip: false,
    };
  }

  // ── 从当前场面提取机制关键词 ──

  _extractBoardKeywords(ctx) {
    var keywords = [];
    var boardMinions = ctx.boardMinions || [];
    for (var i = 0; i < boardMinions.length; i++) {
      var card = ctx._cardsById && ctx._cardsById[boardMinions[i].cardId];
      if (card && card.mechanics) {
        for (var m = 0; m < card.mechanics.length; m++) {
          if (keywords.indexOf(card.mechanics[m]) === -1) {
            keywords.push(card.mechanics[m]);
          }
        }
      }
    }
    return keywords;
  }
};
