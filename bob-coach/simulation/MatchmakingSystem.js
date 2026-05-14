"use strict";

// ═══════════════════════════════════════════════════════════
// MatchmakingSystem — 对战配对逻辑
// ═══════════════════════════════════════════════════════════
//
// 规则：
// - 不连续两轮匹配同一对手
// - 剩余玩家为奇数时，克尔苏加德(幽灵)补齐
// - 幽灵战力 = 当前回合所有存活玩家的平均战力

var MatchmakingSystem = {

  // 配对主函数
  pair: function(alivePlayers, matchHistory, turn, rng) {
    if (alivePlayers.length === 0) return [];
    if (alivePlayers.length === 1) return [[alivePlayers[0], null]];

    var players = alivePlayers.slice();
    rng.shuffle(players);

    // 奇数玩家：加入克尔苏加德幽灵
    var ghostPlayer = null;
    if (players.length % 2 !== 0) {
      ghostPlayer = this._createGhost(players, turn);
      players.push(ghostPlayer);
    }

    var pairs = [];
    var used = {};

    for (var i = 0; i < players.length; i++) {
      if (used[players[i].id]) continue;

      // 找最佳配对（不是上一轮的对手）
      var bestPartner = null;
      for (var j = i + 1; j < players.length; j++) {
        if (used[players[j].id]) continue;
        if (this._foughtLastRound(players[i].id, players[j].id, matchHistory)) continue;
        bestPartner = players[j];
        break;
      }

      // 如果所有候选都打过了，只好重复
      if (!bestPartner) {
        for (var k = i + 1; k < players.length; k++) {
          if (!used[players[k].id]) { bestPartner = players[k]; break; }
        }
      }

      if (bestPartner) {
        used[players[i].id] = true;
        used[bestPartner.id] = true;
        pairs.push([players[i], bestPartner]);
      } else {
        // 只剩自己
        pairs.push([players[i], null]);
      }
    }

    return pairs;
  },

  // 创建克尔苏加德幽灵
  _createGhost: function(alivePlayers, turn) {
    var avgBoardPower = 0;
    var totalMinions = 0;
    for (var i = 0; i < alivePlayers.length; i++) {
      var p = alivePlayers[i];
      avgBoardPower += this._estimateBoardPower(p.board);
      totalMinions += p.board.length;
    }
    avgBoardPower /= Math.max(1, alivePlayers.length);
    var avgMinions = Math.round(totalMinions / Math.max(1, alivePlayers.length));

    // 幽灵的虚拟board
    var ghostBoard = [];
    for (var i = 0; i < avgMinions; i++) {
      var ghostTier = Math.max(1, Math.min(6, Math.floor(turn / 3) + 1));
      ghostBoard.push({
        cardId: "GHOST_" + i,
        name_cn: "幽灵随从",
        tier: ghostTier,
        attack: ghostTier * 2,
        health: ghostTier * 3,
        golden: false,
        tribes_cn: [],
        mechanics: [],
        position: i,
      });
    }

    return {
      id: "GHOST_" + turn,
      board: ghostBoard,
      tavernTier: Math.max(1, Math.floor(turn / 2)),
      isGhost: true,
      health: 999,
      alive: true,
    };
  },

  // 检查是否上轮打过
  _foughtLastRound: function(id1, id2, matchHistory) {
    if (!matchHistory || matchHistory.length === 0) return false;
    var lastRound = matchHistory[matchHistory.length - 1];
    for (var i = 0; i < lastRound.length; i++) {
      var pair = lastRound[i];
      var ids = [pair[0], pair[1]];
      if (ids.indexOf(id1) !== -1 && ids.indexOf(id2) !== -1) return true;
    }
    return false;
  },

  _estimateBoardPower: function(board) {
    var total = 0;
    for (var i = 0; i < board.length; i++) {
      var m = board[i];
      total += (m.tier || 1) * 0.3 + (m.attack || 1) * 0.1 + (m.health || 1) * 0.1;
    }
    return total;
  }
};
