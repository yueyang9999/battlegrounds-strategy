"use strict";
var fs = require("fs");
var path = require("path");

var BASE = path.join(__dirname, "..");

// ═══════════════════════════════════════════════════════
// 通用上分特征提取 — 从全量 10,841 局历史数据
//
// 用法: node scripts/extract_universal_features.js [--output path]
//
// 产出:
//   data/universal_features.json — MMR 分段统计 + 用户对比
//   控制台输出 — 关键发现摘要
// ═══════════════════════════════════════════════════════

// ── 加载数据 ──
var profilePath = path.join(BASE, "data", "player_profile.json");
var firestonePath = path.join(BASE, "data", "_firestone_games.json");
var heroStatsPath = path.join(BASE, "data", "hero_stats.json");
var cardsPath = path.join(BASE, "data", "cards.json");

var profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
var firestoneGames = [];
try { firestoneGames = JSON.parse(fs.readFileSync(firestonePath, "utf-8")); } catch(e) {}

// 卡牌名称查找
var cardsById = {};
try {
  var cardsArr = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));
  for (var i = 0; i < cardsArr.length; i++) cardsById[cardsArr[i].str_id] = cardsArr[i];
} catch(e) {}

// ── MMR 分段 ──
var BRACKETS = {
  "tier_0_6000":    { min: 0, max: 6000, label: "低分段 (0-6000)" },
  "tier_6001_8999": { min: 6001, max: 8999, label: "中分段 (6001-8999)" },
  "tier_9000_plus": { min: 9000, max: 999999, label: "高分段 (9000+)" },
};

// ── 辅助 ──
function normalizeHero(id) {
  if (!id) return "";
  var skinIdx = id.indexOf("_SKIN_");
  if (skinIdx !== -1) return id.substring(0, skinIdx);
  var skinMatch = id.match(/_SKIN_[A-Z0-9]+$/);
  if (skinMatch) return id.substring(0, skinMatch.index);
  return id;
}

function getBracket(mmr) {
  if (mmr <= 6000) return "tier_0_6000";
  if (mmr <= 8999) return "tier_6001_8999";
  return "tier_9000_plus";
}

// ── 核心分析 ──
console.log("╔══════════════════════════════════════════╗");
console.log("║   通用上分特征提取                        ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");

