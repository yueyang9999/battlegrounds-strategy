"use strict";

// ═══════════════════════════════════════════════════════════
// DamageSystem — 伤害计算与上限
// ═══════════════════════════════════════════════════════════
//
// 伤害公式：酒馆等级 + 每个存活随从的星级之和
// 伤害上限：
//   1-3回合: 最高5点
//   4-7回合: 最高10点
//   8+回合:  最高15点
//   存活玩家 ≤ 4: 无上限

var DamageSystem = {

  // 计算基础伤害（不含上限）
  calculateDamage: function(tavernTier, survivingMinions) {
    var sum = 0;
    for (var i = 0; i < survivingMinions.length; i++) {
      sum += survivingMinions[i].tier || 1;
    }
    return tavernTier + sum;
  },

  // 根据回合和存活玩家数获取伤害上限
  getCap: function(turn, alivePlayerCount) {
    if (alivePlayerCount <= 4) return Infinity;
    if (turn <= 3) return 5;
    if (turn <= 7) return 10;
    return 15;
  },

  // 应用上限后的最终伤害
  applyCap: function(baseDamage, turn, alivePlayerCount) {
    var cap = this.getCap(turn, alivePlayerCount);
    return Math.min(baseDamage, cap);
  },

  // 一次性计算+应用上限
  cappedDamage: function(tavernTier, survivingMinions, turn, alivePlayerCount) {
    var base = this.calculateDamage(tavernTier, survivingMinions);
    return this.applyCap(base, turn, alivePlayerCount);
  }
};
