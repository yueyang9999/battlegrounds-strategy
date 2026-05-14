"use strict";

// ═══════════════════════════════════════════════════════════
// DecisionBase — 统一决策类型 + 模块基类
// ═══════════════════════════════════════════════════════════

// ── 标准决策对象 ──
// { type, priority, action, message, reason, confidence, data }

var Decision = class Decision {
  /**
   * @param {string} type    — "level_up"|"minion_pick"|"hero_power"|"danger"|"spell_buy"|"spell_use"|"trinket_pick"|"refresh"
   * @param {number} priority — 0-100, 越高越优先
   * @param {string} action  — 动作标识，如 "level_up", "buy_card_2", "use_hero_power"
   * @param {string} message — 简短展示文字（中文）
   * @param {string} reason  — 详细推理（中文，显示在战术面板）
   * @param {number} confidence — 0.0-1.0 置信度
   * @param {object} [data]  — 模块特定数据
   */
  constructor(type, priority, action, message, reason, confidence, data) {
    this.type = type;
    this.priority = priority;
    this.action = action;
    this.message = message;
    this.reason = reason;
    this.confidence = confidence;
    this.data = data || {};
  }
};

// ── 优先级常量 ──
var DecisionPriority = {
  DANGER: 100,
  HERO_POWER_MANDATORY: 90,
  LEVEL_UP_CRITICAL: 85,
  CORE_MINION: 80,
  SPELL_MUST_BUY: 75,
  TRINKET_BEST: 70,
  LEVEL_UP_STANDARD: 60,
  POWER_MINION: 50,
  SPELL_GOOD: 45,
  REFRESH_HINT: 30,
  TRINKET_OK: 20,
  INFO: 10,
};

// ═══════════════════════════════════════════════════════════
// BaseModule — 所有决策模块的基类
// ═══════════════════════════════════════════════════════════

var BaseModule = class BaseModule {
  /**
   * @param {string} name   — 模块名（用于日志和调试）
   * @param {object} config — 本模块对应 decision_tables 中的配置段
   */
  constructor(name, config) {
    this.name = name;
    this.config = config || {};
  }

  /**
   * 评估当前游戏状态，返回决策数组。
   * 子类必须重写此方法。
   * @param {object} ctx — 游戏上下文（由 buildContext 构建）
   * @returns {Decision[]}
   */
  evaluate(ctx) {
    return [];
  }

  /**
   * 快捷创建 Decision 对象。
   */
  _decide(type, priority, action, message, reason, confidence, data) {
    var d = new Decision(type, priority, action, message, reason, confidence, data);
    d.source = this.name;
    return d;
  }

  /**
   * 从配置中查找当前英雄的覆盖规则。
   * 配置格式: { overrides: { "HERO_ID": { ... } }, default: { ... } }
   * @param {string} heroCardId
   * @param {object} ruleTable
   * @returns {object|null} 英雄的覆盖规则，或 null
   */
  _heroOverride(heroCardId, ruleTable) {
    if (!ruleTable) return null;
    if (ruleTable.overrides && ruleTable.overrides[heroCardId]) {
      return ruleTable.overrides[heroCardId];
    }
    return null;
  }

  /**
   * 获取金币花费。
   * @param {object} decision
   * @param {object} ctx
   * @returns {number}
   */
  _goldCost(decision, ctx) {
    switch (decision.type) {
      case "level_up": {
        // 查 leveling_curve 获取升本费用
        const curve = (ctx.decisionTables && ctx.decisionTables.leveling_curve) || {};
        const curveData = curve[ctx.curveType] || curve.standard || {};
        const entry = curveData[String(ctx.turn)];
        return entry ? entry.cost : ctx.tavernTier + 3; // fallback estimate
      }
      case "minion_pick":
        // 委托给 RulesEngine 统一计算洋葱层修正
        if (typeof RulesEngine !== 'undefined' && RulesEngine.getBuyCost) {
          return RulesEngine.getBuyCost(ctx);
        }
        return 3;
      case "hero_power":
        return ctx.heroPowerCost || 0;
      case "spell_buy":
      case "spell_use":
        return (decision.data && decision.data.cost) || 1;
      case "refresh":
        return 1;
      default:
        return 0;
    }
  }
};
