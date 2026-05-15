"use strict";

// ═══════════════════════════════════════════════════════════
// Trinket Season Comparative Test
// ═══════════════════════════════════════════════════════════
//
// 对比测试:
//   A 组: Bob agent 使用玩家饰品赛季画像 (player_profile_apr15.json)
//   B 组: Bob agent 使用通用策略 (无玩家画像，纯决策表最优)
//
// 对手统一: 4 HeuristicAI + 剩余 RandomAI
//
// 用法: node scripts/trinket_comparative_test.js [--games N] [--bob N]
//
// 产出:
//   data/trinket_comparison.json — 完整对比数据
//   控制台输出 — 关键指标对比

var fs = require("fs");
var vm = require("vm");
var path = require("path");

var base = path.join(__dirname, "..");

function loadModule(filename) {
  var code = fs.readFileSync(path.join(base, filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: filename });
}

function loadSim(filename) {
  var code = fs.readFileSync(path.join(base, "simulation", filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: "simulation/" + filename });
}

// ── Load modules ──
loadModule("modules/DecisionBase.js");
loadModule("modules/RulesEngine.js");
loadModule("modules/Orchestrator.js");
loadModule("modules/LevelingModule.js");
loadModule("modules/MinionPickModule.js");
loadModule("modules/HeroPowerModule.js");
loadModule("modules/SpellModule.js");
loadModule("modules/MechanicScoring.js");
loadModule("modules/TrinketModule.js");
loadModule("modules/SellModule.js");
loadModule("modules/OpponentAnalysisModule.js");
loadModule("modules/RefreshModule.js");
loadModule("modules/FreezeModule.js");
loadModule("modules/CardDatabase.js");
loadModule("modules/ProfileEngine.js");

// ── Load data ──
var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var heroStats = JSON.parse(fs.readFileSync(path.join(base, "data", "hero_stats.json"), "utf-8"));
var comps = JSON.parse(fs.readFileSync(path.join(base, "data", "comp_strategies.json"), "utf-8"));
var si = JSON.parse(fs.readFileSync(path.join(base, "data", "spell_interactions.json"), "utf-8"));

// Build lookups
var cardsById = {};
var cardsByTier = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
var spellsList = [];
for (var i = 0; i < cardsArr.length; i++) {
  var c = cardsArr[i];
  cardsById[c.str_id] = c;
  if (c.card_type === "minion" && c.tier && c.tier <= 7) {
    cardsByTier[c.tier].push(c);
  }
  if (c.card_type === "tavern") {
    spellsList.push(c);
  }
}

function buildLookup(raw) {
  if (!raw) return null;
  var result = {
    buffAmplifierIds: {}, castTriggerIds: {}, duplicatorIds: {},
    generatorIds: {}, costReducerIds: {}, trinketInteractIds: {},
  };
  var keys = ["spell_buff_amplifiers", "spell_cast_triggers", "spell_duplicators",
               "spell_generators", "spell_cost_reducers"];
  var targets = [result.buffAmplifierIds, result.castTriggerIds, result.duplicatorIds,
                  result.generatorIds, result.costReducerIds];
  for (var k = 0; k < keys.length; k++) {
    var arr = raw[keys[k]];
    if (arr) for (var a = 0; a < arr.length; a++) targets[k][arr[a].id] = true;
  }
  for (var tk = 0; tk < keys.length; tk++) {
    var tArr = raw[keys[tk]];
    if (tArr) for (var ta = 0; ta < tArr.length; ta++) {
      if (tArr[ta].type === "trinket") result.trinketInteractIds[tArr[ta].id] = true;
    }
  }
  return result;
}
var lookup = buildLookup(si);

var heroStatsById = {};
for (var i = 0; i < heroStats.length; i++) {
  heroStatsById[heroStats[i].hero_card_id] = heroStats[i];
}

