"use strict";

// ═══════════════════════════════════════════════════════════
// 从 bg_player.db 提取个人历史数据 → 玩家画像 JSON
//
// 用法: node scripts/extract_player_profile.js
// 输出: data/player_profile.json  (可直接被 ProfileEngine 使用)
// ═══════════════════════════════════════════════════════════

var fs = require("fs");
var path = require("path");

var BASE = path.join(__dirname, "..");
var PROJECT_ROOT = path.join(__dirname, "..", "..");

// ── 加载卡牌数据 ──
var cardsArr = JSON.parse(fs.readFileSync(path.join(BASE, "data", "cards.json"), "utf-8"));
var cardsById = {};
for (var i = 0; i < cardsArr.length; i++) {
  cardsById[cardsArr[i].str_id] = cardsArr[i];
}

// ── 解析 bg_player.db ──
function parseRecords(rawText) {
  var lines = rawText.split("\n");
  var records = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    // 格式: id|hero_card_id|placement|starting_comp|final_board|turn_actions|mmr_change|played_at
    var parts = line.split("|");
    if (parts.length < 5) continue;

    var placement = parseInt(parts[2], 10);
    if (isNaN(placement) || placement < 1 || placement > 8) continue;

    var heroCardId = parts[1] || "";
    var finalBoardRaw = parts[4] || "[]";
    var playedAt = parts[7] || "";

    var boardCards = [];
    try {
      var parsed = JSON.parse(finalBoardRaw);
      if (Array.isArray(parsed)) boardCards = parsed;
    } catch (e) {
      continue;
    }

    records.push({
      heroCardId: heroCardId,
      placement: placement,
      boardCards: boardCards,
      playedAt: playedAt,
    });
  }
  return records;
}

