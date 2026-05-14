"use strict";

// ═══════════════════════════════════════════════════════════
// LevelingModule — 升本建议 + 危险警告
// ═══════════════════════════════════════════════════════════

var LevelingModule = class LevelingModule extends BaseModule {
  constructor(config) {
    super("LevelingModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];

    // 1. 危险警告（最高优先）
    var dangerDec = this._checkDanger(ctx);
    if (dangerDec) decisions.push(dangerDec);

    // 2. 升本建议
    var levelDec = this._checkLevelUp(ctx);
    if (levelDec) decisions.push(levelDec);

    return decisions;
  }

  // ── 危险检测 ──

  _checkDanger(ctx) {
    var hpThreshold = (ctx.decisionTables && ctx.decisionTables.board_power_estimation &&
      ctx.decisionTables.board_power_estimation.health_threshold_danger) || 10;

    if (ctx.health <= hpThreshold && ctx.boardPower < 0.5) {
      return this._decide(
        "danger",
        DecisionPriority.DANGER,
        "emergency_defense",
        "危险！急需战力",
        "血量仅剩" + ctx.health + "，场面战力" + ctx.boardPower.toFixed(1) + "不足。" +
        "优先购买高战力随从保命，不要贪升本。",
        0.95
      );
    }
    return null;
  }

  // ── 升本检查 ──

  _checkLevelUp(ctx) {
    if (!ctx.decisionTables || !ctx.decisionTables.leveling_curve) return null;

    var table = ctx.decisionTables;
    var curveData = this._getCurve(ctx);
    var turnKey = String(ctx.turn);
    var entry = curveData[turnKey];
    if (!entry) return null;

    // 条件检查（自适应阈值）
    var canLevel = ctx.gold >= entry.cost;
    var boardThreshold = this._calcDynamicThreshold(ctx);
    var boardOk = ctx.boardPower >= boardThreshold;
    var healthThreshold = (table.board_power_estimation &&
      table.board_power_estimation.health_threshold_danger) || 10;
    var healthOk = ctx.health > healthThreshold;

    if (!canLevel || !boardOk || !healthOk) return null;

    var targetTier = ctx.tavernTier + 1;
    var keyCardName = this._getKeyCardName(ctx);

    // 英雄特殊逻辑：阿凯(16)在特定回合跳升本
    var heroOverride = this._heroOverride(ctx.heroCardId, table.leveling_curve);
    var heroNote = "";
    if (heroOverride && heroOverride.curve_hint) {
      heroNote = "（" + heroOverride.curve_hint + "曲线）";
    }

    var priority = (ctx.boardPower >= 0.8 || ctx.health >= 20)
      ? DecisionPriority.LEVEL_UP_STANDARD
      : DecisionPriority.LEVEL_UP_CRITICAL;

    return this._decide(
      "level_up",
      priority,
      "level_to_" + targetTier,
      "建议升本→" + targetTier + heroNote,
      "场面战力 " + ctx.boardPower.toFixed(1) + "，血量 " + ctx.health + " 安全。" +
      "升" + targetTier + "本后可找" + keyCardName + "完善阵容。",
      0.7 + (boardOk ? 0.15 : 0) + (healthOk ? 0.1 : 0),
      { targetTier: targetTier, cost: entry.cost }
    );
  }

  _getCurve(ctx) {
    var table = ctx.decisionTables;
    if (!table || !table.leveling_curve) return {};

    // 英雄覆盖曲线
    var heroOverride = this._heroOverride(ctx.heroCardId, table.leveling_curve);
    if (heroOverride && heroOverride.custom_curve) {
      return heroOverride.custom_curve;
    }

    var curveType = ctx.curveType || "standard";
    var curve = table.leveling_curve[curveType] || table.leveling_curve.standard || {};
    return curve;
  }

  _calcDynamicThreshold(ctx) {
    var table = (ctx.decisionTables && ctx.decisionTables.board_power_estimation) || {};
    var cfg = table.adaptive_leveling || {};
    var base = cfg.base_threshold || 0.3;
    var threshold = base;

    // Round adjustment
    var turn = ctx.turn || 5;
    var turnAdj = cfg.turn_adjustments || { early: 0.1, mid: 0.0, late: -0.05 };
    if (turn <= 3) threshold += turnAdj.early || 0.1;
    else if (turn >= 8) threshold += turnAdj.late || -0.05;

    // Health adjustment
    var health = ctx.health || 25;
    if (health > 25) threshold += cfg.health_safe_above_25 || -0.08;
    else if (health < 10) threshold += cfg.health_danger_below_10 || 0.15;

    // Board power adjustment
    var bp = ctx.boardPower || 1.0;
    if (bp > 1.5) threshold += cfg.board_strong_above_1_5 || -0.05;
    else if (bp < 0.5) threshold += cfg.board_weak_below_0_5 || 0.1;

    // Comp progress adjustment
    var compMatch = ctx.currentComp ? ctx.currentComp.matchPercent || 0 : 0;
    if (compMatch >= 60) threshold += cfg.comp_forming_above_60 || -0.05;
    else if (compMatch < 30 && compMatch > 0) threshold += cfg.comp_weak_below_30 || 0.05;

    // Clamp
    var minT = cfg.min_threshold || 0.15;
    var maxT = cfg.max_threshold || 0.55;
    return Math.max(minT, Math.min(maxT, threshold));
  }

  _getKeyCardName(ctx) {
    // 从当前流派匹配中找出缺失的核心卡
    if (ctx.currentComp && ctx.currentComp.missingCards && ctx.currentComp.missingCards.length > 0) {
      return ctx.currentComp.missingCards[0]; // 返回 cardId，渲染时会翻译
    }
    return "核心卡";
  }
};
