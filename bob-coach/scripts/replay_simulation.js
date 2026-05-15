"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var base = path.join(__dirname, "..");

// ═══════════════════════════════════════════════════════
// 回放模拟：基于历史对局数据提取玩法特征
//
// 用法: node scripts/replay_simulation.js [--games N] [--output path]
//
// 流程:
//   1. 读 _firestone_apr10.json 获取用户实际英雄序列
//   2. 加载仿真框架 + 用户画像
//   3. 跑 N 局模拟 (Bob agent 使用用户画像)
//   4. 从模拟结果提取每局特征 → 聚合为玩法特征向量
//   5. 输出 playstyle_profile.json
// ═══════════════════════════════════════════════════════

// ── 加载模块（复用 simulate_games.js 的加载逻辑） ──
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
loadModule("modules/CardDatabase.js");
loadModule("modules/ProfileEngine.js");
loadModule("modules/PlaystyleFeatures.js");

// ── 加载数据 ──
var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var heroStats = JSON.parse(fs.readFileSync(path.join(base, "data", "hero_stats.json"), "utf-8"));
var comps = JSON.parse(fs.readFileSync(path.join(base, "data", "comp_strategies.json"), "utf-8"));
var si = JSON.parse(fs.readFileSync(path.join(base, "data", "spell_interactions.json"), "utf-8"));

var cardsById = {};
var cardsByTier = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
for (var i = 0; i < cardsArr.length; i++) {
  var c = cardsArr[i];
  cardsById[c.str_id] = c;
  if (c.card_type === "minion" && c.tier && c.tier <= 7) cardsByTier[c.tier].push(c);
}

function buildLookup(raw) {
  if (!raw) return null;
  var result = { buffAmplifierIds: {}, castTriggerIds: {}, duplicatorIds: {}, generatorIds: {}, costReducerIds: {}, trinketInteractIds: {} };
  var keys = ["spell_buff_amplifiers", "spell_cast_triggers", "spell_duplicators", "spell_generators", "spell_cost_reducers"];
  var targets = [result.buffAmplifierIds, result.castTriggerIds, result.duplicatorIds, result.generatorIds, result.costReducerIds];
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

// ── 加载仿真框架 ──
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
loadSim("RandomAI.js");
loadSim("MatchmakingSystem.js");
loadSim("WisdomBall.js");
loadSim("PartnerSystem.js");
loadSim("OpponentTracker.js");
loadSim("CompMatcher.js");
loadSim("SimulationEngine.js");

// ── 玩家画像 ──
var playerProfile = null;
var profileEngine = null;
try {
  playerProfile = JSON.parse(fs.readFileSync(path.join(base, "data", "player_profile.json"), "utf-8"));
  profileEngine = new ProfileEngine(null, null);
  profileEngine.loadExtractedProfile(playerProfile);
} catch (e) {
  console.log("[WARN] 未找到玩家画像，使用默认");
}

// ── CLI ──
function parseArgs() {
  var args = process.argv.slice(2);
  var config = { games: 467, bobCount: 1, output: null };
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--games" && i + 1 < args.length) config.games = parseInt(args[++i], 10);
    else if (args[i] === "--output" && i + 1 < args.length) config.output = args[++i];
    else if (args[i] === "--bob" && i + 1 < args.length) config.bobCount = parseInt(args[++i], 10);
  }
  return config;
}

var config = parseArgs();
var outPath = config.output || path.join(base, "data", "playstyle_profile.json");

// ── 初始化和运行 ──
SimulationEngine.init({
  cardsById: cardsById,
  cardsByTier: cardsByTier,
  heroStatsById: heroStatsById,
  decisionTables: dt,
  comps: comps,
  lookup: lookup,
  levelingCurve: dt.leveling_curve,
  heroOverrides: (dt.leveling_curve && dt.leveling_curve.hero_overrides) || {},
  profileEngine: profileEngine,
});

console.log("╔══════════════════════════════════════════╗");
console.log("║   回放模拟 — 玩法特征提取                ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");
console.log("配置: " + config.games + " 局 | " + config.bobCount + " Bob + " + (8 - config.bobCount) + " HeuristicAI");
console.log("玩家画像: " + (playerProfile ? playerProfile.totalGamesCombined + " 局" : "默认"));

var startTime = Date.now();
var results = SimulationEngine.runBatch(config.games, {
  bobPlayerCount: config.bobCount,
  heuristicPlayerCount: 8 - config.bobCount,
  seed: 42,
});

// ── 提取特征 ──
var bobPlayers = [];
for (var g = 0; g < results.length; g++) {
  for (var p = 0; p < results[g].players.length; p++) {
    if (results[g].players[p].aiType === "bob") bobPlayers.push(results[g].players[p]);
  }
}

var features = [];
for (var i = 0; i < bobPlayers.length; i++) {
  features.push(PlaystyleFeatures.extractFromPlayer(bobPlayers[i]));
}
var aggregated = PlaystyleFeatures.aggregate(features);

// ── 附加英雄频率（从 Firestone 数据） ──
var heroFrequency = {};
try {
  var fgData = JSON.parse(fs.readFileSync(path.join(base, "data", "_firestone_apr10.json"), "utf-8"));
  for (var fi = 0; fi < fgData.length; fi++) {
    var hero = fgData[fi].hero || fgData[fi].playerCardId || "";
    if (hero) heroFrequency[hero] = (heroFrequency[hero] || 0) + 1;
  }
} catch (e) { /* ignore */ }

var topHeroEntries = Object.entries(heroFrequency)
  .sort(function(a, b) { return b[1] - a[1]; })
  .slice(0, 10)
  .map(function(e) { return { heroId: e[0], games: e[1] }; });
aggregated.topHeroes = topHeroEntries;
aggregated.meta.sourceType = "replay_simulation";
aggregated.meta.generatedAt = new Date().toISOString();

// ── 输出 ──
fs.writeFileSync(outPath, JSON.stringify(aggregated, null, 2), "utf-8");

var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log("");
console.log("模拟完成: " + config.games + " 局 / " + elapsed + " 秒");
console.log("Bob 平均排名: " + aggregated.meta.avgPlacement.toFixed(2));
console.log("前四率: " + (aggregated.meta.top4Rate * 100).toFixed(1) + "%");
console.log("吃鸡率: " + (aggregated.meta.winRate * 100).toFixed(1) + "%");
console.log("激进程度: " + aggregated.aggressivenessScore.toFixed(2));
console.log("协同程度: " + aggregated.synergyScore.toFixed(2));
console.log("灵活程度: " + aggregated.flexibilityScore.toFixed(2));
console.log("金币效率: " + aggregated.goldEfficiency.toFixed(2));
console.log("卖出率: " + aggregated.sellRate.toFixed(2));
console.log("升本曲线: " + aggregated.levelingCurve.curveType);

// Top 3 种族
var raceEntries = Object.entries(aggregated.racePreference)
  .sort(function(a, b) { return b[1] - a[1]; })
  .slice(0, 3);
console.log("Top 种族: " + raceEntries.map(function(e) { return e[0] + "(" + e[1] + ")"; }).join(", "));

console.log("\n输出: " + outPath);