// ── 主函数 ──
function main(opts) {
  opts = opts || {};
  var fromDate = opts.from || null;
  var toDate = opts.to || null;
  var outPath = opts.output || path.join(BASE, "data", "player_profile.json");

  console.log("读取预导出的 DB dump 文件...");
  var dumpPath = path.join(BASE, "data", "_db_dump.txt");

  var dump;
  try {
    dump = fs.readFileSync(dumpPath, "utf-8");
  } catch (e) {
    console.error("无法读取 dump 文件:", e.message);
    console.error("请先运行: python scripts/_dump_db.py ../bg_player.db > data/_db_dump.txt");
    process.exit(1);
  }

  var records = parseRecords(dump);
  console.log("解析到 " + records.length + " 条有效对局记录");
  console.log("  (其中 " + records.filter(function(r) { return r.boardCards.length > 0; }).length + " 条有 final_board 数据)");

  // ── 加载 Firestone 补充数据 ──
  var firestoneGames = [];
  try {
    firestoneGames = JSON.parse(fs.readFileSync(path.join(BASE, "data", "_firestone_games.json"), "utf-8"));
    console.log("加载 Firestone 补充数据: " + firestoneGames.length + " 条对局");
  } catch (e) {
    console.log("无 Firestone 补充数据 (正常)");
  }

  // ── 聚合统计 ──
  var stats = {
    totalGames: records.length,
    firestoneGames: firestoneGames.length,
    totalGamesCombined: records.length + firestoneGames.length,
    generatedAt: new Date().toISOString(),

    // 英雄统计
    heroStats: {},     // { heroCardId: { games, avgPlacement, top4Rate, winRate } }

    // 卡牌统计
    cardStats: {},     // { cardId: { pickCount, avgPlacement, goldenCount } }

    // 种族偏好
    raceStats: {},     // { race: { count, avgPlacement } }

    // 关键词/机制偏好
    mechanicStats: {}, // { mechanic: { count, avgPlacement } }

    // 标签偏好
    tagStats: {},      // { tag: { count, avgPlacement } }

    // 星级偏好
    tierStats: {},     // { tier: { count, avgPlacement } }

    // 分段统计（按排名分组）
    byPlacement: {
      top1: { cards: {}, races: {}, mechanics: {}, tags: {}, tiers: {} },
      top4: { cards: {}, races: {}, mechanics: {}, tags: {}, tiers: {} },
      bottom4: { cards: {}, races: {}, mechanics: {}, tags: {}, tiers: {} },
    },

    // 时间范围
    dateRange: { from: "", to: "" },

    // 连胜/连败模式
    recentForm: [],    // 最近20局排名序列

    // MMR 趋势（来自 Firestone 数据）
    mmrTrend: { latest: 0, peak: 0, history: [] },
  };

  // ── 规范化英雄 ID (去除 SKIN 后缀) ──
  function normalizeHero(heroId) {
    if (!heroId) return "";
    var skinIdx = heroId.indexOf("_SKIN_");
    if (skinIdx !== -1) return heroId.substring(0, skinIdx);
    // 处理 _SKIN_X, _SKIN_XX 等变体
    var skinMatch = heroId.match(/_SKIN_[A-Z0-9]+$/);
    if (skinMatch) return heroId.substring(0, skinMatch.index);
    return heroId;
  }

  // ── 逐条处理 ──
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];

    // 日期过滤
    if (fromDate && rec.playedAt && rec.playedAt < fromDate) continue;
    if (toDate && rec.playedAt && rec.playedAt > toDate) continue;

    var hero = rec.heroCardId;
    var rank = rec.placement;

    // 时间范围
    if (rec.playedAt && (!stats.dateRange.from || rec.playedAt < stats.dateRange.from)) {
      stats.dateRange.from = rec.playedAt;
    }
    if (rec.playedAt && rec.playedAt > stats.dateRange.to) {
      stats.dateRange.to = rec.playedAt;
    }

    // 英雄统计
    if (!stats.heroStats[hero]) {
      stats.heroStats[hero] = { games: 0, totalRank: 0, top4: 0, wins: 0, name_cn: "" };
    }
    var hs = stats.heroStats[hero];
    hs.games++;
    hs.totalRank += rank;
    if (rank <= 4) hs.top4++;
    if (rank === 1) hs.wins++;

    // 从 cards.json 查找英雄中文名
    if (!hs.name_cn && cardsById[hero]) {
      hs.name_cn = cardsById[hero].name_cn || "";
    }

    // final_board 卡牌统计
    var boardCardsSeen = {};
    for (var c = 0; c < rec.boardCards.length; c++) {
      var rawId = rec.boardCards[c];
      var isGolden = false;
      var cardId = rawId;
      if (rawId.endsWith("_G")) {
        isGolden = true;
        cardId = rawId.slice(0, -2);
      }

      if (boardCardsSeen[cardId]) continue;
      boardCardsSeen[cardId] = true;

      // 卡牌统计
      if (!stats.cardStats[cardId]) {
        stats.cardStats[cardId] = { pickCount: 0, totalRank: 0, goldenCount: 0, name_cn: "", tier: 0, races: [], mechanics: [] };
      }
      var cs = stats.cardStats[cardId];
      cs.pickCount++;
      cs.totalRank += rank;
      if (isGolden) cs.goldenCount++;

      var cardData = cardsById[cardId];
      if (cardData) {
        cs.name_cn = cardData.name_cn || cs.name_cn;
        cs.tier = cardData.tier || cs.tier;
        cs.races = cardData.minion_types_cn || [];
        cs.mechanics = cardData.mechanics || [];

        // 种族统计
        var tribes = cardData.minion_types_cn || [];
        for (var t = 0; t < tribes.length; t++) {
          var tribe = tribes[t];
          if (!stats.raceStats[tribe]) stats.raceStats[tribe] = { count: 0, totalRank: 0 };
          stats.raceStats[tribe].count++;
          stats.raceStats[tribe].totalRank += rank;
        }

        // 机制统计
        var mechs = cardData.mechanics || [];
        for (var m = 0; m < mechs.length; m++) {
          var mech = mechs[m];
          if (!stats.mechanicStats[mech]) stats.mechanicStats[mech] = { count: 0, totalRank: 0 };
          stats.mechanicStats[mech].count++;
          stats.mechanicStats[mech].totalRank += rank;
        }

        // 星级统计
        var tier = cardData.tier || 0;
        if (tier > 0) {
          var tierKey = String(tier);
          if (!stats.tierStats[tierKey]) stats.tierStats[tierKey] = { count: 0, totalRank: 0 };
          stats.tierStats[tierKey].count++;
          stats.tierStats[tierKey].totalRank += rank;
        }

        // 标签统计
        var tags = inferTags(cardData);
        for (var g = 0; g < tags.length; g++) {
          var tag = tags[g];
          if (!stats.tagStats[tag]) stats.tagStats[tag] = { count: 0, totalRank: 0 };
          stats.tagStats[tag].count++;
          stats.tagStats[tag].totalRank += rank;
        }
      }

      // 分区统计
      var bucket;
      if (rank === 1) bucket = stats.byPlacement.top1;
      else if (rank <= 4) bucket = stats.byPlacement.top4;
      else bucket = stats.byPlacement.bottom4;

      bucket.cards[cardId] = (bucket.cards[cardId] || 0) + 1;
      if (cardData) {
        var tribes2 = cardData.minion_types_cn || [];
        for (var tr = 0; tr < tribes2.length; tr++) {
          bucket.races[tribes2[tr]] = (bucket.races[tribes2[tr]] || 0) + 1;
        }
        var mechs2 = cardData.mechanics || [];
        for (var mk = 0; mk < mechs2.length; mk++) {
          bucket.mechanics[mechs2[mk]] = (bucket.mechanics[mechs2[mk]] || 0) + 1;
        }
        var tier2 = String(cardData.tier || 0);
        if (tier2 !== "0") bucket.tiers[tier2] = (bucket.tiers[tier2] || 0) + 1;
        var tags2 = inferTags(cardData);
        for (var tg = 0; tg < tags2.length; tg++) {
          bucket.tags[tags2[tg]] = (bucket.tags[tags2[tg]] || 0) + 1;
        }
      }
    }

    // 最近20局排名
    if (stats.recentForm.length < 20) {
      stats.recentForm.push(rank);
    }
  }

  // ── 计算平均值 ──
  // 英雄
  var heroKeys = Object.keys(stats.heroStats);
  for (var hk = 0; hk < heroKeys.length; hk++) {
    var h = stats.heroStats[heroKeys[hk]];
    h.avgPlacement = h.games > 0 ? (h.totalRank / h.games) : 0;
    h.top4Rate = h.games > 0 ? (h.top4 / h.games) : 0;
    h.winRate = h.games > 0 ? (h.wins / h.games) : 0;
    delete h.totalRank;
    delete h.top4;
    delete h.wins;
  }

  // ── 合并 Firestone 英雄数据 ──
  for (var fi = 0; fi < firestoneGames.length; fi++) {
    var fg = firestoneGames[fi];

    // 日期过滤
    if (fromDate && fg.date && fg.date < fromDate) continue;
    if (toDate && fg.date && fg.date > toDate) continue;

    var rawHero = fg.hero || "";
    var fHero = normalizeHero(rawHero);
    if (!fHero) continue;
    var fPlace = fg.placement;
    if (!fPlace || fPlace < 1 || fPlace > 8) continue;

    // 时间范围
    if (fg.date && (!stats.dateRange.from || fg.date < stats.dateRange.from)) {
      stats.dateRange.from = fg.date;
    }
    if (fg.date && fg.date > stats.dateRange.to) {
      stats.dateRange.to = fg.date;
    }

    // 英雄统计
    if (!stats.heroStats[fHero]) {
      stats.heroStats[fHero] = { games: 0, avgPlacement: 0, top4Rate: 0, winRate: 0, name_cn: "" };
    }
    var fhs = stats.heroStats[fHero];
    // 累加到已有统计（保留 totalRank/top4/wins 用于重新计算平均）
    if (!fhs._totalRank) {
      fhs._totalRank = fhs.avgPlacement * fhs.games;
      fhs._top4 = Math.round(fhs.top4Rate * fhs.games);
      fhs._wins = Math.round(fhs.winRate * fhs.games);
    }
    fhs._totalRank += fPlace;
    fhs._top4 += (fPlace <= 4 ? 1 : 0);
    fhs._wins += (fPlace === 1 ? 1 : 0);
    fhs.games++;

    // MMR 趋势
    if (fg.mmr && fg.mmr > 0) {
      if (stats.mmrTrend.latest === 0 || fg.date > stats.mmrTrend._latestDate) {
        stats.mmrTrend.latest = fg.mmr;
        stats.mmrTrend._latestDate = fg.date;
      }
      if (fg.mmr > stats.mmrTrend.peak) {
        stats.mmrTrend.peak = fg.mmr;
      }
      stats.mmrTrend.history.push({ date: fg.date, mmr: fg.mmr, placement: fPlace });
    }
  }

  // 重新计算合并后的英雄统计
  var heroKeys2 = Object.keys(stats.heroStats);
  for (var hk2 = 0; hk2 < heroKeys2.length; hk2++) {
    var h2 = stats.heroStats[heroKeys2[hk2]];
    if (h2._totalRank !== undefined) {
      h2.avgPlacement = h2.games > 0 ? (h2._totalRank / h2.games) : 0;
      h2.top4Rate = h2.games > 0 ? (h2._top4 / h2.games) : 0;
      h2.winRate = h2.games > 0 ? (h2._wins / h2.games) : 0;
      delete h2._totalRank;
      delete h2._top4;
      delete h2._wins;
    }
  }

  // MMR 趋势：按时间排序并只保留最近200条
  stats.mmrTrend.history.sort(function(a, b) {
    return (a.date || "") < (b.date || "") ? -1 : 1;
  });
  if (stats.mmrTrend.history.length > 200) {
    stats.mmrTrend.history = stats.mmrTrend.history.slice(-200);
  }
  delete stats.mmrTrend._latestDate;

  // 卡牌
  var cardKeys = Object.keys(stats.cardStats);
  for (var ck = 0; ck < cardKeys.length; ck++) {
    var c = stats.cardStats[cardKeys[ck]];
    c.avgPlacement = c.pickCount > 0 ? (c.totalRank / c.pickCount) : 0;
    delete c.totalRank;
  }

  // 种族
  var raceKeys = Object.keys(stats.raceStats);
  for (var rk = 0; rk < raceKeys.length; rk++) {
    var r = stats.raceStats[raceKeys[rk]];
    r.avgPlacement = r.count > 0 ? (r.totalRank / r.count) : 0;
    delete r.totalRank;
  }

  // 机制
  var mechKeys = Object.keys(stats.mechanicStats);
  for (var mk2 = 0; mk2 < mechKeys.length; mk2++) {
    var me = stats.mechanicStats[mechKeys[mk2]];
    me.avgPlacement = me.count > 0 ? (me.totalRank / me.count) : 0;
    delete me.totalRank;
  }

  // 标签
  var tagKeys = Object.keys(stats.tagStats);
  for (var tk = 0; tk < tagKeys.length; tk++) {
    var ta = stats.tagStats[tagKeys[tk]];
    ta.avgPlacement = ta.count > 0 ? (ta.totalRank / ta.count) : 0;
    delete ta.totalRank;
  }

  // 星级
  var tierKeys = Object.keys(stats.tierStats);
  for (var tk2 = 0; tk2 < tierKeys.length; tk2++) {
    var ti = stats.tierStats[tierKeys[tk2]];
    ti.avgPlacement = ti.count > 0 ? (ti.totalRank / ti.count) : 0;
    delete ti.totalRank;
  }

  // ── 写入输出 ──
  fs.writeFileSync(outPath, JSON.stringify(stats, null, 2), "utf-8");

  // ── 摘要 ──
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   个人玩家画像提取完成                     ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");
  console.log("数据源: bg_player.db " + records.length + " 场 + Firestone " + firestoneGames.length + " 场 = " + (records.length + firestoneGames.length) + " 场总计");
  console.log("日期范围: " + stats.dateRange.from.slice(0, 10) + " ~ " + stats.dateRange.to.slice(0, 10));
  if (stats.mmrTrend.latest > 0) {
    console.log("MMR: 当前 " + stats.mmrTrend.latest + " / 峰值 " + stats.mmrTrend.peak);
  }

  // Top 5 英雄 (按游戏场数)
  var topHeroes = Object.entries(stats.heroStats)
    .filter(function(e) { return e[1].games >= 5; })
    .sort(function(a, b) { return a[1].avgPlacement - b[1].avgPlacement; })
    .slice(0, 10);
  console.log("\n最佳英雄 (≥5场):");
  topHeroes.forEach(function(e, i) {
    var h = e[1];
    console.log("  " + (i + 1) + ". " + (h.name_cn || e[0]) + " 均排 " + h.avgPlacement.toFixed(2) + " 前四率 " + (h.top4Rate * 100).toFixed(0) + "% 吃鸡率 " + (h.winRate * 100).toFixed(0) + "% (" + h.games + "场)");
  });

  // Top 10 最常拿的卡
  var topCards = Object.entries(stats.cardStats)
    .filter(function(e) { return e[1].pickCount >= 5; })
    .sort(function(a, b) { return b[1].pickCount - a[1].pickCount; })
    .slice(0, 10);
  console.log("\n最常拿的卡 (≥5次):");
  topCards.forEach(function(e, i) {
    var c = e[1];
    console.log("  " + (i + 1) + ". " + (c.name_cn || e[0]) + " (T" + c.tier + ") " + c.pickCount + "次 均排 " + c.avgPlacement.toFixed(2));
  });

  // 种族偏好
  var topRaces = Object.entries(stats.raceStats)
    .sort(function(a, b) { return b[1].count - a[1].count; });
  console.log("\n种族偏好:");
  topRaces.forEach(function(e) {
    console.log("  " + e[0] + ": " + e[1].count + "次 均排 " + e[1].avgPlacement.toFixed(2));
  });

  // 机制偏好 Top 10
  var topMechs = Object.entries(stats.mechanicStats)
    .sort(function(a, b) { return b[1].count - a[1].count; })
    .slice(0, 10);
  console.log("\n关键词偏好:");
  topMechs.forEach(function(e) {
    console.log("  " + e[0] + ": " + e[1].count + "次 均排 " + e[1].avgPlacement.toFixed(2));
  });

  // Top 1 冠军阵容特征
  var top1Races = Object.entries(stats.byPlacement.top1.races)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5);
  console.log("\n🏆 吃鸡阵容最常见种族:");
  top1Races.forEach(function(e) {
    console.log("  " + e[0] + ": " + e[1] + "次");
  });

  console.log("\n输出文件: " + outPath);
}

// ── 标签推断 (复用 CardDatabase 逻辑) ──
function inferTags(card) {
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
    else if (m === "START_OF_COMBAT") tags.push("start_of_combat");
    else if (m === "TRIGGER_VISUAL") tags.push("trigger_visual");
  }

  if (/铸币|金币|获得.*枚|gain.*coin/i.test(text)) tags.push("economy");
  if (/出售|sell/i.test(text)) tags.push("sell_synergy");
  if (/圣盾|divine shield/i.test(text) && tags.indexOf("shield") === -1) tags.push("shield_synergy");
  if (/亡语|deathrattle/i.test(text) && tags.indexOf("deathrattle") === -1) tags.push("deathrattle_synergy");

  return tags;
}

// ── CLI 参数解析 ──
function parseArgs() {
  var args = process.argv.slice(2);
  var opts = {};
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--from" && i + 1 < args.length) opts.from = args[++i];
    else if (args[i] === "--to" && i + 1 < args.length) opts.to = args[++i];
    else if (args[i] === "--output" && i + 1 < args.length) opts.output = args[++i];
  }
  return opts;
}
main(parseArgs());
