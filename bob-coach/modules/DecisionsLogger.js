"use strict";

// ═══════════════════════════════════════════════════════════
// DecisionsLogger — 对局决策记录器（轻量版）
// 格式: 每回合一条 JSON line → sessions/decisions.log
// 匹配文档「反馈核心机制」的 decisions.log 规范
// ═══════════════════════════════════════════════════════════

var DecisionsLogger = class DecisionsLogger {
  /**
   * @param {function} writeFn — window.bobCoach.logDecision(entry)
   */
  constructor(writeFn) {
    this._write = writeFn || (function () {});
    this._sessionId = "session_" + Date.now();
    this._turnSnapshots = [];
    this._heroName = "";
    this._heroCardId = "";
  }

  /** 对局开始 */
  startSession(heroCardId, heroName) {
    this._sessionId = "session_" + Date.now();
    this._turnSnapshots = [];
    this._heroCardId = heroCardId || "";
    this._heroName = heroName || "";
    this._write({
      type: "session_start",
      sessionId: this._sessionId,
      timestamp: new Date().toISOString(),
      heroCardId: this._heroCardId,
      heroName: this._heroName,
    });
  }

  /**
   * 每回合决策引擎运行后调用。
   * @param {object} state — overlay state（含 suggestion, secondaryHints, compMatches 等）
   */
  logTurn(state) {
    if (!state.gameActive) return;

    var s = state.suggestion;
    var entry = {
      type: "turn_decision",
      sessionId: this._sessionId,
      timestamp: new Date().toISOString(),
      turn: state.turn,
      gold: state.gold,
      maxGold: state.maxGold,
      tavernTier: state.tavernTier,
      health: state.health,
      heroCardId: state.heroCardId,
      heroName: state.heroName,
      boardSize: (state.boardMinions || []).length,
      dominantTribe: null,
      suggestion: s ? {
        type: s.type,
        action: s.action,
        message: s.message,
        confidence: s.confidence,
      } : null,
      secondaryHints: (state.secondaryHints || []).map(function (h) {
        return { type: h.type, message: h.message, confidence: h.confidence };
      }),
      topComp: state.currentComp ? {
        name: state.currentComp.comp ? (state.currentComp.comp.name_cn || state.currentComp.comp.name) : "?",
        matchPercent: state.currentComp.matchPercent,
      } : null,
      playerAction: null,    // 占位 — 后续可从 log 解析填充
      combatResult: null,    // 占位 — 后续可从 log 解析填充
      finalRank: null,
    };

    this._turnSnapshots.push(entry);
    this._write(entry);
  }

  /**
   * 对局结束（需外部传入最终排名）。
   * @param {number} finalRank
   */
  endSession(finalRank) {
    if (this._turnSnapshots.length === 0) return;
    // 回写最终排名到所有已记录回合
    for (var i = 0; i < this._turnSnapshots.length; i++) {
      this._turnSnapshots[i].finalRank = finalRank;
    }
    this._write({
      type: "session_end",
      sessionId: this._sessionId,
      timestamp: new Date().toISOString(),
      heroCardId: this._heroCardId,
      heroName: this._heroName,
      totalTurns: this._turnSnapshots.length,
      finalRank: finalRank,
    });
  }

  getSessionId() {
    return this._sessionId;
  }
};
