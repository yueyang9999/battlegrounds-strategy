"use strict";

// ═══════════════════════════════════════════════════════════
// OpponentTracker — 对手状态追踪与战历记录
// ═══════════════════════════════════════════════════════════
//
// 追踪8位对局玩家间的战斗历史，构建对手 BoardSummary
// 集成到 SimulationEngine 中，为 OpponentAnalysisModule 提供数据

var OpponentTracker = {

  _opponents: null,   // { playerId → OpponentInfo }
  _fightHistory: null, // { playerId → [opponentId, opponentId, ...] } 按回合顺序

  init: function(players) {
    this._opponents = {};
    this._fightHistory = {};

    var sortedIds = Object.keys(players).sort();
    for (var i = 0; i < sortedIds.length; i++) {
      var key = sortedIds[i];
      var p = players[key];
      this._opponents[p.id] = {
        playerId: p.id,
        heroId: p.heroCardId || "",
        lastBoardSummary: this._emptyBoardSummary(),
        lastDamageDealt: 0,
        consecutiveFights: {},
        eliminated: false,
        alive: p.alive !== false,
      };
      this._fightHistory[p.id] = [];
    }
  },

  _emptyBoardSummary: function() {
    return {
      totalAttack: 0,
      totalHealth: 0,
      dominantRace: null,
      keywordCounts: { DEATHRATTLE: 0, DIVINE_SHIELD: 0, REBORN: 0, TAUNT: 0, WINDFURY: 0, VENOMOUS: 0 },
      minionCount: 0,
      hasCleave: false,
      hasPoison: false,
      hasDivineShieldHeavy: false,
      estimatedStrength: 0,
    };
  },

  recordCombat: function(attackerId, defenderId, result, turn) {
    if (!attackerId || !defenderId || !result) return;

    // 幽灵对手跳过历史记录
    if (!this._fightHistory[attackerId] || !this._fightHistory[defenderId]) return;

    // 更新攻击者的对手历史
    this._fightHistory[attackerId].push(defenderId);
    this._fightHistory[defenderId].push(attackerId);

    // 更新连续对战计数
    this._updateConsecutive(attackerId, defenderId);
    this._updateConsecutive(defenderId, attackerId);

    // 记录 defender 的 board summary (attacker 看到的是 defender 的 board)
    if (result.defenderSurvivors || result.defenderAlive !== undefined) {
      // 重建 defender board 摘要（从存活单位 + 属性推断）
      // 由于 CombatResolver 返回的是 units，我们需要从 result 中提取
      // 实际 defender board 在 SimulationEngine 中可用
      this._opponents[attackerId].lastDamageDealt = result.win ?
        (result.attackerAlive || 0) : 0;
    }
  },

  // 从实际 board 构建/更新 BoardSummary
  recordBoardSummary: function(playerId, board) {
    if (!this._opponents[playerId]) return;
    var opp = this._opponents[playerId];
    if (!opp) return;
    opp.lastBoardSummary = this.buildBoardSummary(board);
  },

  // 构建 BoardSummary
  buildBoardSummary: function(board) {
    var summary = this._emptyBoardSummary();
    if (!board || board.length === 0) return summary;

    var tribeCounts = {};
    summary.minionCount = board.length;

    for (var i = 0; i < board.length; i++) {
      var m = board[i];
      var atk = (m.attack || 1) * (m.golden ? 2 : 1);
      var hp = (m.health || 1) * (m.golden ? 2 : 1);

      summary.totalAttack += atk;
      summary.totalHealth += hp;

      // 种族计数
      var tribes = m.tribes_cn || [];
      for (var t = 0; t < tribes.length; t++) {
        tribeCounts[tribes[t]] = (tribeCounts[tribes[t]] || 0) + 1;
      }

      // 关键词计数
      var mechs = m.mechanics || [];
      for (var k = 0; k < mechs.length; k++) {
        var kw = mechs[k];
        if (summary.keywordCounts.hasOwnProperty(kw)) {
          summary.keywordCounts[kw]++;
        }
      }

      // 剧毒检测
      if (mechs.indexOf("VENOMOUS") !== -1) {
        summary.hasPoison = true;
      }
      // 狂战检测
      if (mechs.indexOf("CLEAVE") !== -1 || mechs.indexOf("WINDFURY") !== -1) {
        summary.hasCleave = true;
      }
    }

    // 主力种族
    var maxCount = 0;
    var domRace = null;
    var tribeKeys = Object.keys(tribeCounts);
    for (var r = 0; r < tribeKeys.length; r++) {
      if (tribeCounts[tribeKeys[r]] > maxCount) {
        maxCount = tribeCounts[tribeKeys[r]];
        domRace = tribeKeys[r];
      }
    }
    summary.dominantRace = domRace;

    // 圣盾重度
    summary.hasDivineShieldHeavy = summary.keywordCounts.DIVINE_SHIELD >= 2;

    // 估算强度 (0-100)
    var avgAtk = summary.minionCount > 0 ? summary.totalAttack / summary.minionCount : 0;
    var avgHp = summary.minionCount > 0 ? summary.totalHealth / summary.minionCount : 0;
    var keywordBonus = (summary.keywordCounts.DIVINE_SHIELD * 3 +
                        summary.keywordCounts.REBORN * 2 +
                        summary.keywordCounts.VENOMOUS * 4 +
                        summary.keywordCounts.WINDFURY * 2 +
                        summary.keywordCounts.DEATHRATTLE * 1) / Math.max(1, summary.minionCount);
    summary.estimatedStrength = Math.min(100, Math.round(
      avgAtk * 1.5 + avgHp * 0.8 + keywordBonus * 10 + summary.minionCount * 5
    ));

    return summary;
  },

  // 追踪连续对战
  _updateConsecutive: function(playerId, opponentId) {
    var hist = this._fightHistory[playerId];
    if (!hist) return;

    var count = 0;
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i] === opponentId) {
        count++;
      } else {
        break;
      }
    }

    var opp = this._opponents[playerId];
    if (opp) {
      opp.consecutiveFights = opp.consecutiveFights || {};
      opp.consecutiveFights[opponentId] = count;
    }
  },

  // 获取某人对某对手的连续对战次数
  getConsecutiveFights: function(playerId, opponentId) {
    var opp = this._opponents[playerId];
    if (!opp || !opp.consecutiveFights) return 0;
    return opp.consecutiveFights[opponentId] || 0;
  },

  // 从当前回合的配对中找到 playerId 的对手
  getNextOpponent: function(playerId, pairs) {
    if (!pairs) return null;
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (pair[0].id === playerId && pair[1]) {
        return pair[1].id;
      }
      if (pair[1] && pair[1].id === playerId) {
        return pair[0].id;
      }
    }
    return null;
  },

  // 获取对手的 BoardSummary
  getOpponentSummary: function(opponentId) {
    var opp = this._opponents[opponentId];
    return opp ? opp.lastBoardSummary : this._emptyBoardSummary();
  },

  // 获取对手基本信息
  getOpponentInfo: function(opponentId) {
    return this._opponents[opponentId] || null;
  },

  // 获取玩家最近N场的对手列表
  getRecentOpponents: function(playerId, n) {
    var hist = this._fightHistory[playerId] || [];
    n = n || 3;
    return hist.slice(-n);
  },

  // 对手是否存活
  isOpponentAlive: function(opponentId) {
    var opp = this._opponents[opponentId];
    return opp ? opp.alive : false;
  },

  // 标记玩家被淘汰
  markEliminated: function(playerId, placement) {
    var opp = this._opponents[playerId];
    if (opp) {
      opp.eliminated = true;
      opp.alive = false;
      opp.placement = placement;
    }
  },

  // 获取所有存活对手
  getAliveOpponents: function() {
    var result = [];
    var keys = Object.keys(this._opponents);
    for (var i = 0; i < keys.length; i++) {
      var opp = this._opponents[keys[i]];
      if (opp.alive) result.push(opp);
    }
    return result;
  }
};
