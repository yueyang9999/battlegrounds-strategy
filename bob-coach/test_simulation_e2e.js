"use strict";

var fs = require("fs");
var vm = require("vm");
var path = require("path");

var base = __dirname;

function loadSim(filename) {
  var code = fs.readFileSync(path.join(base, "simulation", filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: "simulation/" + filename });
}

function loadModule(filename) {
  var code = fs.readFileSync(path.join(base, filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: filename });
}

// Load CombatResolver and its dependencies
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
loadSim("SimulationEngine.js");

// Load modules needed for BobCoach decisions
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
loadModule("modules/RefreshModule.js");
loadModule("modules/FreezeModule.js");

// Load data
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var heroStats = JSON.parse(fs.readFileSync(path.join(base, "data", "hero_stats.json"), "utf-8"));
var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var comps = JSON.parse(fs.readFileSync(path.join(base, "data", "comp_strategies.json"), "utf-8"));
var si = JSON.parse(fs.readFileSync(path.join(base, "data", "spell_interactions.json"), "utf-8"));

var cardsById = {};
var cardsByTier = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
for (var i = 0; i < cardsArr.length; i++) {
  var c = cardsArr[i];
  cardsById[c.str_id] = c;
  if (c.card_type === "minion" && c.tier && c.tier <= 7) {
    cardsByTier[c.tier].push(c);
  }
}

var heroStatsById = {};
for (var i = 0; i < heroStats.length; i++) {
  heroStatsById[heroStats[i].hero_card_id] = heroStats[i];
}

var lookup = {};
var keys = ["spell_buff_amplifiers", "spell_cast_triggers", "spell_duplicators",
             "spell_generators", "spell_cost_reducers"];
var targetKeys = ["buffAmplifierIds", "castTriggerIds", "duplicatorIds",
                  "generatorIds", "costReducerIds"];
for (var k = 0; k < keys.length; k++) {
  lookup[targetKeys[k]] = {};
  var arr = si[keys[k]];
  if (arr) for (var a = 0; a < arr.length; a++) lookup[targetKeys[k]][arr[a].id] = true;
}
lookup.trinketInteractIds = {};
for (var tk2 = 0; tk2 < keys.length; tk2++) {
  var tArr = si[keys[tk2]];
  if (tArr) for (var ta = 0; ta < tArr.length; ta++) {
    if (tArr[ta].type === "trinket") lookup.trinketInteractIds[tArr[ta].id] = true;
  }
}

var heroOverrides = (dt.leveling_curve && dt.leveling_curve.hero_overrides) || {};

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

var passed = 0, failed = 0;

function check(label, condition) {
  if (condition) { passed++; }
  else { console.error("FAIL: " + label); failed++; }
}

function checkEq(label, actual, expected) {
  if (actual === expected) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected " + expected + ")"); failed++; }
}

function checkGt(label, actual, min) {
  if (actual > min) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected > " + min + ")"); failed++; }
}

function checkTruthy(label, condition) {
  if (condition) { passed++; }
  else { console.error("FAIL: " + label + " (falsy)"); failed++; }
}

// ══════════════════════════════════════════════════════
// GROUP A: Full 8-player game runs
// ══════════════════════════════════════════════════════
console.log("=== GROUP A: Full 8-player game ===");

var results = SimulationEngine.runBatch(2, {
  bobPlayerCount: 2,
  heuristicPlayerCount: 6,
  seed: 999,
  verbose: false,
});

checkEq("A1: 2 games produced", results.length, 2);
checkEq("A2: game has players", results[0].players.length, 8);
check("A3: game has selectedRaces", results[0].selectedRaces.length === 5);
checkGt("A4: game has turns", results[0].totalTurns, 0);

// A5: All placements assigned
var allPlaced = true;
for (var g = 0; g < results.length; g++) {
  for (var p = 0; p < results[g].players.length; p++) {
    if (results[g].players[p].placement <= 0) allPlaced = false;
  }
}
check("A5: all players have placement", allPlaced);

// A6: Placements are 1-8 unique
var placements1 = results[0].players.map(function(x) { return x.placement; }).sort();
checkEq("A6: placements cover 1-8", JSON.stringify(placements1), JSON.stringify([1,2,3,4,5,6,7,8]));

// A7: BobCoach players exist
var bobCount = 0;
for (var p2 = 0; p2 < results[0].players.length; p2++) {
  if (results[0].players[p2].aiType === "bob") bobCount++;
}
checkEq("A7: correct bob count in game", bobCount, 2);

// ══════════════════════════════════════════════════════
// GROUP B: Hero initialization
// ══════════════════════════════════════════════════════
console.log("=== GROUP B: Hero initialization ===");

// B1: Patchwerk 60HP
var patchwerkCard = cardsById["TB_BaconShop_HERO_34"];
checkTruthy("B1: Patchwerk card exists", !!patchwerkCard);
checkEq("B1b: Patchwerk health", patchwerkCard.health, 60);

// B2: Normal hero
var edwinCard = cardsById["TB_BaconShop_HERO_01"];
checkTruthy("B2: Edwin card exists", !!edwinCard);

// B3: PlayerAgent initialization
var p1 = new PlayerAgent(1, "TB_BaconShop_HERO_34", "bob", {});
ArmorSystem.initPlayer(p1, "TB_BaconShop_HERO_34", cardsById);
checkEq("B3: Patchwerk starts at 60HP", p1.health, 60);
checkEq("B3b: Patchwerk maxHealth", p1.maxHealth, 60);

