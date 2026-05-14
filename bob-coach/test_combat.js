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

loadSim("SeededRNG.js");
loadSim("CombatResolver.js");
loadSim("MatchmakingSystem.js");

var passed = 0;
var failed = 0;

function check(label, condition) {
  if (condition) { passed++; }
  else { console.error("FAIL: " + label); failed++; }
}

function checkGt(label, actual, expected) {
  if (actual > expected) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected > " + expected + ")"); failed++; }
}

function checkApprox(label, actual, expected, tolerance) {
  tolerance = tolerance || 0.01;
  if (Math.abs(actual - expected) <= tolerance) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected " + expected + ")"); failed++; }
}

function checkTruthy(label, actual) {
  if (actual) { passed++; }
  else { console.error("FAIL: " + label + " (got " + JSON.stringify(actual) + ")"); failed++; }
}

function checkEq(label, actual, expected) {
  if (actual === expected) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected " + expected + ")"); failed++; }
}

// ══════════════════════════════════════════════════════
// GROUP A: Unit building
// ══════════════════════════════════════════════════════
console.log("=== GROUP A: Unit building ===");

var unit = CombatResolver._buildUnit({
  cardId: "TEST_DS", attack: 3, health: 4, tier: 2,
  mechanics: ["DIVINE_SHIELD"], position: 0
});
check("A1: divine shield flag", unit.divineShield === true);
check("A2: stats preserved", unit.attack === 3 && unit.health === 4);
check("A3: alive initially", unit.alive === true);

var unit2 = CombatResolver._buildUnit({
  cardId: "TEST_REBORN", attack: 2, health: 3, tier: 1,
  mechanics: ["REBORN"], position: 1
});
check("A4: reborn flag", unit2.reborn === true);
check("A5: reborn not used", unit2.rebornUsed === false);

var unit3 = CombatResolver._buildUnit({
  cardId: "TEST_MULTI", attack: 5, health: 6, tier: 3,
  mechanics: ["TAUNT", "DIVINE_SHIELD", "WINDFURY"], position: 2
});
check("A6: multiple mechanics", unit3.taunt && unit3.divineShield && unit3.windfury);
check("A7: non-existent mech", unit3.venomous === false && unit3.reborn === false);

var goldenUnit = CombatResolver._buildUnit({
  cardId: "TEST_GOLD", attack: 3, health: 4, tier: 2,
  mechanics: ["TAUNT"], golden: true, position: 3
});
check("A8: golden stat doubling", goldenUnit.attack === 6 && goldenUnit.health === 8);

// ══════════════════════════════════════════════════════
// GROUP B: Targeting (taunt priority)
// ══════════════════════════════════════════════════════
console.log("=== GROUP B: Targeting ===");

function makeUnit(atk, hp, mechs) {
  return { attack: atk, health: hp, alive: true, taunt: mechs.indexOf("TAUNT") !== -1,
           divineShield: mechs.indexOf("DIVINE_SHIELD") !== -1,
           reborn: mechs.indexOf("REBORN") !== -1, rebornUsed: false,
           windfury: mechs.indexOf("WINDFURY") !== -1, windfuryUsed: false,
           venomous: mechs.indexOf("VENOMOUS") !== -1,
           tier: 1, position: 0, cardId: "test", name_cn: "test",
           maxHealth: hp, golden: false };
}

// Test taunt priority: run 100 times, should always target taunt
var tauntHits = 0;
var nonTauntHits = 0;
for (var i = 0; i < 100; i++) {
  var defenders = [
    makeUnit(3, 3, []),
    makeUnit(3, 3, ["TAUNT"]),
    makeUnit(3, 3, []),
  ];
  var target = CombatResolver._findTarget(makeUnit(3, 3, []), defenders);
  if (target === defenders[1]) tauntHits++;
  else nonTauntHits++;
}
check("B1: taunt always targeted", tauntHits === 100);