// ── Load simulation framework ──
loadSim("SeededRNG.js");
loadSim("SharedPool.js");
loadSim("ArmorSystem.js");
loadSim("DamageSystem.js");
loadSim("CombatResolver.js");
loadSim("PlayerAgent.js");
loadSim("HeuristicAI.js");
loadSim("RandomAI.js");
loadSim("MatchmakingSystem.js");
loadSim("WisdomBall.js");
loadSim("PartnerSystem.js");
loadSim("OpponentTracker.js");
loadSim("CompMatcher.js");
loadSim("TrinketOfferSystem.js");
loadSim("SimulationEngine.js");

// ── Init trinket system ──
var trinketTips = {};
try {
  trinketTips = JSON.parse(fs.readFileSync(path.join(base, "data", "trinket_tips.json"), "utf-8"));
} catch(e) { /* ignore */ }
TrinketOfferSystem.init(cardsArr, trinketTips);

var heroOverrides = (dt.leveling_curve && dt.leveling_curve.hero_overrides) || {};

// ═══════════════════════════════════════════════════════════
// Profile loading
// ═══════════════════════════════════════════════════════════

var profileEngineA = null;  // Player trinket season
var profileEngineB = null;  // Universal / no profile

try {
  var profileApr15 = JSON.parse(fs.readFileSync(path.join(base, "data", "player_profile_apr15.json"), "utf-8"));
  profileEngineA = new ProfileEngine(null, null);
  profileEngineA.loadExtractedProfile(profileApr15);
  console.log("[A组] 玩家饰品赛季画像: " + profileApr15.totalGamesCombined + " 局, 风格: " + profileEngineA.inferPlaystyle());
} catch (e) {
  console.log("[A组] 未找到 player_profile_apr15.json，使用通用策略");
}

// B组: 纯决策表策略（无玩家画像 = 通用最优基线）
profileEngineB = null;
console.log("[B组] 纯决策表策略（无玩家画像，通用最优基线）");

// ═══════════════════════════════════════════════════════════
// Parse args
// ═══════════════════════════════════════════════════════════

function parseArgs() {
  var args = process.argv.slice(2);
  var config = { games: 10000, bobCount: 2, seed: 42 };
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--games" && i + 1 < args.length) config.games = parseInt(args[++i], 10);
    else if (args[i] === "--bob" && i + 1 < args.length) config.bobCount = parseInt(args[++i], 10);
    else if (args[i] === "--seed" && i + 1 < args.length) config.seed = parseInt(args[++i], 10);
  }
  return config;
}

var config = parseArgs();

// ═══════════════════════════════════════════════════════════
// Run comparison
// ═══════════════════════════════════════════════════════════

console.log("╔══════════════════════════════════════════╗");
console.log("║  饰品赛季对比测试                         ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");
console.log("配置: " + config.games + " 局 x 2组 | " + config.bobCount + " Bob + " + (4 - config.bobCount) + " Heuristic + 4 Random | seed=" + config.seed);
console.log("");

var totalStart = Date.now();

