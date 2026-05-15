"use strict";

// ═══════════════════════════════════════════════════════════
// FeatureFusion — 双轨特征融合算法
// ═══════════════════════════════════════════════════════════
//
// 两种模式:
//
//   MODE_PERSONAL (个人喜好):
//     - 仅用本地最近20局数据
//     - 提取玩家当前偏好：种族/机制/升本节奏
//     - 不下云，不上传，纯本地
//
//   MODE_RANKED (上分模式):
//     - 融合用户数据 + 云端高分段(9000+)特征
//     - 用户数据权重 = 30%（随上传数据量增加可调）
//     - 高分段数据权重 = 70%
//     - 融合后经过模拟测试验证，通过才部署
//
// 权重公式:
//   finalFeature = userFeature * userWeight + highMmrFeature * (1 - userWeight)
//   userWeight = 0.3 (基础) 或根据用户数据量动态调整

var FeatureFusion = {

  MODE_PERSONAL: "personal",
  MODE_RANKED: "ranked",

  // 默认融合权重
  DEFAULT_USER_WEIGHT: 0.3,
  MIN_USER_WEIGHT: 0.1,
  MAX_USER_WEIGHT: 0.5,

  /**
   * 提取个人喜好特征（仅本地最近20局）。
   * @param {FeatureStore} store
   * @returns {object} 聚合后的特征向量
   */
  extractPersonal: function(store) {
    var recent = store.loadRecent20();
    if (recent.length === 0) {
      // 回退到长期个人喜好
      var pref = store.loadPersonalPreference();
      if (pref) return pref;
      return (typeof PlaystyleFeatures !== "undefined") ? PlaystyleFeatures.createTemplate({ mode: "personal", gameCount: 0 }) : {};
    }
    if (typeof PlaystyleFeatures === "undefined") return recent;
    var agg = PlaystyleFeatures.aggregate(recent);
    agg.meta.mode = "personal";
    agg.meta.gameCount = recent.length;
    agg.meta.generatedAt = new Date().toISOString();
    return agg;
  },

  /**
   * 提取上分特征（用户数据 + 云端高分段融合）。
   * @param {FeatureStore} store
   * @param {object} [highMmrFeature] — 云端拉取的高分段特征（可选，不传则用本地缓存）
   * @returns {object} 融合后的特征向量
   */
  extractRanked: function(store, highMmrFeature) {
    // 1. 获取用户特征（最近20局聚合）
    var userFeature = this.extractPersonal(store);
    if (!userFeature) return null;

    // 2. 获取高分段特征
    if (!highMmrFeature) {
      highMmrFeature = store.loadRemoteCache("tier_9000_plus");
    }

    // 3. 如果无云端数据，纯用户特征
    if (!highMmrFeature || !highMmrFeature.brackets || !highMmrFeature.brackets.tier_9000_plus) {
      userFeature.meta.mode = "ranked_fallback";
      userFeature.meta.warning = "无云端高分段数据，使用纯用户特征";
      return userFeature;
    }

    var highData = highMmrFeature.brackets.tier_9000_plus;

    // 4. 融合
    var userWeight = this._calcUserWeight(store);
    var fused = this._fuse(userFeature, highData, userWeight);

    fused.meta = {
      mode: "ranked",
      userWeight: userWeight,
      userGameCount: userFeature.meta ? userFeature.meta.gameCount : 0,
      highMmrGameCount: highData.totalGames || 0,
      generatedAt: new Date().toISOString(),
    };

    return fused;
  },

  /**
   * 从 universal_features.json 格式的高分段数据融合。
   * @param {object} userFeature — PlaystyleFeatures 格式
   * @param {object} highMmrBracket — universal_features.json 中 tier_9000_plus bracket
   * @param {number} userWeight — 用户特征权重 (0.0-1.0)
   */
  _fuse: function(userFeature, highMmrBracket, userWeight) {
    var hw = 1 - userWeight;
    var template = typeof PlaystyleFeatures !== "undefined"
      ? PlaystyleFeatures.createTemplate({ fused: true })
      : {};

    // ── 数值类特征加权融合 ──
    var numKeys = ["aggressivenessScore", "synergyScore", "flexibilityScore", "goldEfficiency", "sellRate", "refreshRate"];
    for (var k = 0; k < numKeys.length; k++) {
      var key = numKeys[k];
      var userVal = (userFeature[key] !== undefined) ? userFeature[key] : 0;
      // 高分段特征中同名字段直接取（如果有的话）
      var highVal = (highMmrBracket[key] !== undefined) ? highMmrBracket[key] : userVal;
      template[key] = userVal * userWeight + highVal * hw;
    }

    // ── 种族偏好：合并用户偏好到模板 ──
    template.racePreference = {};
    var userRaces = userFeature.racePreference || {};
    for (var race in userRaces) {
      template.racePreference[race] = userRaces[race] * userWeight;
    }

    // ── 机制偏好 ──
    template.mechanicPreference = {};
    var userMechs = userFeature.mechanicPreference || {};
    for (var mech in userMechs) {
      template.mechanicPreference[mech] = userMechs[mech] * userWeight;
    }

    // ── 升本曲线：用户曲线为主，高分段数据校正 ──
    template.levelingCurve = {};
    var uc = userFeature.levelingCurve || {};
    template.levelingCurve.turn2LevelRate = uc.turn2LevelRate || 0;
    template.levelingCurve.turn3LevelRate = uc.turn3LevelRate || 0;
    template.levelingCurve.turn5LevelRate = uc.turn5LevelRate || 0;
    template.levelingCurve.curveType = uc.curveType || "standard";

    // ── 英雄推荐：高分段Top英雄优先 ──
    template.heroPool = {};
    if (highMmrBracket.topHeroes) {
      for (var i = 0; i < highMmrBracket.topHeroes.length; i++) {
        var h = highMmrBracket.topHeroes[i];
        if (h.stats && h.stats.games >= 3) {
          template.heroPool[h.heroId] = {
            avgPlacement: h.stats.avgPlacement || 0,
            games: h.stats.games,
            winRate: h.stats.winRate || 0,
            source: "high_mmr",
          };
        }
      }
    }
    // 用户自己的高表现英雄也加入
    var userHeroes = userFeature.topHeroes || [];
    for (var j = 0; j < userHeroes.length; j++) {
      var uh = userHeroes[j];
      if (!template.heroPool[uh.heroId]) {
        template.heroPool[uh.heroId] = { avgPlacement: uh.avgPlacement || 0, games: uh.games || 0, source: "user" };
      }
    }

    // ── 最高胜率英雄排名 ──
    if (highMmrBracket.topHeroes) {
      template.topHeroes = highMmrBracket.topHeroes.slice(0, 10).map(function(e) {
        return { heroId: e.heroId, avgPlacement: e.stats.avgPlacement, games: e.stats.games, winRate: e.stats.winRate };
      });
    }

    return template;
  },

  /** 根据用户数据量动态计算权重 */
  _calcUserWeight: function(store) {
    var recent = store.loadRecent20();
    var gameCount = recent.length;
    // 不满20局：降低用户权重
    if (gameCount < 5) return this.MIN_USER_WEIGHT;
    if (gameCount < 10) return 0.2;
    if (gameCount < 20) return 0.25;
    return this.DEFAULT_USER_WEIGHT;
  },

  /**
   * 对比两个特征向量，判断 newFeature 是否优于 currentFeature。
   * @returns {{ isBetter: boolean, scores: object }}
   */
  evaluateUpgrade: function(currentFeature, newFeature) {
    var cur = currentFeature || {};
    var neu = newFeature || {};

    var curMeta = cur.meta || {};
    var neuMeta = neu.meta || {};

    var scores = {
      placementDelta: (curMeta.avgPlacement || 5) - (neuMeta.avgPlacement || 5),
      top4Delta: (neuMeta.top4Rate || 0) - (curMeta.top4Rate || 0),
      winDelta: (neuMeta.winRate || 0) - (curMeta.winRate || 0),
      // 综合评分（均排下降 + 前四率上升 = 更好）
    };

    // 判断标准：均排下降 或 前四率上升超过1%
    var isBetter = scores.placementDelta > 0.05 || scores.top4Delta > 0.01;

    return { isBetter: isBetter, scores: scores };
  },
};