var p2b = new PlayerAgent(2, "TB_BaconShop_HERO_01", "heuristic", {});
ArmorSystem.initPlayer(p2b, "TB_BaconShop_HERO_01", cardsById);
checkEq("B3c: Edwin 30HP", p2b.health, 30);
checkEq("B3d: Edwin 18 armor", p2b.armor, 18);

// ══════════════════════════════════════════════════════
// GROUP C: Shop and recruitment
// ══════════════════════════════════════════════════════
console.log("=== GROUP C: Shop and recruitment ===");

var pool = new SharedPool(cardsById);
var races = pool.selectRaces(new SeededRNG(42));
pool.init(races);
var p3 = new PlayerAgent(1, "TB_BaconShop_HERO_01", "bob", {});
ArmorSystem.initPlayer(p3, "TB_BaconShop_HERO_01", cardsById);

// Start turn 1
p3.startTurn(1, pool, new SeededRNG(100), cardsById);
check("C1: turn 1 shop has minions", p3.shop.length > 0);
checkEq("C2: turn 1 gold", p3.gold, 3);

// Buy a minion
if (p3.shop.length > 0) {
  var bought = p3.buyMinion(0, pool);
  checkTruthy("C3: bought minion", !!bought);
  checkEq("C4: board size 1", p3.board.length, 1);
  checkEq("C5: gold decreased", p3.gold, 0);
}

// Turn 2: 4 gold
p3.shop = [];
p3.startTurn(2, pool, new SeededRNG(101), cardsById);
checkEq("C6: turn 2 gold", p3.gold, 4);

// Level up cost
var lvlCost = p3.levelUpCost;
checkGt("C7: level up cost > 0", lvlCost, 0);

// ══════════════════════════════════════════════════════
// GROUP D: Combat results
// ══════════════════════════════════════════════════════
console.log("=== GROUP D: Combat ===");

var ourBoard = [
  { cardId: "TEST1", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 0, name_cn: "A" },
  { cardId: "TEST2", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 1, name_cn: "B" },
];
var defBoard = [
  { cardId: "TEST3", attack: 6, health: 6, tier: 2, golden: false, mechanics: [], position: 0, name_cn: "X" },
];

var result = CombatResolver.simulateCombat(ourBoard, defBoard, 3);
check("D1: combat result has win", result.win !== undefined);
check("D2: result has attackerSurvivors", Array.isArray(result.attackerSurvivors));
check("D3: result has defenderSurvivors", Array.isArray(result.defenderSurvivors));

// Win/Loss/Draw verification
if (result.win) {
  checkGt("D4: attacker wins with survivors", result.attackerSurvivors.length, 0);
  checkEq("D5: defender eliminated", result.defenderSurvivors.length, 0);
} else if (result.defenderSurvivors.length > 0) {
  checkGt("D4b: defender wins with survivors", result.defenderSurvivors.length, 0);
  checkEq("D5b: attacker no survivors", result.attackerSurvivors.length, 0);
} else {
  checkEq("D4c: draw - both sides dead", result.attackerSurvivors.length + result.defenderSurvivors.length, 0);
}

// ══════════════════════════════════════════════════════
// GROUP E: Damage processing
// ══════════════════════════════════════════════════════
console.log("=== GROUP E: Damage processing ===");

// E1: Damage with cap
var dmg = DamageSystem.cappedDamage(4, [{tier: 3}, {tier: 3}], 5, 7);
checkEq("E1: capped damage", dmg, 10);

// E2: Damage in final 4 (no cap)
var dmg2 = DamageSystem.cappedDamage(6, [{tier: 6}, {tier: 6}, {tier: 6}], 10, 4);
checkEq("E2: no cap with 4 alive", dmg2, 24);

// E3: Apply damage to player with armor
var pd = { health: 30, armor: 5 };
ArmorSystem.applyDamage(pd, 8);
checkEq("E3: armor absorbs", pd.armor, 0);
checkEq("E3b: remaining health", pd.health, 27);

// ══════════════════════════════════════════════════════
// GROUP F: Deterministic replay
// ══════════════════════════════════════════════════════
console.log("=== GROUP F: Deterministic replay ===");

var res1 = SimulationEngine.runBatch(1, { bobPlayerCount: 1, heuristicPlayerCount: 7, seed: 5000, verbose: false });
var res2 = SimulationEngine.runBatch(1, { bobPlayerCount: 1, heuristicPlayerCount: 7, seed: 5000, verbose: false });

var placements1 = res1[0].players.map(function(x) { return x.placement; }).join(",");
var placements2 = res2[0].players.map(function(x) { return x.placement; }).join(",");
checkEq("F1: same seed → same placements", placements1, placements2);

// ══════════════════════════════════════════════════════
// GROUP G: All 8 players still alive mid-game
// ══════════════════════════════════════════════════════
console.log("=== GROUP G: Mid-game integrity ===");

var res3 = SimulationEngine.runBatch(1, { bobPlayerCount: 4, heuristicPlayerCount: 4, seed: 3000, verbose: false });
var aliveCount = 0;
for (var pi = 0; pi < res3[0].players.length; pi++) {
  if (res3[0].players[pi].alive) aliveCount++;
}
check("G1: at least 1 player alive at end", aliveCount >= 1);
check("G2: winner has placement 1", res3[0].players[0].placement === 1);

console.log("\n" + "=".repeat(50));
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);