function runBatch(label, profileEngine, games, bobCount, startSeed) {
  console.log("── " + label + " ──");

  SimulationEngine.init({
    cardsById: cardsById,
    cardsByTier: cardsByTier,
    heroStatsById: heroStatsById,
    decisionTables: dt,
    comps: comps,
    lookup: lookup,
    levelingCurve: dt.leveling_curve,
    heroOverrides: heroOverrides,
    profileEngine: profileEngine,
  });

  var batchStart = Date.now();
  var results = SimulationEngine.runBatch(games, {
    bobPlayerCount: bobCount,
    heuristicPlayerCount: 4 - bobCount,
    randomPlayerCount: 4,
    seed: startSeed,
    verbose: false,
  });

  // Aggregate stats
  var bobStats = { count: 0, placements: [], top4: 0, top1: 0, speed78: 0, totalHP: 0, totalBoard: 0, totalFollowed: 0, totalDecisions: 0 };
  var trinketPicks = {};
  var trinketTurns = { 6: 0, 9: 0 };

  for (var g = 0; g < results.length; g++) {
    for (var p = 0; p < results[g].players.length; p++) {
      var pl = results[g].players[p];
      if (pl.aiType !== "bob") continue;
      bobStats.count++;
      bobStats.placements.push(pl.placement);
      if (pl.placement <= 4) bobStats.top4++;
      if (pl.placement === 1) bobStats.top1++;
      if (pl.placement >= 7) bobStats.speed78++;
      bobStats.totalHP += pl.health;
      bobStats.totalBoard += pl.board.length;
      bobStats.totalFollowed += (pl.followedDecisions || 0);
      bobStats.totalDecisions += (pl.totalDecisions || 0);

      // Trinket picks
      var decisions = pl.decisionsMade || [];
      for (var d = 0; d < decisions.length; d++) {
        var dec = decisions[d];
        if (dec.action === "pick_trinket" && dec.cardId) {
          trinketPicks[dec.cardId] = (trinketPicks[dec.cardId] || 0) + 1;
          trinketTurns[dec.turn || 0] = (trinketTurns[dec.turn || 0] || 0) + 1;
        }
      }
    }
  }

  function avg(arr) {
    return arr.length > 0 ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0;
  }

  var elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);

  var topTrinkets = [];
  for (var tid in trinketPicks) {
    topTrinkets.push({ cardId: tid, count: trinketPicks[tid] });
  }
  topTrinkets.sort(function(a, b) { return b.count - a.count; });
  topTrinkets = topTrinkets.slice(0, 10);
  // Resolve names
  for (var ti = 0; ti < topTrinkets.length; ti++) {
    var tc = cardsById[topTrinkets[ti].cardId];
    topTrinkets[ti].name_cn = tc ? tc.name_cn : topTrinkets[ti].cardId;
  }

  var stats = {
    label: label,
    games: games,
    bobCount: bobCount,
    avgPlacement: avg(bobStats.placements),
    top4Rate: bobStats.count > 0 ? bobStats.top4 / bobStats.count : 0,
    winRate: bobStats.count > 0 ? bobStats.top1 / bobStats.count : 0,
    speed78Rate: bobStats.count > 0 ? bobStats.speed78 / bobStats.count : 0,
    avgHP: bobStats.count > 0 ? bobStats.totalHP / bobStats.count : 0,
    avgBoard: bobStats.count > 0 ? bobStats.totalBoard / bobStats.count : 0,
    followRate: bobStats.totalDecisions > 0 ? bobStats.totalFollowed / bobStats.totalDecisions : 0,
    trinketPickCount: Object.keys(trinketPicks).length,
    topTrinkets: topTrinkets,
    trinketTurns: trinketTurns,
    elapsed: elapsed + "s",
  };

  console.log("  平均排名: " + stats.avgPlacement.toFixed(2));
  console.log("  前四率:   " + (stats.top4Rate * 100).toFixed(1) + "%");
  console.log("  吃鸡率:   " + (stats.winRate * 100).toFixed(1) + "%");
  console.log("  速78率:   " + (stats.speed78Rate * 100).toFixed(1) + "%");
  console.log("  决策跟随: " + (stats.followRate * 100).toFixed(1) + "%");
  console.log("  饰品选择: " + stats.trinketPickCount + " 种不同饰品");
  console.log("  耗时:     " + elapsed + "s");
  console.log("");

  return stats;
}

// Run both batches
var statsA = runBatch("[A组] 玩家饰品赛季模型", profileEngineA, config.games, config.bobCount, config.seed);
var statsB = runBatch("[B组] 纯决策表基线（无玩家画像）", profileEngineB, config.games, config.bobCount, config.seed + 50000);

// ═══════════════════════════════════════════════════════════
// Comparison summary
// ═══════════════════════════════════════════════════════════

var totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);

console.log("═══ 对比摘要 ═══");
console.log("");
console.log("指标              A组(玩家画像)  B组(纯决策表)  差异");
console.log("─────────────────────────────────────────────────────");

function compareRow(label, valA, valB, fmt, better) {
  fmt = fmt || function(v) { return v.toFixed(2); };
  var diff = valB - valA;
  var diffStr = (diff >= 0 ? "+" : "") + fmt(diff);
  if (better === "lower") {
    diffStr += (diff > 0.001 ? " (A优)" : diff < -0.001 ? " (B优)" : "");
  } else if (better === "higher") {
    diffStr += (diff > 0.001 ? " (B优)" : diff < -0.001 ? " (A优)" : "");
  }
  console.log(label.padEnd(16) + " " + fmt(valA).padStart(8) + "     " + fmt(valB).padStart(8) + "     " + diffStr);
}

