"use strict";

// ═══════════════════════════════════════════════════════════
// CompMatcher — 流派匹配工具（overlay + simulation 共用）
// ═══════════════════════════════════════════════════════════
//
// 输入：场面随从数组 + 流派策略列表 + 决策表配置
// 输出：按匹配度降序的流派匹配列表

var CompMatcher = {

  /** powerLevel → 数值 */
  _powerScoreMap: { S: 100, A: 80, B: 60, C: 40, D: 20 },

  /** 从 text 中提取种族关键词 */
  _tribeKeys: ["龙", "野兽", "机械", "鱼人", "恶魔", "野猪人", "海盗", "元素", "亡灵", "娜迦"],

  /**
   * @param {object[]} boardMinions — 场面随从（需有 cardId 字段）
   * @param {object[]} compStrategies — 流派策略列表
   * @param {object} decisionTables — 决策表配置（含 comp_matching 段）
   * @param {object} [opts] — 可选过滤参数
   * @param {string[]} [opts.availableRaces] — 当局可用种族
   * @param {string} [opts.heroCardId] — 英雄 cardId
   * @param {object} [opts.cardTribesMap] — cardId → { minion_types_cn[] } 映射
   * @param {object} [opts.heroPowerText] — 英雄技能中文描述（用于种族协同检测）
   * @returns {object[]} 匹配结果 [{ comp, matchPercent, overlapCount, totalComp, missingCards, matchedCards, compositeScore }]
   */
  matchBoardToComps: function(boardMinions, compStrategies, decisionTables, opts) {
    var table = (decisionTables && decisionTables.comp_matching) || {};
    var minOverlap = table.min_overlap_for_match || 1;
    var displayMax = table.display_max_comps || 3;
    var weightMatch = table.weight_match != null ? table.weight_match : 0.5;
    var weightPower = table.weight_power != null ? table.weight_power : 0.3;
    var weightHero = table.weight_hero != null ? table.weight_hero : 0.2;

    var availableRaces = (opts && opts.availableRaces) || [];
    var heroCardId = (opts && opts.heroCardId) || "";
    var cardTribesMap = (opts && opts.cardTribesMap) || null;
    var heroPowerText = (opts && opts.heroPowerText) || "";

    var boardCardIds = new Set();
    for (var i = 0; i < boardMinions.length; i++) {
      boardCardIds.add(boardMinions[i].cardId);
    }
    var matches = [];

    for (var ci = 0; ci < compStrategies.length; ci++) {
      var comp = compStrategies[ci];
      if (!comp.cards) continue;

      // ── 卡牌交集匹配 ──
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

      // ── 种族兼容度 ──
      var raceScore = 50; // 默认中性
      if (availableRaces.length > 0 && cardTribesMap) {
        raceScore = CompMatcher._computeRaceScore(comp, availableRaces, cardTribesMap);
      }

      // ── 强度评分 ──
      var powerScore = CompMatcher._computePowerScore(comp);

      // ── 英雄协同 ──
      var heroScore = 0;
      if (heroCardId && heroPowerText) {
        heroScore = CompMatcher._computeHeroSynergy(comp, heroPowerText);
      }

      // ── 综合评分 ──
      var compositeScore = matchPercent * weightMatch + powerScore * weightPower + heroScore * weightHero;
      // 种族不兼容时大幅降权（但仍保留，因为玩家可能转型）
      if (raceScore < 30) compositeScore *= 0.3;

      if (overlapCount >= minOverlap || raceScore >= 80) {
        matches.push({
          comp: comp,
          matchPercent: matchPercent,
          overlapCount: overlapCount,
          totalComp: totalComp,
          missingCards: missingCards,
          matchedCards: matchedCards,
          compositeScore: Math.round(compositeScore),
          powerScore: powerScore,
          heroScore: heroScore,
          raceScore: raceScore,
        });
      }
    }

    matches.sort(function(a, b) { return b.compositeScore - a.compositeScore; });
    return matches.slice(0, displayMax);
  },

  /**
   * 计算种族兼容度（0-100）。
   * 遍历流派所有卡牌的种族，与可用种族对比。
   */
  _computeRaceScore: function(comp, availableRaces, cardTribesMap) {
    if (!comp.cards || comp.cards.length === 0) return 50;
    var raceSet = new Set();
    var availableSet = new Set();
    for (var r = 0; r < availableRaces.length; r++) {
      availableSet.add(availableRaces[r]);
    }

    // 强制种族过滤：forcedTribes 指定了才检查
    var forcedTribes = comp.forcedTribes || [];
    if (forcedTribes.length > 0) {
      var forcedMatch = false;
      for (var ft = 0; ft < forcedTribes.length; ft++) {
        if (availableSet.has(forcedTribes[ft])) { forcedMatch = true; break; }
      }
      if (!forcedMatch) return 0; // 强制种族不在当局中，直接0分
    }

    // 收集流派卡牌的所有种族
    for (var ci = 0; ci < comp.cards.length; ci++) {
      var cardId = comp.cards[ci].cardId || comp.cards[ci].card_id || "";
      var cardInfo = cardTribesMap[cardId];
      if (cardInfo && cardInfo.minion_types_cn) {
        for (var t = 0; t < cardInfo.minion_types_cn.length; t++) {
          raceSet.add(cardInfo.minion_types_cn[t]);
        }
      }
    }

    if (raceSet.size === 0) return 70; // 无种族卡牌（中立），中性分数

    // 计算可用种族覆盖率
    var coveredCount = 0;
    var racesArr = [];
    raceSet.forEach(function(r) { racesArr.push(r); });
    for (var rc = 0; rc < racesArr.length; rc++) {
      if (availableSet.has(racesArr[rc])) coveredCount++;
    }

    return Math.round((coveredCount / racesArr.length) * 100);
  },

  /**
   * powerLevel → 数值 (0-100)
   */
  _computePowerScore: function(comp) {
    var level = (comp.powerLevel || "C").toUpperCase();
    return CompMatcher._powerScoreMap[level] || CompMatcher._powerScoreMap["C"];
  },

  /**
   * 英雄与流派协同评分 (0-100)。
   * 检查英雄技能文本中是否提到流派的种族关键词。
   */
  _computeHeroSynergy: function(comp, heroPowerText) {
    if (!heroPowerText || !comp.cards) return 0;
    var tribesInComp = new Set();
    for (var ci = 0; ci < comp.cards.length; ci++) {
      var cardId = comp.cards[ci].cardId || comp.cards[ci].card_id || "";
      // 从 cardId 或 comp name 推断种族
      if (comp.name_cn) {
        for (var t = 0; t < CompMatcher._tribeKeys.length; t++) {
          if (comp.name_cn.indexOf(CompMatcher._tribeKeys[t]) >= 0) {
            tribesInComp.add(CompMatcher._tribeKeys[t]);
          }
        }
      }
    }

    if (tribesInComp.size === 0) return 0;

    var matchedCount = 0;
    tribesInComp.forEach(function(tribe) {
      if (heroPowerText.indexOf(tribe) >= 0) matchedCount++;
    });

    return matchedCount > 0 ? Math.min(100, matchedCount * 50) : 0;
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
