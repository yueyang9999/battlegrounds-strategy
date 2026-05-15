"use strict";

// ═══════════════════════════════════════════════════════════
// Recorder — 精简对局记录器
// ═══════════════════════════════════════════════════════════
//
// 追踪整局游戏的卡牌选取，结束时生成 CompactRecord JSON。
//
// CompactRecord 格式 (精简，适合上传 GitHub):
// {
//   v: 1,             // 格式版本
//   seg: 6000,        // 玩家MMR分段中值
//   hero: "TB_...",   // 英雄ID
//   rank: 3,          // 最终排名 1-8
//   cards: [...],     // 本局获取的随从ID (去重，最多20)
//   tags: [...],      // "tagName:count"
//   kw: [...],        // "keyword:count"
//   race: [...],      // "race:count"
// }
//
// 总大小约 1-3KB，非常适合 GitHub 静态存储。

var Recorder = class Recorder {

  constructor(cardDb) {
    this.db = cardDb;
    this.reset();
  }

  reset() {
    this.pickedCards = [];        // { cardId, name_cn, tier, race, mechanics }
    this.tagCounts = Object.create(null);
    this.keywordCounts = Object.create(null);
    this.raceCounts = Object.create(null);
    this.heroCardId = "";
    this.heroName = "";
    this.mmr = 0;
    this.gameVersion = "";
    this._started = false;
  }

  /**
   * 开始新对局。
   */
  startGame(heroCardId, heroName, mmr, gameVersion) {
    this.reset();
    this.heroCardId = heroCardId || "";
    this.heroName = heroName || "";
    this.mmr = mmr || 6000;
    this.gameVersion = gameVersion || "";
    this._started = true;
  }

  /**
   * 记录一次卡牌选取（三连/发现/购买）。
   */
  recordPick(cardId) {
    if (!this._started) return;

    var card = this.db ? this.db.getCard(cardId) : null;
    if (!card) {
      this.pickedCards.push({ cardId: cardId });
      return;
    }

    if (card.card_type !== "minion") return;

    this.pickedCards.push({
      cardId: cardId,
      name_cn: card.name_cn || "",
      tier: card.tier || 0,
      race: (card.minion_types_cn || []).slice(),
      mechanics: (card.mechanics || []).slice(),
    });

    var races = card.minion_types_cn || [];
    for (var i = 0; i < races.length; i++) {
      var r = races[i];
      this.raceCounts[r] = (this.raceCounts[r] || 0) + 1;
    }

    var mechs = card.mechanics || [];
    for (var m = 0; m < mechs.length; m++) {
      var kw = mechs[m];
      this.keywordCounts[kw] = (this.keywordCounts[kw] || 0) + 1;
    }

    var tags = this._inferTagsFromCard(card);
    for (var t = 0; t < tags.length; t++) {
      this.tagCounts[tags[t]] = (this.tagCounts[tags[t]] || 0) + 1;
    }
  }

  /**
   * 结束对局，生成 CompactRecord。
   */
  endGame(finalRank) {
    this._started = false;

    var uniqueCards = [];
    var seen = Object.create(null);
    for (var i = 0; i < this.pickedCards.length; i++) {
      var pc = this.pickedCards[i];
      if (!seen[pc.cardId]) {
        seen[pc.cardId] = true;
        uniqueCards.push(pc.cardId);
      }
    }

    var segBucket;
    if (this.mmr <= 6000) segBucket = "tier_0_6000";
    else if (this.mmr <= 8999) segBucket = "tier_6001_8999";
    else segBucket = "tier_9000_plus";

    var record = {
      v: 1,
      seg: this.mmr,
      seg_bucket: segBucket,
      hero: this.heroCardId,
      rank: finalRank || 8,
      cards: uniqueCards.slice(0, 20),
      tags: this._entriesToArray(this.tagCounts),
      kw: this._entriesToArray(this.keywordCounts),
      race: this._entriesToArray(this.raceCounts),
      ts: new Date().toISOString().slice(0, 10),
    };

    return record;
  }

  // ── 辅助 ──

  _entriesToArray(counts) {
    var arr = [];
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = counts[k];
      if (v > 0) arr.push(k + ":" + v);
    }
    return arr;
  }

  _inferTagsFromCard(card) {
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
      else if (m === "DISCOVER") tags.push("discover");
    }

    if (/铸币|金币|获得.*枚|gain.*coin/i.test(text)) tags.push("economy");
    if (/出售|sell/i.test(text)) tags.push("sell_synergy");
    if (/圣盾|divine shield/i.test(text) && tags.indexOf("shield") === -1) tags.push("shield_synergy");

    return tags;
  }

  /**
   * 将 CompactRecord 转换为玩法特征向量（供 FeatureStore 滑动窗口）。
   * @param {object} record — CompactRecord
   * @param {object} extra — { turnCount, boardTier }
   * @returns {object} 兼容 PlaystyleFeatures 格式
   */
  toPlaystyleFeature(record, extra) {
    extra = extra || {};
    var f = {
      meta: {
        heroCardId: record.hero,
        placement: record.rank,
        mmr: record.seg,
        finalBoardSize: (record.cards || []).length,
        finalTier: extra.boardTier || 1,
      },
      levelingCurve: { turn2LevelRate: 0, turn3LevelRate: 0, turn5LevelRate: 0, avgTierByTurn: {}, curveType: "standard" },
      racePreference: {},
      mechanicPreference: {},
      tagPreference: {},
      tierDistribution: {},
      compAlignment: {},
      heroPool: {},
      goldEfficiency: 0,
      aggressivenessScore: 0,
      synergyScore: 0,
      flexibilityScore: 0,
      sellRate: 0,
      refreshRate: 0,
      topHeroes: [],
    };
    var raceEntries = record.race || [];
    for (var i = 0; i < raceEntries.length; i++) {
      var parts = raceEntries[i].split(":");
      if (parts.length === 2) f.racePreference[parts[0]] = parseInt(parts[1], 10);
    }
    var kwEntries = record.kw || [];
    for (var j = 0; j < kwEntries.length; j++) {
      var kwParts = kwEntries[j].split(":");
      if (kwParts.length === 2) f.mechanicPreference[kwParts[0]] = parseInt(kwParts[1], 10);
    }
    var tagEntries = record.tags || [];
    for (var t = 0; t < tagEntries.length; t++) {
      var tagParts = tagEntries[t].split(":");
      if (tagParts.length === 2) f.tagPreference[tagParts[0]] = parseInt(tagParts[1], 10);
    }
    f.aggressivenessScore = record.rank <= 3 ? 0.7 : record.rank <= 5 ? 0.5 : 0.3;
    var totalRace = 0, maxRace = 0;
    for (var r in f.racePreference) { totalRace += f.racePreference[r]; if (f.racePreference[r] > maxRace) maxRace = f.racePreference[r]; }
    f.synergyScore = totalRace > 0 ? maxRace / totalRace : 0;
    f.flexibilityScore = Math.min(1, Object.keys(f.racePreference).length / 5) * 0.5 + Math.min(1, Object.keys(f.mechanicPreference).length / 10) * 0.5;
    return f;
  }

  /**
   * 将 CompactRecord 保存到本地文件。
   */
  saveToFile(record, outputDir) {
    if (typeof require === "undefined") return false;
    try {
      var fs = require("fs");
      var path = require("path");
      var dir = path.join(outputDir, "game_records");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      var filename = "rec_" + record.ts + "_" + (record.hero || "unknown") + ".json";
      var filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, JSON.stringify(record, null, 2), "utf-8");
      return filepath;
    } catch (e) {
      console.error("[Recorder] 保存失败:", e.message);
      return false;
    }
  }
};