compareRow("平均排名", statsA.avgPlacement, statsB.avgPlacement, function(v) { return v.toFixed(2); }, "lower");
compareRow("前四率", statsA.top4Rate * 100, statsB.top4Rate * 100, function(v) { return v.toFixed(1) + "%"; }, "higher");
compareRow("吃鸡率", statsA.winRate * 100, statsB.winRate * 100, function(v) { return v.toFixed(1) + "%"; }, "higher");
compareRow("速78率", statsA.speed78Rate * 100, statsB.speed78Rate * 100, function(v) { return v.toFixed(1) + "%"; }, "lower");
compareRow("平均血量", statsA.avgHP, statsB.avgHP, function(v) { return v.toFixed(1); }, "higher");
compareRow("平均随从", statsA.avgBoard, statsB.avgBoard, function(v) { return v.toFixed(1); }, "higher");
compareRow("决策跟随率", statsA.followRate * 100, statsB.followRate * 100, function(v) { return v.toFixed(1) + "%"; }, "higher");
compareRow("饰品种类", statsA.trinketPickCount, statsB.trinketPickCount, function(v) { return String(Math.round(v)); }, "higher");

console.log("");
console.log("A组 Top5 饰品: " + statsA.topTrinkets.slice(0, 5).map(function(t) { return t.name_cn + "(" + t.count + ")"; }).join(", "));
console.log("B组 Top5 饰品: " + statsB.topTrinkets.slice(0, 5).map(function(t) { return t.name_cn + "(" + t.count + ")"; }).join(", "));

// Find divergent trinkets (picked by one group but not the other)
var bTrinketSet = {};
for (var bi = 0; bi < statsB.topTrinkets.length; bi++) {
  bTrinketSet[statsB.topTrinkets[bi].cardId] = statsB.topTrinkets[bi].count;
}
var aOnly = [];
for (var ai = 0; ai < statsA.topTrinkets.length; ai++) {
  if (!bTrinketSet[statsA.topTrinkets[ai].cardId]) {
    aOnly.push(statsA.topTrinkets[ai]);
  }
}
if (aOnly.length > 0) {
  console.log("A组独有饰品: " + aOnly.slice(0, 5).map(function(t) { return t.name_cn + "(" + t.count + ")"; }).join(", "));
}
var bOnly = [];
var aTrinketSet = {};
for (var aj = 0; aj < statsA.topTrinkets.length; aj++) {
  aTrinketSet[statsA.topTrinkets[aj].cardId] = statsA.topTrinkets[aj].count;
}
for (var bj = 0; bj < statsB.topTrinkets.length; bj++) {
  if (!aTrinketSet[statsB.topTrinkets[bj].cardId]) {
    bOnly.push(statsB.topTrinkets[bj]);
  }
}
if (bOnly.length > 0) {
  console.log("B组独有饰品: " + bOnly.slice(0, 5).map(function(t) { return t.name_cn + "(" + t.count + ")"; }).join(", "));
}

console.log("");
console.log("总耗时: " + totalElapsed + "s");

// ═══════════════════════════════════════════════════════════
// Save report
// ═══════════════════════════════════════════════════════════

var report = {
  generatedAt: new Date().toISOString(),
  config: config,
  groupA: statsA,
  groupB: statsB,
  comparison: {
    placementDiff: statsB.avgPlacement - statsA.avgPlacement,
    top4RateDiff: statsB.top4Rate - statsA.top4Rate,
    winRateDiff: statsB.winRate - statsA.winRate,
    speed78Diff: statsB.speed78Rate - statsA.speed78Rate,
    followRateDiff: statsB.followRate - statsA.followRate,
    trinketDiversityDiff: statsB.trinketPickCount - statsA.trinketPickCount,
  },
};

var outDir = path.join(base, "data");
fs.writeFileSync(path.join(outDir, "trinket_comparison.json"), JSON.stringify(report, null, 2), "utf-8");

console.log("报告已保存: data/trinket_comparison.json");