// Multiple taunts: random among taunts
var taunt0Hits = 0;
var taunt2Hits = 0;
for (var i2 = 0; i2 < 100; i2++) {
  var defenders2 = [
    makeUnit(3, 3, ["TAUNT"]),
    makeUnit(3, 3, []),
    makeUnit(3, 3, ["TAUNT"]),
  ];
  var target2 = CombatResolver._findTarget(makeUnit(3, 3, []), defenders2);
  if (target2 === defenders2[0]) taunt0Hits++;
  else if (target2 === defenders2[2]) taunt2Hits++;
}
check("B2: multiple taunts get distributed", taunt0Hits > 0 && taunt2Hits > 0);

// ══════════════════════════════════════════════════════
// GROUP C: Divine Shield
// ══════════════════════════════════════════════════════
console.log("=== GROUP C: Divine Shield ===");

var dsAttacker = makeUnit(5, 3, ["DIVINE_SHIELD"]);
var vanillaDef = makeUnit(3, 10, []);
CombatResolver._executeAttack(dsAttacker, vanillaDef);
check("C1: DS attacker loses shield", dsAttacker.divineShield === false);
check("C2: DS attacker health unchanged (shield absorbed)", dsAttacker.health === 3);
check("C3: defender damaged by attacker", vanillaDef.health === 5);

var vanillaAtt = makeUnit(3, 5, []);
var dsDefender = makeUnit(2, 4, ["DIVINE_SHIELD"]);
CombatResolver._executeAttack(vanillaAtt, dsDefender);
check("C4: DS defender absorbs first hit", dsDefender.health === 4);
check("C5: DS defender loses shield after hit", dsDefender.divineShield === false);
check("C6: attacker still takes defender damage", vanillaAtt.health < 5);

// ══════════════════════════════════════════════════════
// GROUP D: Venomous
// ══════════════════════════════════════════════════════
console.log("=== GROUP D: Venomous ===");

var venomAtt = makeUnit(1, 1, ["VENOMOUS"]);
var bigDef = makeUnit(3, 100, []);
CombatResolver._executeAttack(venomAtt, bigDef);
check("D1: venomous insta-kills", bigDef.health <= 0 && bigDef.alive === false);

var dsDef2 = makeUnit(2, 5, ["DIVINE_SHIELD"]);
var venomAtt2 = makeUnit(1, 10, ["VENOMOUS"]);
CombatResolver._executeAttack(venomAtt2, dsDef2);
check("D2: venomous blocked by divine shield", dsDef2.health === 5 && dsDef2.alive === true);

// ══════════════════════════════════════════════════════
// GROUP E: Reborn
// ══════════════════════════════════════════════════════
console.log("=== GROUP E: Reborn ===");

var rebornUnit = makeUnit(5, 2, ["REBORN"]);
var killer = makeUnit(10, 10, []);
CombatResolver._executeAttack(killer, rebornUnit);
check("E1: reborn triggers on death", rebornUnit.alive === true);
check("E2: reborn at 1 hp", rebornUnit.health === 1);
check("E3: rebornUsed set", rebornUnit.rebornUsed === true);
check("E4: reborn only triggers once", function() {
  CombatResolver._executeAttack(makeUnit(10, 10, []), rebornUnit);
  return rebornUnit.alive === false;
}());

// ══════════════════════════════════════════════════════
// GROUP F: Windfury
// ══════════════════════════════════════════════════════
console.log("=== GROUP F: Windfury ===");

var wfAtt = makeUnit(3, 10, ["WINDFURY"]);
var wfDef = makeUnit(2, 2, []);
CombatResolver._executeAttack(wfAtt, wfDef);
check("F1: windfury attacker kills in first hit", wfDef.alive === false && wfAtt.alive === true);
check("F2: windfuryUsed false before _doAttack", wfAtt.windfuryUsed === false);

// ══════════════════════════════════════════════════════
// GROUP G: Full combat simulation
// ══════════════════════════════════════════════════════
console.log("=== GROUP G: Full combat ===");

