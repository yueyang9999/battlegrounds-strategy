"use strict";
var vm = require("vm");
var fs = require("fs");
var path = require("path");

var base = __dirname;

function loadSim(filename) {
  var code = fs.readFileSync(path.join(base, "simulation", filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: "simulation/" + filename });
}

loadSim("SeededRNG.js");
loadSim("MatchmakingSystem.js");

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

// Helper: make a simple player
function makePlayer(id, boardSize, health, tavernTier) {
  var board = [];
  for (var i = 0; i < boardSize; i++) {
    board.push({ cardId: "test_" + i, attack: 3, health: 3, tier: tavernTier || 2, position: i });
  }
  return { id: id, board: board, tavernTier: tavernTier || 3, health: health || 30, alive: true };
}

// ══════════════════════════════════════════════════════
// GROUP A: Basic pairing (even players)
// ══════════════════════════════════════════════════════
console.log("=== GROUP A: Basic pairing ===");

var rngA = new SeededRNG(42);
var players4 = [
  makePlayer("P1", 5), makePlayer("P2", 4),
  makePlayer("P3", 3), makePlayer("P4", 5),
];
var pairs4 = MatchmakingSystem.pair(players4, [], 3, rngA);
checkEq("A1: 4 players → 2 pairs", pairs4.length, 2);
checkEq("A2: pair[0] has 2 players", pairs4[0].length, 2);
checkEq("A3: pair[1] has 2 players", pairs4[1].length, 2);

// A4: All 4 players are assigned exactly once
var assigned = {};
for (var i = 0; i < pairs4.length; i++) {
  assigned[pairs4[i][0].id] = (assigned[pairs4[i][0].id] || 0) + 1;
  if (pairs4[i][1]) assigned[pairs4[i][1].id] = (assigned[pairs4[i][1].id] || 0) + 1;
}
checkEq("A4: all players assigned exactly once", assigned["P1"] + assigned["P2"] + assigned["P3"] + assigned["P4"], 4);

// A5: 8 players → 4 pairs
var rngA5 = new SeededRNG(50);
var players8 = [];
for (var i = 0; i < 8; i++) players8.push(makePlayer("P8_" + i, 4));
var pairs8 = MatchmakingSystem.pair(players8, [], 5, rngA5);
checkEq("A5: 8 players → 4 pairs", pairs8.length, 4);

// ══════════════════════════════════════════════════════
// GROUP B: Odd player (ghost)
// ══════════════════════════════════════════════════════
console.log("=== GROUP B: Ghost (odd players) ===");

var rngB = new SeededRNG(99);
var players3 = [
  makePlayer("Q1", 5), makePlayer("Q2", 4), makePlayer("Q3", 3),
];
var pairs3 = MatchmakingSystem.pair(players3, [], 4, rngB);
checkEq("B1: 3 players → 2 pairs (one ghost)", pairs3.length, 2);
var hasGhost = false;
for (var i = 0; i < pairs3.length; i++) {
  for (var j = 0; j < pairs3[i].length; j++) {
    if (pairs3[i][j] && pairs3[i][j].isGhost) hasGhost = true;
  }
}
check("B2: ghost fills odd slot", hasGhost);

// B3: Ghost has a board
var ghost = null;
for (var i = 0; i < pairs3.length; i++) {
  for (var j = 0; j < pairs3[i].length; j++) {
    if (pairs3[i][j] && pairs3[i][j].isGhost) ghost = pairs3[i][j];
  }
}
check("B3: ghost has board", ghost && ghost.board && ghost.board.length > 0);
check("B4: ghost has tavernTier", ghost && ghost.tavernTier > 0);
check("B5: ghost not counted as real player", ghost && ghost.isGhost === true);

// ══════════════════════════════════════════════════════
// GROUP C: History tracking (no consecutive same opponent)
// ══════════════════════════════════════════════════════
console.log("=== GROUP C: History tracking ===");

var rngC = new SeededRNG(77);
var p8 = [];
for (var i = 1; i <= 8; i++) p8.push(makePlayer("H" + i, 4));

// Round 1 pairing
var round1 = MatchmakingSystem.pair(p8, [], 3, rngC);
var round1History = [round1.map(function(p) { return [p[0].id, p[1] ? p[1].id : null]; })];

// Round 2 pairing (should avoid same pairs)
var rngC2 = new SeededRNG(78);
var round2 = MatchmakingSystem.pair(p8, round1History, 4, rngC2);

// Check that no pair in round2 matches a pair in round1
var repeatedPairs = 0;
for (var i = 0; i < round2.length; i++) {
  var r2ids = [round2[i][0].id, round2[i][1] ? round2[i][1].id : null].sort().join(",");
  for (var j = 0; j < round1.length; j++) {
    var r1ids = [round1[j][0].id, round1[j][1] ? round1[j][1].id : null].sort().join(",");
    if (r2ids === r1ids) repeatedPairs++;
  }
}
check("C1: matchmaking avoids repeated pairs (most pairs new)", repeatedPairs < round2.length);

// C2: Round 2 pairs all different (each player fights a different opponent vs round1)
var opponentR1 = {};
for (var i = 0; i < round1.length; i++) {
  opponentR1[round1[i][0].id] = round1[i][1] ? round1[i][1].id : null;
  if (round1[i][1]) opponentR1[round1[i][1].id] = round1[i][0].id;
}
var opponentR2 = {};
for (var i = 0; i < round2.length; i++) {
  opponentR2[round2[i][0].id] = round2[i][1] ? round2[i][1].id : null;
  if (round2[i][1]) opponentR2[round2[i][1].id] = round2[i][0].id;
}
var diffOppCount = 0;
for (var pid in opponentR1) {
  if (opponentR2[pid] && opponentR2[pid] !== opponentR1[pid]) diffOppCount++;
}
check("C2: most players fight different opponent in round2 (" + diffOppCount + "/8)", diffOppCount >= 6);

// ══════════════════════════════════════════════════════
// GROUP D: Edge cases
// ══════════════════════════════════════════════════════
console.log("=== GROUP D: Edge cases ===");

// D1: Empty player list
var rngD = new SeededRNG(1);
var pairsEmpty = MatchmakingSystem.pair([], [], 1, rngD);
checkEq("D1: empty → 0 pairs", pairsEmpty.length, 0);

// D2: Single player (last one alive)
var pairs1 = MatchmakingSystem.pair([makePlayer("Solo", 7)], [], 10, rngD);
checkEq("D2: 1 player → 1 pair (solo)", pairs1.length, 1);
check("D2b: solo player gets null opponent", pairs1[0][1] === null);

// D3: 5 players → 3 pairs (one ghost)
var rngD3 = new SeededRNG(33);
var p5 = [];
for (var i = 1; i <= 5; i++) p5.push(makePlayer("O" + i, 4));
var pairs5 = MatchmakingSystem.pair(p5, [], 6, rngD3);
checkEq("D3: 5 players → 3 pairs", pairs5.length, 3);

// D4: 2 players → 1 pair
var rngD4 = new SeededRNG(55);
var p2 = [makePlayer("L1", 6), makePlayer("L2", 3)];
var pairs2 = MatchmakingSystem.pair(p2, [], 8, rngD4);
checkEq("D4: 2 players → 1 pair", pairs2.length, 1);

console.log("\n" + "=".repeat(50));
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);
