"use strict";

// ═══════════════════════════════════════════════════════════
// CombatResolver — 逐随从战斗模拟（从 simulate_games.js 提取）
// ═══════════════════════════════════════════════════════════
//
// 支持5个核心战斗关键词：圣盾/复生/风怒/烈毒/嘲讽
// 攻击顺序：随从多的一方先手，从左到右选择攻击者
// 目标选择：优先打嘲讽，否则随机
// 同时伤害结算

var CombatResolver = {
  simulateCombat: function(attackerBoard, defenderBoard, attackerTier, rng) {
    rng = rng || { random: Math.random };
    var atkUnits = [];
    for (var i = 0; i < attackerBoard.length; i++) {
      atkUnits.push(this._buildUnit(attackerBoard[i]));
    }
    var defUnits = [];
    for (var i = 0; i < defenderBoard.length; i++) {
      defUnits.push(this._buildUnit(defenderBoard[i]));
    }

    var attacks = 0;
    var MAX_ATTACKS = 200;
    while (atkUnits.some(function(u) { return u.alive; }) &&
           defUnits.some(function(u) { return u.alive; }) &&
           attacks < MAX_ATTACKS) {
      var atkFirst = atkUnits.filter(function(u) { return u.alive; }).length >=
                     defUnits.filter(function(u) { return u.alive; }).length;

      if (atkFirst) {
        this._doAttack(atkUnits, defUnits, rng);
        if (!defUnits.some(function(u) { return u.alive; })) break;
        this._doAttack(defUnits, atkUnits);
      } else {
        this._doAttack(defUnits, atkUnits, rng);
        if (!atkUnits.some(function(u) { return u.alive; })) break;
        this._doAttack(atkUnits, defUnits, rng);
      }
      attacks++;
    }

    var atkAlive = atkUnits.filter(function(u) { return u.alive; }).length;
    var defAlive = defUnits.filter(function(u) { return u.alive; }).length;
    var atkWins = atkAlive > 0 && defAlive === 0;

    // 返回存活随从的tier信息（用于伤害计算）
    var survivors = atkWins ? atkUnits.filter(function(u) { return u.alive; }) : [];
    var remainingDefenders = atkWins ? [] : defUnits.filter(function(u) { return u.alive; });

    return {
      win: atkWins,
      attackerSurvivors: survivors,
      defenderSurvivors: remainingDefenders,
      attackerTier: attackerTier,
      attackerAlive: atkAlive,
      defenderAlive: defAlive,
    };
  },

  _buildUnit: function(minion) {
    var mechanics = minion.mechanics || [];
    var mechSet = {};
    for (var m = 0; m < mechanics.length; m++) {
      mechSet[mechanics[m]] = true;
    }
    var goldenMul = minion.golden ? 2.0 : 1.0;
    return {
      cardId: minion.cardId,
      name_cn: minion.name_cn || minion.cardId,
      attack: (minion.attack || 1) * goldenMul,
      health: (minion.health || 1) * goldenMul,
      maxHealth: (minion.health || 1) * goldenMul,
      divineShield: !!mechSet.DIVINE_SHIELD,
      reborn: !!mechSet.REBORN,
      windfury: !!mechSet.WINDFURY,
      venomous: !!mechSet.VENOMOUS,
      taunt: !!mechSet.TAUNT,
      golden: !!minion.golden,
      tier: minion.tier || 1,
      alive: true,
      rebornUsed: false,
      windfuryUsed: false,
      position: minion.position || 0,
    };
  },

  _doAttack: function(attackerSide, defenderSide, rng) {
    rng = rng || { random: Math.random };
    var attacker = null;
    for (var i = 0; i < attackerSide.length; i++) {
      if (attackerSide[i].alive) { attacker = attackerSide[i]; break; }
    }
    if (!attacker) return;

    var defender = this._findTarget(attacker, defenderSide, rng);
    if (!defender) return;

    this._executeAttack(attacker, defender);

    if (attacker.alive && attacker.windfury && !attacker.windfuryUsed) {
      attacker.windfuryUsed = true;
      if (defender.alive || !defenderSide.some(function(u) { return u.alive; })) return;
      var defender2 = this._findTarget(attacker, defenderSide, rng);
      if (defender2) this._executeAttack(attacker, defender2);
    }
  },

  _findTarget: function(attacker, defenderSide, rng) {
    rng = rng || { random: Math.random };
    var alive = [];
    var taunts = [];
    for (var i = 0; i < defenderSide.length; i++) {
      if (defenderSide[i].alive) {
        alive.push(defenderSide[i]);
        if (defenderSide[i].taunt) taunts.push(defenderSide[i]);
      }
    }
    if (alive.length === 0) return null;
    if (taunts.length > 0) return taunts[Math.floor(rng.random() * taunts.length)];
    return alive[Math.floor(rng.random() * alive.length)];
  },

  _executeAttack: function(attacker, defender) {
    var atkDmg = attacker.attack;
    var defDmg = defender.attack;

    // Attacker -> Defender
    if (defender.divineShield) {
      defender.divineShield = false;
    } else {
      if (attacker.venomous && defender.health > 0) {
        defender.health = 0;
      } else {
        defender.health -= atkDmg;
      }
    }

    // Defender -> Attacker (simultaneous)
    if (attacker.divineShield) {
      attacker.divineShield = false;
    } else {
      if (defender.venomous && attacker.health > 0 && defender.alive) {
        attacker.health = 0;
      } else {
        attacker.health -= defDmg;
      }
    }

    if (defender.health <= 0) defender.alive = false;
    if (attacker.health <= 0) attacker.alive = false;

    // Reborn
    if (!defender.alive && defender.reborn && !defender.rebornUsed) {
      defender.alive = true;
      defender.health = 1;
      defender.rebornUsed = true;
      defender.divineShield = false;
    }
    if (!attacker.alive && attacker.reborn && !attacker.rebornUsed) {
      attacker.alive = true;
      attacker.health = 1;
      attacker.rebornUsed = true;
      attacker.divineShield = false;
    }
  }
};
