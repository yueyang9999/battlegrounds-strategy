"use strict";

// ═══════════════════════════════════════════════════════════
// ProfileEngine — 个性化特征向量推荐
// ═══════════════════════════════════════════════════════════
//
// 基于玩家历史对局记录构建画像，余弦相似度匹配候选卡牌。
//
// 画像维度:
//   preferredRaces   — { "野兽": 12, "机械": 8, ... }
//   preferredKeywords — { "DEATHRATTLE": 15, "DIVINE_SHIELD": 9, ... }
//   preferredTags     — { "deathrattle": 15, "shield": 9, ... }
//   preferredTiers    — { 3: 20, 4: 15, ... }  最近常拿的星级

var ProfileEngine = class ProfileEngine {

  /**
   * @param {object} userDataStore — UserDataStore 实例
   * @param {CardDatabase} cardDb — CardDatabase 实例
   */
  constructor(userDataStore, cardDb) {
    this.store = userDataStore;
    this.db = cardDb;
    this.profile = null;
    this._decayFactor = 0.9; // 每局衰减系数，越近的局权重越高
  }

  // ── 画像构建 ──

  /**
   * 从游戏记录构建/刷新玩家画像。
   * 权重按时间衰减，最近的对局影响更大。
   */
  buildProfile() {
    var records = [];
    if (this.store && typeof this.store.getGameRecords === "function") {
      records = this.store.getGameRecords({ limit: 100 });
    }

    var profile = {
      preferredRaces: Object.create(null),
      preferredKeywords: Object.create(null),
      preferredTags: Object.create(null),
      preferredTiers: Object.create(null),
      totalGames: 0,
      recentHeroes: Object.create(null),
      avgPlacement: 0,
    };

    var totalPlacement = 0;
    var weight = 1.0;

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var cards = rec.tags || rec.cards || [];

      // 从 tags 解析特征向量
      // tags 格式: ["beast:3", "deathrattle:5", ...]
      for (var j = 0; j < cards.length; j++) {
        var entry = cards[j];
        if (typeof entry === "string") {
          var parts = entry.split(":");
          if (parts.length === 2) {
            var key = parts[0];
            var count = parseInt(parts[1], 10) || 1;
            profile.preferredTags[key] = (profile.preferredTags[key] || 0) + count * weight;
          }
        }
      }

      // 种族统计 — 从 kw 或 race 字段
      var raceEntries = rec.race || [];
      for (var r = 0; r < raceEntries.length; r++) {
        var re = raceEntries[r];
        if (typeof re === "string") {
          var rParts = re.split(":");
          if (rParts.length === 2) {
            profile.preferredRaces[rParts[0]] = (profile.preferredRaces[rParts[0]] || 0) + parseInt(rParts[1], 10) * weight;
          }
        }
      }

      // 关键词 — 从 kw 字段
      var kwEntries = rec.kw || [];
      for (var k = 0; k < kwEntries.length; k++) {
        var ke = kwEntries[k];
        if (typeof ke === "string") {
          var kParts = ke.split(":");
          if (kParts.length === 2) {
            profile.preferredKeywords[kParts[0]] = (profile.preferredKeywords[kParts[0]] || 0) + parseInt(kParts[1], 10) * weight;
          }
        }
      }

      // 英雄偏好
      if (rec.heroCardId) {
        profile.recentHeroes[rec.heroCardId] = (profile.recentHeroes[rec.heroCardId] || 0) + weight;
      }

      if (rec.finalPlacement) {
        totalPlacement += rec.finalPlacement;
      }

      profile.totalGames++;
      weight *= this._decayFactor;
    }

    if (profile.totalGames > 0) {
      profile.avgPlacement = totalPlacement / profile.totalGames;
    }

    this.profile = profile;
    return profile;
  }

  /**
   * 加载 extract_player_profile.js 产出的画像 JSON 数据。
   * 将其转换为 ProfileEngine 内部画像格式。
   * @param {object} data — player_profile.json 的内容
   */
  loadExtractedProfile(data) {
    var profile = {
      preferredRaces: Object.create(null),
      preferredKeywords: Object.create(null),
      preferredTags: Object.create(null),
      preferredTiers: Object.create(null),
      totalGames: data.totalGames || 0,
      recentHeroes: Object.create(null),
      avgPlacement: 0,
    };

    // 种族: { "野兽": { count, avgPlacement }, ... }
    var raceMap = data.raceStats || {};
    var raceKeys = Object.keys(raceMap);
    for (var i = 0; i < raceKeys.length; i++) {
      profile.preferredRaces[raceKeys[i]] = raceMap[raceKeys[i]].count || 0;
    }

    // 关键词: { "DEATHRATTLE": { count, avgPlacement }, ... }
    var kwMap = data.mechanicStats || {};
    var kwKeys = Object.keys(kwMap);
    for (var j = 0; j < kwKeys.length; j++) {
      profile.preferredKeywords[kwKeys[j]] = kwMap[kwKeys[j]].count || 0;
    }

    // 标签: { "shield": { count, avgPlacement }, ... }
    var tagMap = data.tagStats || {};
    var tagKeys = Object.keys(tagMap);
    for (var k = 0; k < tagKeys.length; k++) {
      profile.preferredTags[tagKeys[k]] = tagMap[tagKeys[k]].count || 0;
    }

    // 星级: { "1": { count, avgPlacement }, ... }
    var tierMap = data.tierStats || {};
    var tierKeys = Object.keys(tierMap);
    for (var t = 0; t < tierKeys.length; t++) {
      profile.preferredTiers[tierKeys[t]] = tierMap[tierKeys[t]].count || 0;
    }

    // 英雄
    var heroMap = data.heroStats || {};
    var heroKeys = Object.keys(heroMap);
    for (var h = 0; h < heroKeys.length; h++) {
      profile.recentHeroes[heroKeys[h]] = heroMap[heroKeys[h]].games || 0;
    }

    // 平均排名
    var totalRank = 0;
    for (var hk = 0; hk < heroKeys.length; hk++) {
      totalRank += (heroMap[heroKeys[hk]].avgPlacement || 0) * (heroMap[heroKeys[hk]].games || 0);
    }
    profile.avgPlacement = profile.totalGames > 0 ? totalRank / profile.totalGames : 0;

    this.profile = profile;
    return profile;
  }

  /**
   * 是否有足够的游戏记录来做个性化推荐。
   * @returns {boolean}
   */
  hasEnoughData() {
    return this.profile && this.profile.totalGames >= 3;
  }

  // ── 相似度计算 ──

  /**
   * 计算卡牌与玩家画像的余弦相似度。
   * @param {object} card — CardDatabase 中的卡牌对象
   * @returns {number} 0-1
   */
  cardSimilarity(card) {
    if (!this.profile || this.profile.totalGames === 0) return 0;

    var cardVec = this._cardToVector(card);
    var profileVec = this._profileVector();

    return this._cosineSimilarity(cardVec, profileVec);
  }

  /**
   * 将卡牌转为特征向量。
   */
  _cardToVector(card) {
    var vec = Object.create(null);

    // 种族
    var races = card.minion_types_cn || [];
    for (var i = 0; i < races.length; i++) {
      vec["r_" + races[i]] = 1;
    }

    // mechanics / keywords
    var mechs = card.mechanics || [];
    for (var m = 0; m < mechs.length; m++) {
      vec["k_" + mechs[m]] = 1;
    }

    // tags (使用 CardDatabase 的推断逻辑 — 简单复现)
    var tags = this._cardTags(card);
    for (var t = 0; t < tags.length; t++) {
      vec["t_" + tags[t]] = 1;
    }

    // 星级
    if (card.tier) {
      vec["tier_" + card.tier] = 1;
    }

    // 维度分数
    var dims = card._dimensions;
    if (dims) {
      vec["dim_economy"] = (dims.economy || 0) / 10;
      vec["dim_tempo"] = (dims.tempo || 0) / 10;
      vec["dim_synergy"] = (dims.synergy || 0) / 10;
    }

    return vec;
  }

  _cardTags(card) {
    var tags = [];
    var mechs = card.mechanics || [];
    var text = (card.text_cn || "").toLowerCase();

    for (var i = 0; i < mechs.length; i++) {
      var m = mechs[i];
      if (m === "DIVINE_SHIELD") tags.push("shield");
      else if (m === "DEATHRATTLE") tags.push("deathrattle");
      else if (m === "WINDFURY") tags.push("windfury");
      else if (m === "REBORN") tags.push("reborn");
      else if (m === "VENOMOUS" || m === "POISONOUS") tags.push("venomous");
      else if (m === "TAUNT") tags.push("taunt");
      else if (m === "BATTLECRY") tags.push("battlecry");
      else if (m === "AVENGE") tags.push("avenge");
      else if (m === "END_OF_TURN_TRIGGER") tags.push("end_of_turn");
      else if (m === "MAGNETIC") tags.push("magnetic");
    }

    if (/铸币|金币|发现|discover/i.test(text)) tags.push("economy");
    if (/出售|sell/i.test(text)) tags.push("sell_synergy");

    return tags;
  }

  /**
   * 获取玩家画像向量（归一化后的权重）。
   */
  _profileVector() {
    var vec = Object.create(null);
    var p = this.profile;

    // 种族 → "r_xxx"
    var races = Object.keys(p.preferredRaces);
    for (var i = 0; i < races.length; i++) {
      vec["r_" + races[i]] = p.preferredRaces[races[i]];
    }

    // 关键词 → "k_xxx"
    var kws = Object.keys(p.preferredKeywords);
    for (var k = 0; k < kws.length; k++) {
      vec["k_" + kws[k]] = p.preferredKeywords[kws[k]];
    }

    // 标签 → "t_xxx"
    var tags = Object.keys(p.preferredTags);
    for (var t = 0; t < tags.length; t++) {
      vec["t_" + tags[t]] = p.preferredTags[tags[t]];
    }

    return vec;
  }

  /**
   * 余弦相似度。
   */
  _cosineSimilarity(vecA, vecB) {
    var dot = 0;
    var normA = 0;
    var normB = 0;

    // 计算点积和 A 的范数
    var keysA = Object.keys(vecA);
    for (var i = 0; i < keysA.length; i++) {
      var k = keysA[i];
      var va = vecA[k] || 0;
      var vb = vecB[k] || 0;
      dot += va * vb;
      normA += va * va;
    }

    // B 的范数（含不在 A 中的键）
    var keysB = Object.keys(vecB);
    for (var j = 0; j < keysB.length; j++) {
      normB += (vecB[keysB[j]] || 0) * (vecB[keysB[j]] || 0);
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ── 推荐 ──

  /**
   * 从候选列表推荐 top N 张卡。
   * @param {object[]} candidates — 候选卡牌列表
   * @param {number} [topN=5]
   * @returns {object[]} — 附带 _profileSim 字段的卡牌列表
   */
  recommend(candidates, topN) {
    if (!this.hasEnoughData()) return candidates.slice(0, topN || 5);

    topN = topN || 5;
    var scored = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var sim = this.cardSimilarity(c);
      var copy = Object.assign({}, c);
      copy._profileSim = sim;
      scored.push(copy);
    }

    scored.sort(function(a, b) {
      var sA = (a._profileSim || 0);
      var sB = (b._profileSim || 0);
      return sB - sA;
    });

    return scored.slice(0, topN);
  }

  /**
   * 在现有评分上叠加个性化加权。
   * 用于 MinionPickModule 等选牌场景。
   *
   * @param {object} card — 卡牌对象
   * @param {number} baseScore — 基础评分 (0-10)
   * @returns {number} 调整后的评分
   */
  boostScore(card, baseScore) {
    if (!this.hasEnoughData()) return baseScore;
    var sim = this.cardSimilarity(card);
    // 个性化加权: 相似度 0-1, 最多加成 2 分
    return baseScore + sim * 2;
  }

  // ── 玩家类型推断 ──

  /**
   * 推断玩家风格类型。
   * @returns {string} "aggressive" | "tempo" | "synergy" | "flexible"
   */
  inferPlaystyle() {
    if (!this.profile || this.profile.totalGames < 3) return "flexible";

    var p = this.profile;
    var tierWeights = p.preferredTiers || {};

    // 倾向高星 → synergy 型（喜欢刷高本核心）
    // 倾向低星 → tempo 型（喜欢前期战力）
    var highTier = (tierWeights["5"] || 0) + (tierWeights["6"] || 0);
    var lowTier = (tierWeights["1"] || 0) + (tierWeights["2"] || 0);

    if (highTier > lowTier * 2) return "synergy";
    if (lowTier > highTier * 2) return "tempo";
    if (p.avgPlacement && p.avgPlacement <= 3.5) return "aggressive";
    return "flexible";
  }
};
