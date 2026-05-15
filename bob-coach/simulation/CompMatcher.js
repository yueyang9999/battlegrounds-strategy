"use strict";

// ═══════════════════════════════════════════════════════════
// CompMatcher — 流派匹配工具（overlay + simulation 共用）
// ═══════════════════════════════════════════════════════════
//
// 输入：场面随从数组 + 流派策略列表 + 决策表配置
// 输出：按匹配度降序的流派匹配列表

var CompMatcher = {
  /**
   * @param {object[]} boardMinions — 场面随从（需有 cardId 字段）
   * @param {object[]} compStrategies — 流派策略列表
   * @param {object} decisionTables — 决策表配置（含 comp_matching 段）
   * @returns {object[]} 匹配结果 [{ comp, matchPercent, overlapCount, totalComp, missingCards, matchedCards }]
   */
  matchBoardToComps: function(boardMinions, compStrategies, decisionTables) {
    var table = (decisionTables && decisionTables.comp_matching) || {};
    var minOverlap = table.min_overlap_for_match || 1;
    var displayMax = table.display_max_comps || 3;

    var boardCardIds = new Set();
    for (var i = 0; i < boardMinions.length; i++) {
      boardCardIds.add(boardMinions[i].cardId);
    }
    var matches = [];

    for (var ci = 0; ci < compStrategies.length; ci++) {
      var comp = compStrategies[ci];
      if (!comp.cards) continue;
      var compCardIds = [];
      for (var j = 0; j < comp.cards.length; j++) {
        compCardIds.push(comp.cards[j].cardId || comp.cards[j].card_id || "");
      }
      var matchedCards = [];
      for (var k = 0; k < compCardIds.length; k++) {
        if (boardCardIds.has(compCardIds[k])) matchedCards.push(compCardIds[k]);
      }
      var overlapCount = matchedCards.length;
      var totalComp = compCardIds.length;
      var matchPercent = totalComp > 0 ? Math.round((overlapCount / totalComp) * 100) : 0;
      var missingCards = [];
      for (var m = 0; m < compCardIds.length; m++) {
        if (!boardCardIds.has(compCardIds[m])) missingCards.push(compCardIds[m]);
      }

      if (overlapCount >= minOverlap) {
        matches.push({
          comp: comp,
          matchPercent: matchPercent,
          overlapCount: overlapCount,
          totalComp: totalComp,
          missingCards: missingCards,
          matchedCards: matchedCards,
        });
      }
    }

    matches.sort(function(a, b) { return b.matchPercent - a.matchPercent; });
    return matches.slice(0, displayMax);
  },

  /**
   * 从流派列表中提取所有核心卡 ID（用于自动加权）。
   */
  buildCoreCardIdSet: function(compStrategies) {
    var coreSet = new Set();
    for (var ci = 0; ci < compStrategies.length; ci++) {
      var compCards = compStrategies[ci].cards || [];
      for (var cc = 0; cc < compCards.length; cc++) {
        if (compCards[cc].role === "core" || compCards[cc].role === "CORE") {
          coreSet.add(compCards[cc].id || compCards[cc].cardId);
        }
      }
    }
    return coreSet;
  },
};
