"use strict";

// ═══════════════════════════════════════════════════════════
// CombatResolver — 逐随从战斗模拟（事件队列驱动版本）
// ═══════════════════════════════════════════════════════════
//
// 三阶段战斗：
//   阶段1「战斗开始时」：英雄技能优先 → 随从交替左→右结算
//   阶段2「战斗中」：攻击循环，死亡→亡语→复生事件排队结算
//   阶段3「光环修正」：死亡后刷新光环，可能把0血抬回正值
//
// 支持关键词：圣盾/复生/风怒/烈毒/嘲讽/亡语/战斗开始时/光环/受伤时/顺劈
// 触发顺序：受伤时 > 光环修正 > 亡语 > 复生 > 复仇

// 加载依赖模块（兼容 vm.runInThisContext 和 CommonJS 两种环境）
var CombatEventQueue, CombatEffects;
try {
  CombatEventQueue = require('./CombatEventQueue.js');
  CombatEffects = require('./CombatEffects.js');
} catch (e) {
  CombatEventQueue = (typeof globalThis !== 'undefined' && globalThis.CombatEventQueue)
    || (typeof CombatEventQueue !== 'undefined' ? CombatEventQueue : null);
  CombatEffects = (typeof globalThis !== 'undefined' && globalThis.CombatEffects)
    || (typeof CombatEffects !== 'undefined' ? CombatEffects : null);
}

// 内联兜底：两个模块都不可用时使用最小实现
if (!CombatEventQueue) {
  CombatEventQueue = {
    create: function() {
      return { events: [], push: function(e) { this.events.push(e); },
        processAll: function() { while (this.events.length) { var ev = this.events.shift(); if (ev.handler) ev.handler({}, ev); } },
        isEmpty: function() { return this.events.length === 0; }, clear: function() { this.events = []; } };
    },
    createEvent: function(type, handler, data) { return { type: type, priority: 10, handler: handler, data: data || {} }; },
    PRIORITY: { WHEN_DAMAGED: 1, AURA_UPDATE: 2, DEATHRATTLE: 3, REBORN: 4, AVENGE: 5, START_OF_COMBAT: 6, DEFAULT: 10 },
  };
}
if (!CombatEffects) {
  CombatEffects = { _registry: {}, register: function(){}, registerAll: function(){}, getHandlers: function(){ return null; },
    inferEffectTypes: function(m) { return []; }, _builtins: {} };
}

