"use strict";

// ═══════════════════════════════════════════════════════════
// Orchestrator — 模块调度器
// 注册模块 → 并行评估 → 冲突消解 → 格式化输出
// ═══════════════════════════════════════════════════════════

var Orchestrator = class Orchestrator {
  constructor() {
    this.modules = [];
    this._priorityConfig = null;
  }

  /**
   * 注册决策模块。
   * @param {BaseModule} module
   */
  register(module) {
    this.modules.push(module);
  }

  /**
   * 从 decision_tables 加载优先级配置。
   * @param {object} config — decision_tables.priority_config
   */
  loadPriorityConfig(config) {
    this._priorityConfig = config || DecisionPriority;
  }

  /**
   * 主入口：接收游戏上下文，运行全部模块，返回 UI 就绪的结果。
   * @param {object} ctx — buildContext() 的输出
   * @returns {{ primarySuggestion: Decision|null, secondaryHints: Decision[], cardHighlights: object[], compPanelData: object }}
   */
  run(ctx) {
    // Phase 1+2: 并行评估 + 收集
    var allDecisions = [];
    for (var i = 0; i < this.modules.length; i++) {
      try {
        var mod = this.modules[i];
        var decisions = mod.evaluate(ctx) || [];
        allDecisions.push.apply(allDecisions, decisions);
      } catch (e) {
        console.error("[Orchestrator] Module " + this.modules[i].name + " error:", e);
      }
    }

    // Phase 3: 过滤（移除不适用或低置信度决策）
    var filtered = this._filter(allDecisions, ctx);

    // Phase 4: 冲突消解
    var resolved = this._resolveConflicts(filtered, ctx);

    // Phase 5: 排序
    resolved.sort(function (a, b) {
      var scoreA = (a.priority || 0) * (a.confidence || 0);
      var scoreB = (b.priority || 0) * (b.confidence || 0);
      return scoreB - scoreA;
    });

    // Phase 6: 格式化输出
    return this._formatOutput(resolved, ctx);
  }

  // ── Phase 3: 过滤 ──
  _filter(decisions, ctx) {
    var minConfidence = 0.2;
    return decisions.filter(function (d) {
      if (!d || !d.type) return false;
      if (d.confidence < minConfidence) return false;
      // 不在商店/招募阶段时过滤购买类建议
      if (ctx.gamePhase !== "shop" && ctx.gamePhase !== "recruit") {
        if (d.type === "minion_pick" || d.type === "spell_buy" || d.type === "refresh" || d.type === "refresh_smart" || d.type === "freeze" || d.type === "unfreeze") {
          return false;
        }
      }
      return true;
    });
  }

  // ── Phase 4: 冲突消解 ──

  _resolveConflicts(decisions, ctx) {
    if (decisions.length <= 1) return decisions;

    // 危险警告永远排第一，不被覆盖
    var dangers = [];
    var others = [];
    for (var i = 0; i < decisions.length; i++) {
      if (decisions[i].type === "danger") {
        dangers.push(decisions[i]);
      } else {
        others.push(decisions[i]);
      }
    }

    // 对非危险决策按金币预算检查
    var remainingGold = ctx.gold || 0;
    var accepted = dangers.slice(); // 危险警告不消耗金币

    // 分离卖牌决策（优先处理，因为卖牌产生金币）
    var sellDecisions = [];
    var regularDecisions = [];
    for (var i = 0; i < others.length; i++) {
      if (others[i].type === "sell_minion") {
        sellDecisions.push(others[i]);
      } else {
        regularDecisions.push(others[i]);
      }
    }

    // 先处理卖牌决策（生成金币）
    for (var i = 0; i < sellDecisions.length; i++) {
      var sd = sellDecisions[i];
      var sCost = this._estimateCost(sd, ctx);
      accepted.push(sd);
      remainingGold -= sCost; // sCost 为负值，所以 remainingGold 增加
    }

    // 按 score = priority * confidence 排序
    regularDecisions.sort(function (a, b) {
      return (b.priority * b.confidence) - (a.priority * a.confidence);
    });

    // freeze 与 refresh 互斥：冻结优先（免费、安全），移除刷新建议
    var hasFreeze = false;
    for (var fi = 0; fi < regularDecisions.length; fi++) {
      if (regularDecisions[fi].type === "freeze") { hasFreeze = true; break; }
    }
    if (hasFreeze) {
      regularDecisions = regularDecisions.filter(function (d) {
        return d.type !== "refresh" && d.type !== "refresh_smart";
      });
    }

    for (var i = 0; i < regularDecisions.length; i++) {
      var d = regularDecisions[i];
      var cost = this._estimateCost(d, ctx);

      if (cost <= remainingGold) {
        accepted.push(d);
        remainingGold -= cost;
      } else if (d.confidence > 0.5 && d.priority >= DecisionPriority.POWER_MINION) {
        // 高优先级但费用不足：标记为次级建议
        if (!d.data) d.data = {};
        d.data.insufficientGold = true;
        accepted.push(d);
      }
      // 否则丢弃（低优先级且费用不足）
    }

    return accepted;
  }

  _estimateCost(decision, ctx) {
    // 委托给 RulesEngine 统一计算（洋葱层修正模型）
    if (typeof RulesEngine !== "undefined" && RulesEngine.getDecisionCost) {
      return RulesEngine.getDecisionCost(decision, ctx);
    }
    // fallback（RulesEngine 未加载时）
    switch (decision.type) {
      case "level_up":
        return 4;
      case "minion_pick":
        return 3;
      case "hero_power":
        return ctx.heroPowerCost || 0;
      case "spell_buy":
      case "spell_use":
        return (decision.data && decision.data.cost) || 1;
      case "refresh":
        return 1;
      case "trinket_pick":
        return 0;
      default:
        return 0;
    }
  }

  // ── Phase 6: 格式化 ──

  _formatOutput(decisions, ctx) {
    var primary = decisions.length > 0 ? decisions[0] : null;
    var secondary = decisions.length > 1 ? decisions.slice(1) : [];

    // 从 MinionPickModule 的决策中提取选牌高亮
    var cardHighlights = [];
    for (var i = 0; i < decisions.length; i++) {
      if (decisions[i].type === "minion_pick" && decisions[i].data && decisions[i].data.highlights) {
        cardHighlights = decisions[i].data.highlights;
        break;
      }
    }
    // 兜底：用现有 evaluateShopCards（ctx 上可能已经计算过）
    if (cardHighlights.length === 0 && ctx._shopEvaluations) {
      cardHighlights = ctx._shopEvaluations;
    }

    // 流派匹配数据
    var compPanelData = {
      compMatches: ctx.compMatches || [],
      currentComp: ctx.currentComp || null,
    };

    return {
      primarySuggestion: primary,
      secondaryHints: secondary,
      cardHighlights: cardHighlights,
      compPanelData: compPanelData,
    };
  }
};
