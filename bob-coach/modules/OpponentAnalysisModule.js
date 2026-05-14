"use strict";

// ═══════════════════════════════════════════════════════════
// OpponentAnalysisModule — 对手针对性分析模块
// ═══════════════════════════════════════════════════════════
//
// 四层筛选机制：
//   1. 阵容成型检查 — 自己阵容未成型时不触发针对
//   2. 连续对战检查 — 非连续对战(≥2次)不触发
//   3. 针对卡匹配 — 根据对手 BoardSummary 提升对应 counter tag 卡权重
//   4. 低血量保命 — HP < 10 时额外提升 tempo 卡优先级

var OpponentAnalysisModule = class OpponentAnalysisModule extends BaseModule {

  constructor(config) {
    super("OpponentAnalysisModule", config || {});
    this._counterTags = (config && config.counter_tags) || {};
    this._weights = (config && config.opponent_analysis) || {
      comp_established_min: 4,
      min_consecutive_fights: 2,
      danger_health: 10,
      tempo_boost: 0.4,
    };
  }

  evaluate(ctx) {
    var nextOppId = ctx._nextOpponentId;
    var tracker = ctx._opponentTracker;
    var oppSummary = ctx._nextOpponentSummary;
    if (!nextOppId || !oppSummary) return [];

    // Layer 1: comp established check
    var minBoard = this._weights.comp_established_min || 4;
    var boardSize = (ctx.boardMinions || []).length;
    if (boardSize < minBoard) return [];

    // Layer 2: consecutive fights check
    var minConsecutive = this._weights.min_consecutive_fights || 2;
    var bobPlayerId = ctx._bobPlayerId;
    if (tracker && bobPlayerId !== undefined) {
      var consec = tracker.getConsecutiveFights(bobPlayerId, nextOppId);
      if (consec < minConsecutive) return [];
    }

    // Layer 3: counter card matching
    var decisions = [];
    var shopMinions = ctx.shopMinions || [];

    for (var i = 0; i < shopMinions.length; i++) {
      var m = shopMinions[i];
      var tags = this._getCounterTags(m.cardId);
      if (!tags || tags.length === 0) continue;

      var bonus = this._calcCounterBonus(tags, oppSummary);
      if (bonus <= 0) continue;

      var basePriority = DecisionPriority.POWER_MINION;
      var adjustedPriority = Math.min(95, basePriority + Math.round(bonus * 40));
      var baseConfidence = 0.45 + bonus;

      decisions.push(this._decide(
        "minion_pick",
        adjustedPriority,
        "buy_minion",
        "[针对] 买 " + (m.name_cn || m.cardId),
        "对手阵容" + this._describeOpponent(oppSummary) + "，该随从具有针对效果(" + tags.join("/") + ")",
        Math.min(0.92, baseConfidence),
        {
          cardId: m.cardId,
          position: i,
          shopIndex: i,
          cost: ctx._buyCost || 3,
          counterTags: tags,
          counterBonus: bonus,
        }
      ));
    }

    // Layer 4: low HP danger boost
    var hp = ctx.health || 30;
    if (hp <= (this._weights.danger_health || 10)) {
      for (var d = 0; d < decisions.length; d++) {
        decisions[d].priority = Math.min(100, decisions[d].priority + 8);
        decisions[d].confidence = Math.min(0.95, decisions[d].confidence + 0.05);
        if (decisions[d].reason.indexOf("低血量") === -1) {
          decisions[d].reason = "低血量保命 + " + decisions[d].reason;
        }
      }
    }

    return decisions;
  }

  _getCounterTags(cardId) {
    return this._counterTags[cardId] || null;
  }

  _calcCounterBonus(tags, oppSummary) {
    var bonus = 0;
    for (var i = 0; i < tags.length; i++) {
      switch (tags[i]) {
        case "anti_deathrattle":
          if ((oppSummary.keywordCounts.DEATHRATTLE || 0) >= 3) bonus += 0.30;
          break;
        case "anti_divine_shield":
          if (oppSummary.hasDivineShieldHeavy) bonus += 0.30;
          break;
        case "cleave":
        case "anti_summon":
          if ((oppSummary.minionCount || 0) >= 5) bonus += 0.25;
          break;
        case "anti_big_stats":
          if ((oppSummary.estimatedStrength || 0) > 80) bonus += 0.20;
          break;
        case "anti_taunt":
          if ((oppSummary.keywordCounts.TAUNT || 0) >= 3) bonus += 0.20;
          break;
        case "windfury":
          if ((oppSummary.minionCount || 0) >= 4) bonus += 0.15;
          break;
      }
    }
    return bonus;
  }

  _describeOpponent(summary) {
    var parts = [];
    if (summary.hasDivineShieldHeavy) parts.push("重圣盾");
    if ((summary.keywordCounts.DEATHRATTLE || 0) >= 3) parts.push("多亡语");
    if (summary.hasPoison) parts.push("含剧毒");
    if ((summary.estimatedStrength || 0) > 80) parts.push("大身材");
    if ((summary.minionCount || 0) >= 5) parts.push("铺场多");
    if (summary.dominantRace) parts.push(summary.dominantRace);
    return parts.length > 0 ? parts.join("+") : "未知";
  }
};
