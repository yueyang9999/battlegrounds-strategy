"use strict";

// ═══════════════════════════════════════════════════════════
// StrategyVersionManager — 上分策略版本管理与自动进化
// ═══════════════════════════════════════════════════════════
//
// 核心规则:
//   1. baseline.json 首次写入后不可覆盖
//   2. 新策略必须通过模拟测试（N局验证）
//   3. 新策略比当前策略表现好 → 归档当前 → 部署新策略
//   4. 新策略比当前策略表现差 → 保留当前，记录失败日志
//   5. 可手动回滚到任意历史版本
//
// 用法:
//   var svm = new StrategyVersionManager(featureStore, simConfig);
//   var result = svm.tryUpgrade(newFeature);
//   if (result.accepted) { ... } else { ... }
//
// 模拟测试配置:
//   validationGames: 500    — 升级前验证局数
//   minImprovement: 0.05    — 均排至少提升0.05才算更好
//   top4Threshold: 0.01     — 前四率至少提升1%

var StrategyVersionManager = (function() {

  function StrategyVersionManager(featureStore, simConfig) {
    this._store = featureStore;
    this._config = simConfig || {};
    this._validationGames = this._config.validationGames || 500;
    this._minImprovement = this._config.minImprovement || 0.05;
    this._top4Threshold = this._config.top4Threshold || 0.01;
    this._upgradeLog = [];
  }

  /**
   * 初始化：在 baseline 不存在时写入首次特征。
   */
  StrategyVersionManager.prototype.initialize = function(initialFeature) {
    var baseline = this._store.loadRankedBaseline();
    if (!baseline && initialFeature) {
      this._store.saveRankedBaseline(initialFeature);
      this._store.saveRankedCurrent(initialFeature);
      this._store.archiveRankedVersion(); // v001 = initial
      return { action: "init", version: "v001", baseline: true };
    }
    return { action: "skip", reason: "baseline exists" };
  };

  /**
   * 尝试升级策略。
   *
   * 流程:
   *   1. 用新特征跑 N 局模拟验证 → 获取验证指标
   *   2. 对比当前策略的指标（或基线指标）
   *   3. 新策略更好 → 归档当前 → 部署新策略
   *   4. 新策略更差 → 记录失败 → 保留当前
   *
   * @param {object} newFeature — 候选策略特征向量
   * @param {function} validator — 验证函数 (feature, games) => { avgPlacement, top4Rate, winRate }
   * @returns {{ accepted: boolean, version: string|null, reason: string, validation: object|null }}
   */
  StrategyVersionManager.prototype.tryUpgrade = function(newFeature, validator) {
    var current = this._store.loadRankedCurrent();
    var baseline = this._store.loadRankedBaseline();

    // 1. 验证新策略
    var validation = null;
    if (validator && typeof validator === "function") {
      console.log("[StrategyVM] 运行验证测试 (" + this._validationGames + " 局)...");
      validation = validator(newFeature, this._validationGames);
      if (!validation) {
        return { accepted: false, version: null, reason: "验证测试失败（无结果）", validation: null };
      }
    }

    // 2. 确定对比基准
    var compareTarget = current || baseline;
    if (!compareTarget) {
      // 首次部署
      this._initializeFirst(newFeature, validation);
      return { accepted: true, version: "v001", reason: "首次部署", validation: validation };
    }

    // 3. 对比
    var curMeta = compareTarget.meta || {};
    var curPlacement = curMeta.avgPlacement || 5;
    var curTop4 = curMeta.top4Rate || 0;
    var newPlacement = validation ? validation.avgPlacement : 0;
    var newTop4 = validation ? validation.top4Rate : 0;

    var placementImprovement = curPlacement - newPlacement;  // 正值 = 进步
    var top4Improvement = newTop4 - curTop4;

    var isBetter = placementImprovement >= this._minImprovement || top4Improvement >= this._top4Threshold;

    // 4. 决定
    if (isBetter) {
      // 归档当前版本
      var oldVersion = this._store.archiveRankedVersion();
      // 写入新特征
      newFeature.meta = newFeature.meta || {};
      newFeature.meta.avgPlacement = newPlacement;
      newFeature.meta.top4Rate = newTop4;
      newFeature.meta.validatedAt = new Date().toISOString();
      newFeature.meta.prevVersion = oldVersion;
      newFeature.meta.placementImprovement = placementImprovement;
      newFeature.meta.top4Improvement = top4Improvement;

      this._store.saveRankedCurrent(newFeature);

      var newVersion = this._store.archiveRankedVersion();

      this._log({
        action: "upgrade",
        fromVersion: oldVersion,
        toVersion: newVersion,
        placementImprovement: placementImprovement,
        top4Improvement: top4Improvement,
        timestamp: new Date().toISOString(),
      });

      return {
        accepted: true,
        version: newVersion,
        prevVersion: oldVersion,
        reason: "策略提升: 均排+" + placementImprovement.toFixed(2) + " 前四率+" + (top4Improvement * 100).toFixed(1) + "%",
        validation: validation,
      };
    } else {
      // 拒绝，保留当前
      this._log({
        action: "reject",
        currentVersion: current ? current.meta.version : "unknown",
        reason: "insufficient improvement",
        placementImprovement: placementImprovement,
        top4Improvement: top4Improvement,
        timestamp: new Date().toISOString(),
      });

      return {
        accepted: false,
        version: null,
        reason: "策略未达标: 均排提升+" + placementImprovement.toFixed(2) + " (需>=" + this._minImprovement.toFixed(2) + ") 前四率+" + (top4Improvement * 100).toFixed(1) + "% (需>=" + (this._top4Threshold * 100).toFixed(1) + "%)",
        validation: validation,
      };
    }
  },

  /**
   * 手动回滚到指定历史版本。
   * @param {string} versionStr — "v002" 或 "v001"
   * @returns {boolean}
   */
  StrategyVersionManager.prototype.rollback = function(versionStr) {
    var history = this._store.listRankedHistory();
    var found = false;
    for (var i = 0; i < history.length; i++) {
      if (history[i].startsWith(versionStr)) { found = true; break; }
    }
    if (!found) return false;

    // 归档当前
    this._store.archiveRankedVersion();
    // 回滚
    var ok = this._store.rollbackTo(versionStr);
    if (ok) {
      this._log({
        action: "rollback",
        toVersion: versionStr,
        timestamp: new Date().toISOString(),
      });
    }
    return ok;
  },

  /**
   * 获取版本历史摘要。
   */
  StrategyVersionManager.prototype.getHistory = function() {
    var files = this._store.listRankedHistory();
    var current = this._store.loadRankedCurrent();
    var baseline = this._store.loadRankedBaseline();
    return {
      baselineVersion: baseline ? "v001" : null,
      currentVersion: current ? (current.meta ? current.meta.version : "unknown") : null,
      totalVersions: files.length,
      history: files,
      upgradeLog: this._loadLog(),
    };
  },

  // ── 内部 ──

  StrategyVersionManager.prototype._initializeFirst = function(feature, validation) {
    feature.meta = feature.meta || {};
    if (validation) {
      feature.meta.avgPlacement = validation.avgPlacement;
      feature.meta.top4Rate = validation.top4Rate;
    }
    feature.meta.validatedAt = new Date().toISOString();
    this._store.saveRankedBaseline(feature);
    this._store.saveRankedCurrent(feature);
    this._store.archiveRankedVersion();
  };

  StrategyVersionManager.prototype._log = function(entry) {
    this._upgradeLog.push(entry);
    if (this._upgradeLog.length > 100) this._upgradeLog = this._upgradeLog.slice(-100);
    try {
      var fs = require("fs");
      var path = require("path");
      var logPath = path.join(this._store._base, "ranked", "upgrade_log.json");
      var existing = [];
      try { existing = JSON.parse(fs.readFileSync(logPath, "utf-8")); } catch(e) {}
      existing.push(entry);
      if (existing.length > 200) existing = existing.slice(-200);
      fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), "utf-8");
    } catch(e) {}
  };

  StrategyVersionManager.prototype._loadLog = function() {
    try {
      var fs = require("fs");
      var path = require("path");
      var logPath = path.join(this._store._base, "ranked", "upgrade_log.json");
      return JSON.parse(fs.readFileSync(logPath, "utf-8"));
    } catch(e) { return []; }
  };

  return StrategyVersionManager;
})();
