"use strict";

// ═══════════════════════════════════════════════════════════
// FeatureStore — 本地玩法特征读写层
// ═══════════════════════════════════════════════════════════
//
// 目录结构:
//   data/playstyle/
//     local/
//       recent_20.json           — 最近20局滑动窗口特征
//       personal_preference.json — 个人喜好长期特征快照
//     ranked/
//       current.json             — 当前活跃的上分特征
//       baseline.json            — 首次上分特征（不可覆盖）
//       history/                 — 历史版本 {v001_xxx.json, v002_xxx.json}
//     remote/
//       tier_9000_plus.json      — 云端高分段缓存
//       meta.json                — 云端版本元数据
//
// 用法（Node.js 端）:
//   var store = new FeatureStore("data/playstyle");
//   store.saveRecent20(features);
//   var recent = store.loadRecent20();

var FeatureStore = (function() {

  var _fs = null;
  var _path = null;

  // 由加载脚本注入（在 Node.js 端调用 FeatureStore.injectFS(fs, path)）
  FeatureStore.injectFS = function(fsModule, pathModule) {
    _fs = fsModule;
    _path = pathModule;
  };

  function FeatureStore(baseDir) {
    // 确保 fs/path 已注入
    if (!_fs || !_path) {
      try { _fs = require("fs"); _path = require("path"); } catch(e) {}
      if (!_fs || !_path) throw new Error("FeatureStore: fs/path 未注入，请先调用 FeatureStore.injectFS(fs, path)");
    }
    this._base = baseDir || _path.join(process.cwd(), "data", "playstyle");
    this._ensureDirs();
  }

  FeatureStore.prototype._ensureDirs = function() {
    if (!_fs) return;
    var dirs = [
      this._base,
      _path.join(this._base, "local"),
      _path.join(this._base, "ranked"),
      _path.join(this._base, "ranked", "history"),
      _path.join(this._base, "remote"),
    ];
    for (var i = 0; i < dirs.length; i++) {
      if (!_fs.existsSync(dirs[i])) {
        _fs.mkdirSync(dirs[i], { recursive: true });
      }
    }
  };

  FeatureStore.prototype._readJSON = function(relPath) {
    if (!_fs) return null;
    var full = _path.join(this._base, relPath);
    if (!_fs.existsSync(full)) return null;
    try {
      return JSON.parse(_fs.readFileSync(full, "utf-8"));
    } catch (e) { return null; }
  };

  FeatureStore.prototype._writeJSON = function(relPath, data) {
    if (!_fs) return;
    var full = _path.join(this._base, relPath);
    _fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf-8");
  };

  FeatureStore.prototype._fileExists = function(relPath) {
    if (!_fs) return false;
    return _fs.existsSync(_path.join(this._base, relPath));
  };

  // ═══════════════════════════════════════════════════════════
  // 本地特征 — 最近20局滑动窗口
  // ═══════════════════════════════════════════════════════════

  /**
   * 保存最近20局特征向量（新对局推入，超过20则挤出最旧的）。
   * @param {object} gameFeature — 单局特征（PlaystyleFeatures.extractFromPlayer 输出）
   */
  FeatureStore.prototype.pushRecentGame = function(gameFeature) {
    var recent = this.loadRecent20();
    recent.push(gameFeature);
    if (recent.length > 20) recent = recent.slice(-20);
    this._writeJSON("local/recent_20.json", recent);
    // 同时更新聚合后的个人喜好特征
    this._updatePersonalPreference(recent);
    return recent;
  };

  FeatureStore.prototype.loadRecent20 = function() {
    return this._readJSON("local/recent_20.json") || [];
  };

  /** 获取最近N局聚合特征（默认20） */
  FeatureStore.prototype.getRecentAggregated = function(n) {
    var recent = this.loadRecent20();
    if (n) recent = recent.slice(-n);
    if (recent.length === 0) return null;
    // 使用 PlaystyleFeatures.aggregate（如果已加载）
    if (typeof PlaystyleFeatures !== "undefined") {
      return PlaystyleFeatures.aggregate(recent);
    }
    return recent;
  };

  // ═══════════════════════════════════════════════════════════
  // 个人喜好特征 — 长期积累（加权平均，近期权重更高）
  // ═══════════════════════════════════════════════════════════

  FeatureStore.prototype._updatePersonalPreference = function(recent20) {
    if (typeof PlaystyleFeatures === "undefined") return;
    var existing = this.loadPersonalPreference();
    var aggregated = PlaystyleFeatures.aggregate(recent20);

    if (!existing) {
      aggregated.meta.updatedAt = new Date().toISOString();
      aggregated.meta.gameCount = recent20.length;
      this._writeJSON("local/personal_preference.json", aggregated);
      return;
    }

    // 融合：现有特征 80% + 新聚合特征 20%（渐进更新）
    var alpha = 0.2;
    var fused = PlaystyleFeatures.aggregate([]);
    fused.meta = {
      updatedAt: new Date().toISOString(),
      gameCount: Math.min((existing.meta.gameCount || 0) + recent20.length, 500),
      avgPlacement: (existing.meta.avgPlacement || 0) * (1 - alpha) + (aggregated.meta.avgPlacement || 0) * alpha,
      top4Rate: (existing.meta.top4Rate || 0) * (1 - alpha) + (aggregated.meta.top4Rate || 0) * alpha,
    };

    // 数值类特征加权融合
    var numKeys = ["aggressivenessScore", "synergyScore", "flexibilityScore", "goldEfficiency", "sellRate", "refreshRate"];
    for (var k = 0; k < numKeys.length; k++) {
      var key = numKeys[k];
      fused[key] = (existing[key] || 0) * (1 - alpha) + (aggregated[key] || 0) * alpha;
    }

    // 种族/机制偏好：累加（新数据覆盖旧数据衰减）
    for (var race in aggregated.racePreference) {
      existing.racePreference[race] = (existing.racePreference[race] || 0) * (1 - alpha) + aggregated.racePreference[race] * alpha;
    }
    for (var mech in aggregated.mechanicPreference) {
      existing.mechanicPreference[mech] = (existing.mechanicPreference[mech] || 0) * (1 - alpha) + aggregated.mechanicPreference[mech] * alpha;
    }
    fused.racePreference = existing.racePreference;
    fused.mechanicPreference = existing.mechanicPreference;
    fused.tierDistribution = existing.tierDistribution;
    fused.levelingCurve = aggregated.levelingCurve; // 直接用最新的曲线

    this._writeJSON("local/personal_preference.json", fused);
  };

  FeatureStore.prototype.loadPersonalPreference = function() {
    return this._readJSON("local/personal_preference.json");
  };

  // ═══════════════════════════════════════════════════════════
  // 上分特征 — 版本化管理
  // ═══════════════════════════════════════════════════════════

  FeatureStore.prototype.saveRankedCurrent = function(feature) {
    feature.meta = feature.meta || {};
    feature.meta.updatedAt = new Date().toISOString();
    this._writeJSON("ranked/current.json", feature);
  };

  FeatureStore.prototype.loadRankedCurrent = function() {
    return this._readJSON("ranked/current.json");
  };

  FeatureStore.prototype.saveRankedBaseline = function(feature) {
    if (!this._fileExists("ranked/baseline.json")) {
      feature.meta = feature.meta || {};
      feature.meta.updatedAt = new Date().toISOString();
      feature.meta.isBaseline = true;
      this._writeJSON("ranked/baseline.json", feature);
    }
  };

  FeatureStore.prototype.loadRankedBaseline = function() {
    return this._readJSON("ranked/baseline.json");
  };

  /** 将 current.json 归档到 history/，生成新版本号 */
  FeatureStore.prototype.archiveRankedVersion = function() {
    var current = this.loadRankedCurrent();
    if (!current) return null;

    // 计算版本号
    var existingVersions = this.listRankedHistory();
    var versionNum = existingVersions.length + 1;
    var versionStr = "v" + String(versionNum).padStart(3, "0");
    var filename = versionStr + "_" + new Date().toISOString().replace(/[:.]/g, "").substring(0, 15) + ".json";

    this._writeJSON("ranked/history/" + filename, current);
    return versionStr;
  };

  FeatureStore.prototype.listRankedHistory = function() {
    var dir = _path.join(this._base, "ranked", "history");
    if (!_fs.existsSync(dir)) return [];
    return _fs.readdirSync(dir).filter(function(f) { return f.endsWith(".json"); }).sort();
  };

  FeatureStore.prototype.loadRankedVersion = function(versionStr) {
    var dir = _path.join(this._base, "ranked", "history");
    var files = _fs.readdirSync(dir).filter(function(f) { return f.startsWith(versionStr); }).sort();
    if (files.length === 0) return null;
    return JSON.parse(_fs.readFileSync(_path.join(dir, files[0]), "utf-8"));
  };

  /** 回滚到指定历史版本（写入 current.json） */
  FeatureStore.prototype.rollbackTo = function(versionStr) {
    var feature = this.loadRankedVersion(versionStr);
    if (!feature) return false;
    feature.meta = feature.meta || {};
    feature.meta.rollbackFrom = versionStr;
    feature.meta.rollbackAt = new Date().toISOString();
    this.saveRankedCurrent(feature);
    return true;
  };

  // ═══════════════════════════════════════════════════════════
  // 云端数据缓存
  // ═══════════════════════════════════════════════════════════

  FeatureStore.prototype.saveRemoteCache = function(segKey, data) {
    this._writeJSON("remote/" + segKey + ".json", data);
  };

  FeatureStore.prototype.loadRemoteCache = function(segKey) {
    return this._readJSON("remote/" + segKey + ".json");
  };

  FeatureStore.prototype.saveRemoteMeta = function(meta) {
    this._writeJSON("remote/meta.json", meta);
  };

  FeatureStore.prototype.loadRemoteMeta = function() {
    return this._readJSON("remote/meta.json");
  };

  // ═══════════════════════════════════════════════════════════
  // 便利方法
  // ═══════════════════════════════════════════════════════════

  /** 获取当前活跃特征（根据模式） */
  FeatureStore.prototype.getActiveFeature = function(mode) {
    if (mode === "ranked") {
      return this.loadRankedCurrent() || this.loadPersonalPreference();
    }
    // 默认 personal
    return this.loadPersonalPreference() || this.getRecentAggregated(20);
  };

  return FeatureStore;
})();