// 按 MMR 分段统计 (仅 Firestone 数据有 MMR)
var bracketStats = {};
for (var bk in BRACKETS) {
  bracketStats[bk] = {
    label: BRACKETS[bk].label,
    totalGames: 0,
    totalPlacement: 0,
    top4: 0, wins: 0, bot4: 0,
    heroStats: {},     // { heroId: { games, totalRank, top4, wins } }
    mmrRange: { min: 999999, max: 0 },
    placementDist: { "1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0 },
    monthlyGames: {},  // { "2026-04": count }
  };
}

for (var i = 0; i < firestoneGames.length; i++) {
  var fg = firestoneGames[i];
  var mmr = fg.mmr || fg.playerRank || 0;
  var placement = fg.placement;
  if (!placement || placement < 1 || placement > 8) continue;

  var bracket = getBracket(mmr);
  var bs = bracketStats[bracket];
  if (!bs) continue;

  bs.totalGames++;
  bs.totalPlacement += placement;
  bs.placementDist[String(placement)]++;
  if (placement <= 4) bs.top4++;
  if (placement === 1) bs.wins++;
  if (placement >= 7) bs.bot4++;

  if (mmr < bs.mmrRange.min) bs.mmrRange.min = mmr;
  if (mmr > bs.mmrRange.max) bs.mmrRange.max = mmr;

  // 月度分布
  var month = (fg.date || "").substring(0, 7);
  if (month) bs.monthlyGames[month] = (bs.monthlyGames[month] || 0) + 1;

  // 英雄统计
  var hero = normalizeHero(fg.hero || fg.playerCardId || "");
  if (hero) {
    if (!bs.heroStats[hero]) bs.heroStats[hero] = { games: 0, totalRank: 0, top4: 0, wins: 0 };
    bs.heroStats[hero].games++;
    bs.heroStats[hero].totalRank += placement;
    if (placement <= 4) bs.heroStats[hero].top4++;
    if (placement === 1) bs.heroStats[hero].wins++;
  }
}

// ── 计算平均值 ──
for (var bk in bracketStats) {
  var bs = bracketStats[bk];
  bs.avgPlacement = bs.totalGames > 0 ? bs.totalPlacement / bs.totalGames : 0;
  bs.top4Rate = bs.totalGames > 0 ? bs.top4 / bs.totalGames : 0;
  bs.winRate = bs.totalGames > 0 ? bs.wins / bs.totalGames : 0;
  bs.speed78Rate = bs.totalGames > 0 ? bs.bot4 / bs.totalGames : 0;

  // 英雄排名
  var heroEntries = [];
  for (var hid in bs.heroStats) {
    var h = bs.heroStats[hid];
    h.avgPlacement = h.games > 0 ? h.totalRank / h.games : 0;
    h.top4Rate = h.games > 0 ? h.top4 / h.games : 0;
    h.winRate = h.games > 0 ? h.wins / h.games : 0;
    delete h.totalRank; delete h.top4; delete h.wins;
    heroEntries.push({ heroId: hid, stats: h });
  }
  heroEntries.sort(function(a, b) { return a.stats.avgPlacement - b.stats.avgPlacement; });
  bs.topHeroes = heroEntries.filter(function(e) { return e.stats.games >= 5; }).slice(0, 10);
  bs.worstHeroes = heroEntries.filter(function(e) { return e.stats.games >= 5; }).slice(-10).reverse();
}

// ── 用户画像对比 ──
var userHeroStats = profile.heroStats || {};

// ── 输出 ──
var output = {
  generatedAt: new Date().toISOString(),
  totalGamesAnalyzed: firestoneGames.length,
  dataSource: "_firestone_games.json",
  brackets: bracketStats,
  userComparison: {},
};

// 用户 vs 高分段对比
var highBracket = bracketStats["tier_9000_plus"];
if (highBracket && highBracket.topHeroes.length > 0) {
  var comparison = {
    highMmrTopHeroes: highBracket.topHeroes.map(function(e) {
      return { heroId: e.heroId, avgPlace: e.stats.avgPlacement.toFixed(2), games: e.stats.games, winRate: (e.stats.winRate*100).toFixed(0) + "%" };
    }),
    userTopHeroes: [],
    alignmentScore: 0,
    divergenceHeroes: [],
  };

  // 用户最佳英雄
  var userHeroEntries = [];
  for (var uid in userHeroStats) {
    var uh = userHeroStats[uid];
    if (uh.games >= 5) userHeroEntries.push({ heroId: uid, stats: uh });
  }
  userHeroEntries.sort(function(a, b) { return a.stats.avgPlacement - b.stats.avgPlacement; });
  comparison.userTopHeroes = userHeroEntries.slice(0, 10).map(function(e) {
    return { heroId: e.heroId, avgPlace: e.stats.avgPlacement.toFixed(2), games: e.stats.games, winRate: (e.stats.winRate*100).toFixed(0) + "%" };
  });

  // 用户用了哪些高分英雄
  var highMmrHeroIds = highBracket.topHeroes.map(function(e) { return e.heroId; });
  var userUsedHighMmr = 0;
  for (var h = 0; h < highMmrHeroIds.length; h++) {
    if (userHeroStats[highMmrHeroIds[h]]) userUsedHighMmr++;
  }
  comparison.alignmentScore = highMmrHeroIds.length > 0 ? userUsedHighMmr / highMmrHeroIds.length : 0;

  // 用户用的低分英雄（不在高分榜上但用户频繁使用）
  for (var ui = 0; ui < userHeroEntries.length; ui++) {
    var ue = userHeroEntries[ui];
    if (highMmrHeroIds.indexOf(ue.heroId) === -1 && ue.stats.games >= 10) {
      comparison.divergenceHeroes.push({
        heroId: ue.heroId,
        userAvgPlace: ue.stats.avgPlacement.toFixed(2),
        userGames: ue.stats.games,
        highMmrAvgPlace: highBracket.heroStats[ue.heroId]
          ? highBracket.heroStats[ue.heroId].avgPlacement.toFixed(2) : "N/A",
      });
    }
  }
  output.userComparison = comparison;
}

// ── 写入 ──
var outPath = process.argv.indexOf("--output") !== -1
  ? process.argv[process.argv.indexOf("--output") + 1]
  : path.join(BASE, "data", "universal_features.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

// ── 摘要 ──
console.log("MMR 分段统计 (" + firestoneGames.length + " 局):\n");
for (var bk in BRACKETS) {
  var bs = bracketStats[bk];
  console.log("  " + bs.label + ": " + bs.totalGames + " 局");
  console.log("    均排: " + bs.avgPlacement.toFixed(2) + " | 前四: " + (bs.top4Rate*100).toFixed(1) + "% | 吃鸡: " + (bs.winRate*100).toFixed(1) + "% | 速78: " + (bs.speed78Rate*100).toFixed(1) + "%");
  if (bs.topHeroes.length > 0) {
    console.log("    Top 3 英雄: " + bs.topHeroes.slice(0, 3).map(function(e) {
      var name = (cardsById[e.heroId] && cardsById[e.heroId].name_cn) || e.heroId;
      return name + "(" + e.stats.avgPlacement.toFixed(2) + ")";
    }).join(", "));
  }
}

if (output.userComparison.alignmentScore !== undefined) {
  console.log("\n用户 vs 高分段:");
  console.log("  高分段对齐度: " + (output.userComparison.alignmentScore * 100).toFixed(0) + "% (使用了 " + (output.userComparison.alignmentScore * 10).toFixed(0) + "/10 个高分英雄)");
  if (output.userComparison.divergenceHeroes.length > 0) {
    console.log("  用户偏离英雄 (使用多但不在高分榜):");
    output.userComparison.divergenceHeroes.slice(0, 5).forEach(function(d) {
      var name = (cardsById[d.heroId] && cardsById[d.heroId].name_cn) || d.heroId;
      console.log("    " + name + " 用户均排" + d.userAvgPlace + "(" + d.userGames + "场) vs 高分均排" + d.highMmrAvgPlace);
    });
  }
}

console.log("\n输出: " + outPath);
console.log("\n关键发现:");
// 高分段特征
if (highBracket && highBracket.topHeroes.length > 0) {
  var highWinRate = highBracket.winRate;
  var lowWinRate = bracketStats["tier_0_6000"].winRate;
  console.log("  1. 高分段吃鸡率 " + (highWinRate*100).toFixed(1) + "% vs 低分段 " + (lowWinRate*100).toFixed(1) + "% (差异 " + (Math.abs(highWinRate-lowWinRate)*100).toFixed(1) + "pp)");

  var highTop4 = highBracket.top4Rate;
  var lowTop4 = bracketStats["tier_0_6000"].top4Rate;
  console.log("  2. 高分段前四率 " + (highTop4*100).toFixed(1) + "% vs 低分段 " + (lowTop4*100).toFixed(1) + "% (差异 " + (Math.abs(highTop4-lowTop4)*100).toFixed(1) + "pp)");

  var highSpeed78 = highBracket.speed78Rate;
  var lowSpeed78 = bracketStats["tier_0_6000"].speed78Rate;
  console.log("  3. 高分段速78率 " + (highSpeed78*100).toFixed(1) + "% vs 低分段 " + (lowSpeed78*100).toFixed(1) + "%");
}
