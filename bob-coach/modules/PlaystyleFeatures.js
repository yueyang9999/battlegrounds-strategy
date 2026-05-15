"use strict";

// ═══════════════════════════════════════════════════════════
// PlaystyleFeatures — 玩法特征向量定义与提取
// ═══════════════════════════════════════════════════════════
//
// 标准化特征向量，用于：
//   1. 从模拟结果提取玩家玩法特征
//   2. 从真实对局数据提取通用上分特征
//   3. 对比不同玩家/模型的玩法差异

var PlaystyleFeatures = {

  /** 创建空特征向量模板 */
  createTemplate: function(meta) {
    return {
      meta: meta || {},
      levelingCurve: {
        turn2LevelRate: 0,
        turn3LevelRate: 0,
        turn5LevelRate: 0,
        avgTierByTurn: {},
        curveType: "standard",
      },
      racePreference: {},
      mechanicPreference: {},
      tagPreference: {},
      tierDistribution: {},
      compAlignment: {},
      heroPool: {},
      goldEfficiency: 0,
      aggressivenessScore: 0,
      synergyScore: 0,
      flexibilityScore: 0,
      sellRate: 0,
      refreshRate: 0,
      topHeroes: [],
    };
  },

  /**
   * 从模拟结果中提取单个 Bob agent 的玩法特征。
   * @param {object} bobPlayer — 模拟中的 Bob 玩家对象
   * @param {object} opts — 可选配置
   * @returns {object} 特征向量
   */
  extractFromPlayer: function(bobPlayer, opts) {
    opts = opts || {};
    var f = this.createTemplate({
      heroCardId: bobPlayer.heroCardId,
      placement: bobPlayer.placement,
      aiType: bobPlayer.aiType,
      finalBoardSize: bobPlayer.board ? bobPlayer.board.length : 0,
      finalTier: bobPlayer.tavernTier || 1,
    });

    var board = bobPlayer.board || [];
    var decisions = bobPlayer.decisionsMade || [];

    // ── 种族偏好（从最终场面） ──
    for (var i = 0; i < board.length; i++) {
      var tribes = board[i].tribes_cn || [];
      for (var t = 0; t < tribes.length; t++) {
        if (!f.racePreference[tribes[t]]) f.racePreference[tribes[t]] = 0;
        f.racePreference[tribes[t]]++;
      }
    }

    // ── 机制/关键词偏好 ──
    for (var i = 0; i < board.length; i++) {
      var mechs = board[i].mechanics || [];
      for (var m = 0; m < mechs.length; m++) {
        if (!f.mechanicPreference[mechs[m]]) f.mechanicPreference[mechs[m]] = 0;
        f.mechanicPreference[mechs[m]]++;
      }
    }

    // ── 星级分布 ──
    for (var i = 0; i < board.length; i++) {
      var tier = String(board[i].tier || 1);
      if (!f.tierDistribution[tier]) f.tierDistribution[tier] = 0;
      f.tierDistribution[tier]++;
    }

    // ── 决策分析 ──
    var totalGold = 0, spentGold = 0;
    var levelUps = 0, buys = 0, sells = 0, refreshes = 0, heroPowers = 0;
    var levelUpTurns = [];

    for (var d = 0; d < decisions.length; d++) {
      var dec = decisions[d];
      switch (dec.action || dec.type) {
        case "level_up": levelUps++; levelUpTurns.push(dec.turn || 0); break;
        case "minion_pick": case "buy_minion": buys++; break;
        case "sell_minion": sells++; break;
        case "refresh": case "refresh_smart": refreshes++; break;
        case "hero_power": heroPowers++; break;
      }
      spentGold += dec.cost || 0;
    }

    f.sellRate = buys > 0 ? sells / buys : 0;
    f.refreshRate = buys > 0 ? refreshes / buys : 0;
    f.goldEfficiency = totalGold > 0 ? Math.min(1, spentGold / totalGold) : 0;

    // ── 升本曲线 ──
    if (levelUpTurns.length > 0) {
      levelUpTurns.sort(function(a, b) { return a - b; });
      f.levelingCurve.turn2LevelRate = levelUpTurns.indexOf(2) !== -1 ? 1 : 0;
      f.levelingCurve.turn3LevelRate = levelUpTurns.indexOf(3) !== -1 ? 1 : 0;
      f.levelingCurve.turn5LevelRate = levelUpTurns.indexOf(5) !== -1 ? 1 : 0;
    }
    if (bobPlayer.tavernTier) {
      f.levelingCurve.avgTierByTurn = {};
      f.levelingCurve.avgTierByTurn.final = bobPlayer.tavernTier;
    }

    // ── 激进程度 ──
    f.aggressivenessScore = this._calcAggressiveness(bobPlayer);
    f.synergyScore = this._calcSynergy(f);
    f.flexibilityScore = this._calcFlexibility(f);

    return f;
  },

  /**
   * 聚合多个 Bob agent 的特征向量为统一画像。
   * @param {object[]} features — extractFromPlayer 产出的数组
   * @returns {object} 聚合后的画像
   */
  aggregate: function(features) {
    if (features.length === 0) return this.createTemplate();
    var agg = this.createTemplate({
      sourceGames: features.length,
      avgPlacement: 0, top4Rate: 0, winRate: 0,
    });

    var totalPlacement = 0, top4 = 0, wins = 0;

    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var pl = f.meta.placement || 8;
      totalPlacement += pl;
      if (pl <= 4) top4++;
      if (pl === 1) wins++;

      // 种族
      for (var race in f.racePreference) {
        if (!agg.racePreference[race]) agg.racePreference[race] = 0;
        agg.racePreference[race] += f.racePreference[race];
      }
      // 机制
      for (var mk in f.mechanicPreference) {
        if (!agg.mechanicPreference[mk]) agg.mechanicPreference[mk] = 0;
        agg.mechanicPreference[mk] += f.mechanicPreference[mk];
      }
      // 星级
      for (var tk in f.tierDistribution) {
        if (!agg.tierDistribution[tk]) agg.tierDistribution[tk] = 0;
        agg.tierDistribution[tk] += f.tierDistribution[tk];
      }
      // 数值类
      agg.aggressivenessScore += f.aggressivenessScore;
      agg.synergyScore += f.synergyScore;
      agg.flexibilityScore += f.flexibilityScore;
      agg.goldEfficiency += f.goldEfficiency;
      agg.sellRate += f.sellRate;
      agg.refreshRate += f.refreshRate;
    }

    var n = features.length;
    agg.meta.avgPlacement = totalPlacement / n;
    agg.meta.top4Rate = top4 / n;
    agg.meta.winRate = wins / n;
    agg.aggressivenessScore /= n;
    agg.synergyScore /= n;
    agg.flexibilityScore /= n;
    agg.goldEfficiency /= n;
    agg.sellRate /= n;
    agg.refreshRate /= n;

    // 推断升本曲线类型
    agg.levelingCurve.curveType = agg.aggressivenessScore > 0.7 ? "aggressive"
      : agg.aggressivenessScore < 0.4 ? "defensive" : "standard";

    return agg;
  },

  // ── 辅助打分 ──

  _calcAggressiveness: function(player) {
    var score = 0;
    if (player.tavernTier >= 5) score += 0.4;
    else if (player.tavernTier >= 4) score += 0.25;
    var boardLen = (player.board || []).length;
    if (boardLen <= 3 && player.tavernTier >= 4) score += 0.3;
    return Math.min(1, score);
  },

  _calcSynergy: function(f) {
    var raceKeys = Object.keys(f.racePreference);
    if (raceKeys.length === 0) return 0;
    var maxCount = 0, total = 0;
    for (var i = 0; i < raceKeys.length; i++) {
      var c = f.racePreference[raceKeys[i]];
      total += c;
      if (c > maxCount) maxCount = c;
    }
    return total > 0 ? maxCount / total : 0;
  },

  _calcFlexibility: function(f) {
    var raceKeys = Object.keys(f.racePreference);
    var mechKeys = Object.keys(f.mechanicPreference);
    var score = Math.min(1, raceKeys.length / 5) * 0.5 + Math.min(1, mechKeys.length / 10) * 0.5;
    return score;
  },

  /**
   * 对比两个玩法画像的差异。
   * @returns {object} { deltas, similarity }
   */
  compare: function(profileA, profileB) {
    var deltas = {
      aggressiveness: (profileA.aggressivenessScore || 0) - (profileB.aggressivenessScore || 0),
      synergy: (profileA.synergyScore || 0) - (profileB.synergyScore || 0),
      flexibility: (profileA.flexibilityScore || 0) - (profileB.flexibilityScore || 0),
      goldEfficiency: (profileA.goldEfficiency || 0) - (profileB.goldEfficiency || 0),
      sellRate: (profileA.sellRate || 0) - (profileB.sellRate || 0),
    };
    var absSum = 0, count = 0;
    for (var k in deltas) { absSum += Math.abs(deltas[k]); count++; }
    var similarity = count > 0 ? Math.max(0, 1 - absSum / count) : 0;
    return { deltas: deltas, similarity: similarity };
  },
};