var CombatResolver = {
  // ============================================================
  // 主入口
  // ============================================================

  simulateCombat: function(attackerBoard, defenderBoard, attackerTier, rng) {
    rng = rng || { random: Math.random };

    // Phase 0: 构建战斗单元
    var atkUnits = [];
    for (var i = 0; i < attackerBoard.length; i++) {
      atkUnits.push(this._buildUnit(attackerBoard[i], i));
    }
    var defUnits = [];
    for (var i = 0; i < defenderBoard.length; i++) {
      defUnits.push(this._buildUnit(defenderBoard[i], i));
    }

    // 构建上下文（供事件处理器使用）
    var ctx = this._buildContext(atkUnits, defUnits, rng);

    // Phase 1: 战斗开始时效果
    this._phaseStartOfCombat(atkUnits, defUnits, ctx);

    // Phase 2: 攻击循环
    var attacks = 0;
    var MAX_ATTACKS = 200;

    while (atkUnits.some(function(u) { return u.alive; }) &&
           defUnits.some(function(u) { return u.alive; }) &&
           attacks < MAX_ATTACKS) {

      var atkAlive = atkUnits.filter(function(u) { return u.alive; }).length;
      var defAlive = defUnits.filter(function(u) { return u.alive; }).length;
      var atkFirst = atkAlive >= defAlive;

      if (atkFirst) {
        this._doAttack(atkUnits, defUnits, ctx);
        ctx.processEvents();
        if (!defUnits.some(function(u) { return u.alive; })) break;
        this._doAttack(defUnits, atkUnits, ctx);
        ctx.processEvents();
      } else {
        this._doAttack(defUnits, atkUnits, ctx);
        ctx.processEvents();
        if (!atkUnits.some(function(u) { return u.alive; })) break;
        this._doAttack(atkUnits, defUnits, ctx);
        ctx.processEvents();
      }
      attacks++;
    }

    // 最终事件处理
    ctx.processEvents();

    var atkSurvivors = atkUnits.filter(function(u) { return u.alive; });
    var defSurvivors = defUnits.filter(function(u) { return u.alive; });
    var atkWins = atkSurvivors.length > 0 && defSurvivors.length === 0;

    return {
      win: atkWins,
      attackerSurvivors: atkWins ? atkSurvivors : [],
      defenderSurvivors: atkWins ? [] : defSurvivors,
      attackerTier: attackerTier,
      attackerAlive: atkSurvivors.length,
      defenderAlive: defSurvivors.length,
    };
  },

  // ============================================================
  // Phase 0: 构建战斗单元
  // ============================================================

  _buildUnit: function(minion, position) {
    var mechanics = minion.mechanics || [];
    var mechSet = {};
    for (var m = 0; m < mechanics.length; m++) {
      mechSet[mechanics[m]] = true;
    }
    var goldenMul = minion.golden ? 2.0 : 1.0;

    var unit = {
      cardId: minion.cardId || minion.str_id,
      name_cn: minion.name_cn || minion.cardId || minion.str_id,
      attack: (minion.attack || 1) * goldenMul,
      health: (minion.health || 1) * goldenMul,
      maxHealth: (minion.health || 1) * goldenMul,
      baseAttack: (minion.attack || 1) * goldenMul,
      baseHealth: (minion.health || 1) * goldenMul,

      // 战斗关键词
      divineShield: !!mechSet.DIVINE_SHIELD,
      reborn: !!mechSet.REBORN,
      windfury: !!mechSet.WINDFURY,
      venomous: !!mechSet.VENOMOUS,
      taunt: !!mechSet.TAUNT,
      cleave: this._detectCleave(minion, mechSet),

      // 触发类效果
      hasDeathrattle: !!(mechSet.DEATHRATTLE || mechSet.InvisibleDeathrattle),
      hasStartOfCombat: !!mechSet.START_OF_COMBAT,
      hasAura: !!mechSet.AURA,
      hasAvenge: !!mechSet.AVENGE,
      hasWhenDamaged: this._detectWhenDamaged(minion, mechSet),

      // 卡牌类型标签
      minionTypes: minion.minion_types_cn || [],
      mechanics: mechanics,
      golden: !!minion.golden,
      tier: minion.tier || 1,
      position: position,

      // 运行时状态
      alive: true,
      rebornUsed: false,
      windfuryUsed: false,
      attacksThisTurn: 0,
      deathCount: 0, // 本场战斗该随从见证的友方死亡数
    };

    return unit;
  },

  /** 检测顺劈/狂战斧（同时伤害目标及相邻随从） */
  _detectCleave: function(minion, mechSet) {
    // 数据中目前没有 CLEAVE 标签，通过卡牌名/文本推断
    if (mechSet.CLEAVE) return true;
    var text = (minion.text_cn || '');
    if (text.indexOf('相邻') !== -1 || text.indexOf('两侧') !== -1) return true;
    // 狂战斧系列
    var name = (minion.name_cn || minion.name || '');
    if (name.indexOf('狂战斧') !== -1 || name.indexOf('顺劈') !== -1) return true;
    return false;
  },

  /** 检测"受伤时"效果 */
  _detectWhenDamaged: function(minion, mechSet) {
    if (!mechSet.TRIGGER_VISUAL) return false;
    var text = (minion.text_cn || '');
    return text.indexOf('受伤') !== -1 || text.indexOf('受到伤害') !== -1;
  },

  // ============================================================
  // Phase 1: 战斗开始时
  // ============================================================
  //
  // 优先级链（由设计师定义）：
  //   1. 优先级英雄技能（奥拉基尔、亚煞极、伊利丹等）
  //   2. 其他英雄技能（塔维什等）
  //   3. 随从效果：先攻方最左 → 后攻方最左 → 先攻方次左 → 后攻方次左

  _phaseStartOfCombat: function(atkUnits, defUnits, ctx) {
    // 收集有 START_OF_COMBAT 的随从，按交替左→右排序
    var socAtk = [];
    var socDef = [];
    for (var i = 0; i < atkUnits.length; i++) {
      if (atkUnits[i].alive && atkUnits[i].hasStartOfCombat) {
        socAtk.push(atkUnits[i]);
      }
    }
    for (var i = 0; i < defUnits.length; i++) {
      if (defUnits[i].alive && defUnits[i].hasStartOfCombat) {
        socDef.push(defUnits[i]);
      }
    }

    // 交替结算：先攻方最左 → 后攻方最左 → 先攻方次左 → 后攻方次左
    var maxLen = Math.max(socAtk.length, socDef.length);
    for (var i = 0; i < maxLen; i++) {
      if (i < socAtk.length) {
        this._executeStartOfCombat(socAtk[i], atkUnits, defUnits, ctx);
      }
      if (i < socDef.length) {
        this._executeStartOfCombat(socDef[i], defUnits, atkUnits, ctx);
      }
    }
  },

  _executeStartOfCombat: function(unit, ownSide, enemySide, ctx) {
    if (!unit.alive) return;
    var handlers = CombatEffects.getHandlers(unit.cardId);
    if (handlers && handlers.startOfCombat) {
      handlers.startOfCombat(ctx, unit, ownSide, enemySide);
    }
  },

  // ============================================================
  // Phase 2: 攻击
  // ============================================================

  _doAttack: function(attackerSide, defenderSide, ctx) {
    var attacker = null;
    for (var i = 0; i < attackerSide.length; i++) {
      if (attackerSide[i].alive) {
        attacker = attackerSide[i];
        break;
      }
    }
    if (!attacker) return;

    var target = this._findTarget(attacker, defenderSide, ctx.rng);
    if (!target) return;

    if (attacker.cleave && attacker.alive) {
      this._executeCleave(attacker, target, defenderSide, ctx);
    } else {
      this._executeAttack(attacker, target, ctx);
    }

    // 风怒第二次攻击
    if (attacker.alive && attacker.windfury && !attacker.windfuryUsed) {
      attacker.windfuryUsed = true;
      ctx.processEvents();
      if (!defenderSide.some(function(u) { return u.alive; })) return;
      var target2 = this._findTarget(attacker, defenderSide, ctx.rng);
      if (target2 && target2.alive) {
        if (attacker.cleave) {
          this._executeCleave(attacker, target2, defenderSide, ctx);
        } else {
          this._executeAttack(attacker, target2, ctx);
        }
      }
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

  // ============================================================
  // 攻击结算
  // ============================================================

  /** 顺劈攻击：命中目标 + 两侧相邻随从 */
  _executeCleave: function(attacker, primaryTarget, defenderSide, ctx) {
    var targets = this._getCleaveTargets(primaryTarget, defenderSide);
    for (var t = 0; t < targets.length; t++) {
      if (attacker.alive) {
        this._executeSingleHit(attacker, targets[t], ctx);
      }
    }
  },

  /** 获取顺劈目标列表（主目标 + 左右相邻存活随从） */
  _getCleaveTargets: function(primary, side) {
    var targets = [primary];
    var idx = side.indexOf(primary);
    // 左侧相邻
    for (var left = idx - 1; left >= 0; left--) {
      if (side[left].alive) {
        targets.unshift(side[left]);
        break;
      }
    }
    // 右侧相邻
    for (var right = idx + 1; right < side.length; right++) {
      if (side[right].alive) {
        targets.push(side[right]);
        break;
      }
    }
    return targets;
  },

  /** 普通攻击（单目标） */
  _executeAttack: function(attacker, defender, ctx) {
    this._executeSingleHit(attacker, defender, ctx);
  },

  /** 单次伤害结算（双方同时造成伤害）。
   *  ctx 可选：无 ctx 时使用旧版即时结算（向后兼容测试），有 ctx 时走事件队列。 */
  _executeSingleHit: function(attacker, defender, ctx) {
    if (!attacker.alive || !defender.alive) return;

    var atkDmg = attacker.attack;
    var defDmg = defender.attack;

    // Attacker → Defender
    var defTookDmg = false;
    if (defender.divineShield) {
      defender.divineShield = false;
    } else {
      if (attacker.venomous && defender.health > 0) {
        defender.health = 0;
      } else {
        defender.health -= atkDmg;
      }
      defTookDmg = true;
    }

    // Defender → Attacker (simultaneous)
    var atkTookDmg = false;
    if (defender.alive) {
      if (attacker.divineShield) {
        attacker.divineShield = false;
      } else {
        if (defender.venomous && attacker.health > 0) {
          attacker.health = 0;
        } else {
          attacker.health -= defDmg;
        }
        atkTookDmg = true;
      }
    }

    // 检查死亡
    var defDied = defender.health <= 0;
    var atkDied = attacker.health <= 0;

    if (ctx) {
      // 新版：通过事件队列处理死亡/亡语/复生/受伤时
      if (defDied) {
        defender.alive = false;
        ctx.onDeath(defender);
      }
      if (atkDied) {
        attacker.alive = false;
        ctx.onDeath(attacker);
      }
      if (defTookDmg && defender.alive) {
        ctx.triggerWhenDamaged(defender);
      }
      if (atkTookDmg && attacker.alive) {
        ctx.triggerWhenDamaged(attacker);
      }
    } else {
      // 旧版即时结算（向后兼容直接调用 _executeAttack 的测试）
      if (defDied) defender.alive = false;
      if (atkDied) attacker.alive = false;

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
  },

  // ============================================================
  // 构建战斗上下文
  // ============================================================

  _buildContext: function(atkUnits, defUnits, rng) {
    var self = this;
    var eventQueue = CombatEventQueue.create({});

    var ctx = {
      rng: rng,
      eventQueue: eventQueue,
      deathCount: 0,
      allUnits: [], // 所有曾参与战斗的单位

      /** 随从死亡时调用 */
      onDeath: function(unit) {
        ctx.deathCount++;
        unit.deathCount = ctx.deathCount;

        // 更新光环类随从的死亡计数
        ctx._updateDeathAuras(unit);

        // 1) 亡语事件入队
        if (unit.hasDeathrattle) {
          var drHandler = self._getDeathrattleHandler(unit);
          if (drHandler) {
            eventQueue.push(CombatEventQueue.createEvent('DEATHRATTLE', function() {
              drHandler(ctx, unit, ctx._findSide(unit), ctx._enemySide(unit), eventQueue);
            }, { cardId: unit.cardId, unit: unit }));
          }
        }

        // 2) 复生事件入队（在亡语之后）
        if (unit.reborn && !unit.rebornUsed) {
          eventQueue.push(CombatEventQueue.createEvent('REBORN', function() {
            if (!unit.alive && unit.reborn && !unit.rebornUsed) {
              unit.alive = true;
              unit.health = 1;
              unit.maxHealth = 1;
              unit.rebornUsed = true;
              unit.divineShield = false;
              unit.windfuryUsed = false;
            }
          }, { cardId: unit.cardId, unit: unit }));
        }

        // 3) 光环修正事件（优先于亡语结算）
        eventQueue.push(CombatEventQueue.createEvent('AURA_UPDATE', function() {
          ctx._processAllAuras();
        }, {}));

        // 4) 复仇事件
        ctx._triggerAvenge(unit);
      },

      /** "受伤时"效果 —— 最高优先级，立即入队并处理 */
      triggerWhenDamaged: function(unit) {
        if (!unit.alive) return;
        // 检查己方所有"受伤时"触发型随从
        var side = ctx._findSide(unit);
        for (var i = 0; i < side.length; i++) {
          if (side[i].alive && side[i].hasWhenDamaged) {
            var handlers = CombatEffects.getHandlers(side[i].cardId);
            if (handlers && handlers.whenDamaged) {
              (function(wdHandler, s, u) {
                eventQueue.push(CombatEventQueue.createEvent('WHEN_DAMAGED', function() {
                  wdHandler(ctx, u, s, ctx._enemySide(s[0]), eventQueue);
                }, { cardId: s[0].cardId }));
              })(handlers.whenDamaged, side, unit);
            }
          }
        }
      },

      /** 处理事件队列 */
      processEvents: function() {
        eventQueue.processAll();
      },

      /** 构建 token 随从 */
      buildToken: function(spec) {
        return {
          cardId: spec.cardId || 'token',
          name_cn: spec.name_cn || 'token',
          attack: spec.attack || 0,
          health: spec.health || 1,
          maxHealth: spec.health || 1,
          baseAttack: spec.attack || 0,
          baseHealth: spec.health || 1,
          divineShield: !!spec.divineShield,
          reborn: !!spec.reborn,
          windfury: false,
          venomous: !!spec.venomous,
          taunt: !!spec.taunt,
          cleave: false,
          hasDeathrattle: false,
          hasStartOfCombat: false,
          hasAura: false,
          hasAvenge: false,
          hasWhenDamaged: false,
          minionTypes: spec.minionTypes || [],
          mechanics: [],
          golden: false,
          tier: spec.tier || 1,
          position: spec.position || 999,
          alive: true,
          rebornUsed: false,
          windfuryUsed: false,
          attacksThisTurn: 0,
          deathCount: 0,
        };
      },

      /** 在战场上召唤 token */
      spawnToken: function(side, token) {
        side.push(token);
        ctx.allUnits.push(token);
      },

      /** 判断随从种族 */
      isMinionType: function(unit, type) {
        if (!unit.minionTypes) return false;
        for (var i = 0; i < unit.minionTypes.length; i++) {
          if (unit.minionTypes[i] === type) return true;
        }
        return false;
      },

      // -- 内部方法 --

      _findSide: function(unit) {
        if (atkUnits.indexOf(unit) !== -1) return atkUnits;
        return defUnits;
      },

      _enemySide: function(unit) {
        if (atkUnits.indexOf(unit) !== -1) return defUnits;
        return atkUnits;
      },

      _updateDeathAuras: function(deadUnit) {
        // 通知双方所有光环随从更新死亡计数
        var allSides = [atkUnits, defUnits];
        for (var s = 0; s < allSides.length; s++) {
          for (var i = 0; i < allSides[s].length; i++) {
            var u = allSides[s][i];
            if (u.alive && u.hasAura) {
              u.deathCount = ctx.deathCount;
            }
          }
        }
      },

      _processAllAuras: function() {
        var allSides = [atkUnits, defUnits];
        for (var s = 0; s < allSides.length; s++) {
          for (var i = 0; i < allSides[s].length; i++) {
            var u = allSides[s][i];
            if (u.alive && u.hasAura) {
              var handlers = CombatEffects.getHandlers(u.cardId);
              if (handlers && handlers.aura) {
                handlers.aura(ctx, u, allSides[s], ctx._enemySide(u));
              }
              // 光环修正：如果随从血量降到0以下但光环可能将其抬回正值
              if (u.health <= 0 && u.baseHealth > 0) {
                // 重新计算（光环效果已在上面应用）
              }
            }
          }
        }
        // 光环可能复活0血随从
        for (var s2 = 0; s2 < allSides.length; s2++) {
          for (var j = 0; j < allSides[s2].length; j++) {
            var v = allSides[s2][j];
            if (!v.alive && v.health > 0) {
              v.alive = true;
            }
          }
        }
      },

      _triggerAvenge: function(deadUnit) {
        var side = ctx._findSide(deadUnit);
        for (var i = 0; i < side.length; i++) {
          if (side[i].alive && side[i].hasAvenge) {
            var handlers = CombatEffects.getHandlers(side[i].cardId);
            if (handlers && handlers.avenge) {
              eventQueue.push(CombatEventQueue.createEvent('AVENGE', function() {
                handlers.avenge(ctx, side[i], side, ctx._enemySide(side[i]), eventQueue);
              }, { cardId: side[i].cardId }));
            }
          }
        }
      },
    };

    // 初始化所有单位引用
    for (var a = 0; a < atkUnits.length; a++) { ctx.allUnits.push(atkUnits[a]); }
    for (var d = 0; d < defUnits.length; d++) { ctx.allUnits.push(defUnits[d]); }

    return ctx;
  },

  /** 获取亡语处理器 */
  _getDeathrattleHandler: function(unit) {
    var handlers = CombatEffects.getHandlers(unit.cardId);
    if (handlers && handlers.deathrattle) {
      return handlers.deathrattle;
    }
    return null; // 未注册亡语效果则跳过（仅记录死亡）
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CombatResolver;
}
