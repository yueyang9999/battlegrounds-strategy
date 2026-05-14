"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var base = __dirname;

function loadModule(filename) {
  var code = fs.readFileSync(path.join(base, filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: filename });
}

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

// Load data
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

// Hero stats lookup
var heroStatsById = {};
for (var i = 0; i < heroStats.length; i++) {
  heroStatsById[heroStats[i].hero_card_id] = heroStats[i];
}

// ═══════════════════════════════════════════════════════════
// 8-PLAYER SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════

// Load simulation framework (vm.runInThisContext style)
function loadSim(filename) {
  var code = fs.readFileSync(path.join(base, "simulation", filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: "simulation/" + filename });
}

loadSim("SeededRNG.js");
loadSim("SharedPool.js");
loadSim("ArmorSystem.js");
loadSim("DamageSystem.js");
loadSim("CombatResolver.js");
loadSim("PlayerAgent.js");
loadSim("HeuristicAI.js");
loadSim("MatchmakingSystem.js");
loadSim("WisdomBall.js");
loadSim("PartnerSystem.js");
loadSim("OpponentTracker.js");
loadSim("SimulationEngine.js");

// Hero leveling curve overrides
var heroOverrides = (dt.leveling_curve && dt.leveling_curve.hero_overrides) || {};

// Init simulation engine
SimulationEngine.init({
  cardsById: cardsById,
  cardsByTier: cardsByTier,
  heroStatsById: heroStatsById,
  decisionTables: dt,
  comps: comps,
  lookup: lookup,
  levelingCurve: dt.leveling_curve,
  heroOverrides: heroOverrides,
});

// ═══════════════════════════════════════════════════════════
// Batch Runner & Reporting
// ═══════════════════════════════════════════════════════════

function parseArgs() {
  var args = process.argv.slice(2);
  var config = { games: 10, bobCount: 1, heuristicCount: 7, seed: 42, verbose: false };
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--games" && i + 1 < args.length) config.games = parseInt(args[++i], 10);
    else if (args[i] === "--bob" && i + 1 < args.length) config.bobCount = parseInt(args[++i], 10);
    else if (args[i] === "--heuristic" && i + 1 < args.length) config.heuristicCount = parseInt(args[++i], 10);
    else if (args[i] === "--seed" && i + 1 < args.length) config.seed = parseInt(args[++i], 10);
    else if (args[i] === "--verbose") config.verbose = true;
  }
  if (config.bobCount + config.heuristicCount !== 8) {
    config.heuristicCount = 8 - config.bobCount;
  }
  return config;
}

var config = parseArgs();

console.log("╔══════════════════════════════════════════╗");
console.log("║   Bob教练 8人模拟对局测试                ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");
console.log("配置: " + config.games + " 局 | " + config.bobCount + " Bob教练 + " + config.heuristicCount + " 启发式AI | seed=" + config.seed);
console.log("");

var startTime = Date.now();
var results = SimulationEngine.runBatch(config.games, {
  bobPlayerCount: config.bobCount,
  heuristicPlayerCount: config.heuristicCount,
  seed: config.seed,
  verbose: config.verbose,
});

// Aggregate stats for BobCoach players
var bobPlayers = [];
for (var g = 0; g < results.length; g++) {
  for (var p = 0; p < results[g].players.length; p++) {
    var pl = results[g].players[p];
    if (pl.aiType === "bob") bobPlayers.push(pl);
  }
}

if (bobPlayers.length > 0) {
  var avgPlace = 0, top4 = 0, top1 = 0, avgHP = 0, avgArmor = 0, avgBoardSize = 0;
  for (var i = 0; i < bobPlayers.length; i++) {
    avgPlace += bobPlayers[i].placement;
    if (bobPlayers[i].placement <= 4) top4++;
    if (bobPlayers[i].placement === 1) top1++;
    avgHP += bobPlayers[i].health;
    avgArmor += bobPlayers[i].armor;
    avgBoardSize += bobPlayers[i].board.length;
  }
  var n = bobPlayers.length;
  console.log("  ┌─────────────────────────────────────────┐");
  console.log("  │ Bob教练 玩家统计 (" + n + " 局)                  │");
  console.log("  ├─────────────────────────────────────────┤");
  console.log("  │ 平均排名:  " + (avgPlace / n).toFixed(2).padStart(6) + "                        │");
  console.log("  │ 前4率:     " + (top4 / n * 100).toFixed(1).padStart(6) + "%                       │");
  console.log("  │ 吃鸡率:    " + (top1 / n * 100).toFixed(1).padStart(6) + "%                       │");
  console.log("  │ 平均血量:  " + (avgHP / n).toFixed(1).padStart(6) + "                        │");
  console.log("  │ 平均护甲:  " + (avgArmor / n).toFixed(1).padStart(6) + "                        │");
  console.log("  │ 平均随从:  " + (avgBoardSize / n).toFixed(1).padStart(6) + "                        │");
  console.log("  └─────────────────────────────────────────┘");
}

// Heuristic AI stats
var heuristicPlayers = [];
for (var g2 = 0; g2 < results.length; g2++) {
  for (var p2 = 0; p2 < results[g2].players.length; p2++) {
    var pl2 = results[g2].players[p2];
    if (pl2.aiType === "heuristic") heuristicPlayers.push(pl2);
  }
}

if (heuristicPlayers.length > 0) {
  var hAvg = 0, hTop4 = 0, hTop1 = 0;
  for (var i2 = 0; i2 < heuristicPlayers.length; i2++) {
    hAvg += heuristicPlayers[i2].placement;
    if (heuristicPlayers[i2].placement <= 4) hTop4++;
    if (heuristicPlayers[i2].placement === 1) hTop1++;
  }
  var hn = heuristicPlayers.length;
  console.log("  ┌─────────────────────────────────────────┐");
  console.log("  │ 启发式AI 玩家统计 (" + hn + " 局)                │");
  console.log("  ├─────────────────────────────────────────┤");
  console.log("  │ 平均排名:  " + (hAvg / hn).toFixed(2).padStart(6) + "                        │");
  console.log("  │ 前4率:     " + (hTop4 / hn * 100).toFixed(1).padStart(6) + "%                       │");
  console.log("  │ 吃鸡率:    " + (hTop1 / hn * 100).toFixed(1).padStart(6) + "%                       │");
  console.log("  └─────────────────────────────────────────┘");
}

var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log("");
console.log("耗时: " + elapsed + "秒 (" + (config.games / parseFloat(elapsed)).toFixed(1) + " 局/秒)");

// Save results
fs.writeFileSync(
  path.join(base, "sim_results.json"),
  JSON.stringify(results, null, 2),
  "utf-8"
);
console.log("结果已保存到 sim_results.json");