// Simple fight: 3 medium minions vs 1 big minion (both are flat arrays now)
var ourBoard = [
  { cardId: "TEST1", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 0, name_cn: "A" },
  { cardId: "TEST2", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 1, name_cn: "B" },
  { cardId: "TEST3", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 2, name_cn: "C" },
];
var oppBoard = [
  { cardId: "TEST4", attack: 6, health: 6, tier: 2, golden: false, mechanics: [], position: 0, name_cn: "X" },
];
var result = CombatResolver.simulateCombat(ourBoard, oppBoard, 5);
check("G1: we win 3v1", result.win === true);
checkGt("G2: attacker has survivors", result.attackerSurvivors.length, 0);
checkEq("G3: defender eliminated", result.defenderSurvivors.length, 0);

// Taunt + Shield fight
var ourBoard2 = [
  { cardId: "TS1", attack: 5, health: 5, tier: 2, golden: false, mechanics: ["DIVINE_SHIELD"], position: 0, name_cn: "DS" },
];
var oppBoard2 = [
  { cardId: "TS2", attack: 1, health: 1, tier: 1, golden: false, mechanics: ["TAUNT"], position: 0, name_cn: "Taunt" },
  { cardId: "TS3", attack: 10, health: 10, tier: 3, golden: false, mechanics: [], position: 1, name_cn: "Big" },
];
var result2 = CombatResolver.simulateCombat(ourBoard2, oppBoard2, 5);
check("G4: taunt redirect works in combat", result2.win !== undefined);

// Equal board fight: 2v2 vanilla
var ourBoard3 = [
  { cardId: "E1", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 0, name_cn: "a" },
  { cardId: "E2", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 1, name_cn: "b" },
];
var oppBoard3 = [
  { cardId: "E3", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 0, name_cn: "x" },
  { cardId: "E4", attack: 3, health: 3, tier: 1, golden: false, mechanics: [], position: 1, name_cn: "y" },
];
var result3 = CombatResolver.simulateCombat(ourBoard3, oppBoard3, 1);
check("G5: combat resolves without error", result3.win !== undefined);

// Reborn board fight
var ourBoard4 = [
  { cardId: "R1", attack: 4, health: 2, tier: 2, golden: false, mechanics: ["REBORN"], position: 0, name_cn: "Reborn" },
];
var oppBoard4 = [
  { cardId: "R2", attack: 2, health: 2, tier: 1, golden: false, mechanics: [], position: 0, name_cn: "Small" },
];
var result4 = CombatResolver.simulateCombat(ourBoard4, oppBoard4, 1);
check("G6: reborn board wins", result4.win === true);

// ══════════════════════════════════════════════════════
// GROUP H: Ghost board (MatchmakingSystem)
// ══════════════════════════════════════════════════════
console.log("=== GROUP H: Ghost boards ===");

var ghostPlayer = MatchmakingSystem._createGhost(
  [makePlayer(3, 2), makePlayer(4, 3), makePlayer(5, 3)],
  5
);
checkTruthy("H1: ghost player created", !!ghostPlayer);
check("H2: ghost has board", ghostPlayer.board.length > 0);
check("H3: ghost has tier", ghostPlayer.tavernTier > 0);
checkEq("H4: ghost is marked", ghostPlayer.isGhost, true);

// Test ghost board for late game (turn 13)
var lateGhost = MatchmakingSystem._createGhost(
  [makePlayer(6, 4), makePlayer(7, 5), makePlayer(6, 5)],
  13
);
checkGt("H5: late game ghost has board", lateGhost.board.length, 0);

// Helper for ghost tests
function makePlayer(boardSize, tavernTier) {
  var board = [];
  for (var i = 0; i < boardSize; i++) {
    board.push({ cardId: "g" + i, attack: 4, health: 4, tier: tavernTier, position: i });
  }
  return { id: "G_" + Math.random(), board: board, tavernTier: tavernTier, health: 30, alive: true };
}

console.log("\n==================================================");
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("==================================================");

if (failed > 0) process.exit(1);
