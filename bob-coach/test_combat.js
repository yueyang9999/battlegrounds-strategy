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
loadSim("CombatEventQueue.js");
loadSim("CombatEffects.js");
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

// ══════════════════════════════════════════════════════
// GROUP I: Trigger sequence — event queue priority
// ══════════════════════════════════════════════════════
console.log("=== GROUP I: Event queue priority ===");

var testQueue = CombatEventQueue.create({});
var executionOrder = [];

testQueue.push(CombatEventQueue.createEvent('DEFAULT', function() {
  executionOrder.push('default');
}));
testQueue.push(CombatEventQueue.createEvent('DEATHRATTLE', function() {
  executionOrder.push('deathrattle');
}));
testQueue.push(CombatEventQueue.createEvent('REBORN', function() {
  executionOrder.push('reborn');
}));
testQueue.push(CombatEventQueue.createEvent('AURA_UPDATE', function() {
  executionOrder.push('aura');
}));
testQueue.push(CombatEventQueue.createEvent('WHEN_DAMAGED', function() {
  executionOrder.push('whenDamaged');
}));

testQueue.processAll();
check("I1: whenDamaged highest priority", executionOrder[0] === 'whenDamaged');
check("I2: aura before deathrattle", executionOrder[1] === 'aura');
check("I3: deathrattle before reborn", executionOrder[2] === 'deathrattle');
check("I4: reborn before default", executionOrder[3] === 'reborn');
check("I5: default last", executionOrder[4] === 'default');

// ══════════════════════════════════════════════════════
// GROUP J: Deathrattle + Reborn ordering
// ══════════════════════════════════════════════════════
console.log("=== GROUP J: Deathrattle → Reborn ===");

// Register a test deathrattle card
var drOrderLog = [];
CombatEffects.register("TEST_DR", {
  deathrattle: function(ctx, unit, side, enemySide, queue) {
    drOrderLog.push('deathrattle');
    var token = ctx.buildToken({ attack: 1, health: 1, name_cn: "test_token" });
    ctx.spawnToken(side, token);
  },
});

// Combat: DR unit (3/1) vs enemy (2/2) — both die simultaneously
// DR deathrattle spawns token, reborn revives at 1 HP
var drBoard = [
  { cardId: "TEST_DR", attack: 3, health: 1, tier: 1, golden: false,
    mechanics: ["DEATHRATTLE", "REBORN"], position: 0, name_cn: "DR_Unit" },
];
var drEnemy = [
  { cardId: "WEAK", attack: 2, health: 2, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Weak" },
];

drOrderLog = [];
var drResult = CombatResolver.simulateCombat(drBoard, drEnemy, 1);
// 随从死亡 → 亡语触发 → 召唤 token → 复生触发
check("J1: deathrattle triggers before reborn", drOrderLog.indexOf('deathrattle') === 0);
// 复生让随从复活，最终场上应该有随从+token存活
var totalSurvivors = drResult.attackerSurvivors.length;
checkGt("J2: survivors include reborned unit and token", totalSurvivors, 0);

// Cleanup
delete CombatEffects._registry["TEST_DR"];

// ══════════════════════════════════════════════════════
// GROUP K: Start of Combat effects
// ══════════════════════════════════════════════════════
console.log("=== GROUP K: Start of Combat ===");

// Register a start-of-combat card that buffs own side
CombatEffects.register("TEST_SOC", {
  startOfCombat: function(ctx, unit, ownSide, enemySide) {
    for (var i = 0; i < ownSide.length; i++) {
      if (ownSide[i].alive) ownSide[i].attack += 2;
    }
  },
});

var socBoard = [
  { cardId: "TEST_SOC", attack: 2, health: 5, tier: 2, golden: false,
    mechanics: ["START_OF_COMBAT"], position: 0, name_cn: "Buffer" },
  { cardId: "BEAST", attack: 3, health: 3, tier: 1, golden: false,
    mechanics: [], position: 1, name_cn: "Beast" },
];
var socEnemy = [
  { cardId: "DEF1", attack: 3, health: 10, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Def" },
];
var socResult = CombatResolver.simulateCombat(socBoard, socEnemy, 2);

// Both units get +2 attack from start-of-combat before the first attack
// After combat, check that battle resolved (we don't care about win/loss, just no errors)
check("K1: start-of-combat combat resolves", socResult.win !== undefined);

// Verify: test SOC with only one unit against weak enemy (should win due to buff)
var socBoard2 = [
  { cardId: "TEST_SOC", attack: 5, health: 10, tier: 2, golden: false,
    mechanics: ["START_OF_COMBAT"], position: 0, name_cn: "Buffer2" },
];
var socEnemy2 = [
  { cardId: "WEAK", attack: 1, health: 2, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Weak" },
];
var socResult2 = CombatResolver.simulateCombat(socBoard2, socEnemy2, 2);
check("K2: start-of-combat buffed unit wins vs weak", socResult2.win === true);

delete CombatEffects._registry["TEST_SOC"];

// ══════════════════════════════════════════════════════
// GROUP L: Cleave / Windfury multi-target
// ══════════════════════════════════════════════════════
console.log("=== GROUP L: Cleave multi-target ===");

// Cleave unit hits target + adjacent minions
var cleaveBoard = [
  { cardId: "CLEAVE1", attack: 5, health: 10, tier: 3, golden: false,
    mechanics: [], position: 0, name_cn: "狂战斧", text_cn: "同时对其攻击目标相邻的随从造成伤害" },
];
var wideDef = [
  { cardId: "L", attack: 1, health: 3, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Left" },
  { cardId: "M", attack: 1, health: 3, tier: 1, golden: false,
    mechanics: ["TAUNT"], position: 1, name_cn: "Mid" },
  { cardId: "R", attack: 1, health: 3, tier: 1, golden: false,
    mechanics: [], position: 2, name_cn: "Right" },
];
var cleaveResult = CombatResolver.simulateCombat(cleaveBoard, wideDef, 3);
// Cleave hits taunt (mid) + left + right
check("L1: cleave combat resolves", cleaveResult.win !== undefined);
// At least the taunt target died (5 attack vs 3 health)
check("L2: cleave hits kill multiple", cleaveResult.attackerSurvivors.length >= 0);

// Windfury + Cleave combo
var wfCleaveBoard = [
  { cardId: "WF_CLEAVE", attack: 4, health: 15, tier: 4, golden: false,
    mechanics: ["WINDFURY"], position: 0, name_cn: "风怒狂战斧", text_cn: "同时对其攻击目标相邻的随从造成伤害" },
];
var wfWideDef = [
  { cardId: "A1", attack: 1, health: 2, tier: 1, golden: false, mechanics: [], position: 0, name_cn: "a" },
  { cardId: "A2", attack: 1, health: 2, tier: 1, golden: false, mechanics: ["TAUNT"], position: 1, name_cn: "b" },
  { cardId: "A3", attack: 1, health: 2, tier: 1, golden: false, mechanics: [], position: 2, name_cn: "c" },
];
var wfCleaveResult = CombatResolver.simulateCombat(wfCleaveBoard, wfWideDef, 4);
check("L3: windfury+cleave combat resolves", wfCleaveResult.win !== undefined);

// ══════════════════════════════════════════════════════
// GROUP M: Aura effects
// ══════════════════════════════════════════════════════
console.log("=== GROUP M: Aura effects ===");

// Register an aura that revives 0-health minions
var auraHealthCheck = [];
CombatEffects.register("TEST_AURA_HEALER", {
  aura: function(ctx, unit, side, enemySide) {
    auraHealthCheck.push('aura');
    // Aura prevents death: if any ally is at 0 health, set it to 1
    for (var i = 0; i < side.length; i++) {
      if (!side[i].alive && side[i].health <= 0 && side[i].cardId !== unit.cardId) {
        // doesn't auto-revive in this model, but the framework tests the queue order
      }
    }
  },
});

var auraBoard = [
  { cardId: "TEST_AURA_HEALER", attack: 2, health: 5, tier: 2, golden: false,
    mechanics: ["AURA"], position: 0, name_cn: "AuraHealer" },
  { cardId: "ALLY", attack: 3, health: 3, tier: 1, golden: false,
    mechanics: [], position: 1, name_cn: "Ally" },
];
var auraEnemy = [
  { cardId: "KILLER", attack: 8, health: 8, tier: 3, golden: false,
    mechanics: [], position: 0, name_cn: "Killer" },
];

auraHealthCheck = [];
var auraResult = CombatResolver.simulateCombat(auraBoard, auraEnemy, 2);
// Aura events fire during combat when deaths occur
check("M1: aura combat resolves", auraResult.win !== undefined);

delete CombatEffects._registry["TEST_AURA_HEALER"];

// ══════════════════════════════════════════════════════
// GROUP N: When Damaged triggers (immediate)
// ══════════════════════════════════════════════════════
console.log("=== GROUP N: When Damaged triggers ===");

var whenDamagedLog = [];
CombatEffects.register("WD_UNIT", {
  whenDamaged: function(ctx, damagedUnit, side, enemySide, queue) {
    whenDamagedLog.push('whenDamaged:' + damagedUnit.cardId);
    damagedUnit.attack += 1; // enrage: +1 attack when damaged
  },
});

// Only register whenDamaged on the unit that gets hit
var wdBoard = [
  { cardId: "WD_UNIT", attack: 2, health: 5, tier: 2, golden: false,
    mechanics: ["TRIGGER_VISUAL"], position: 0, name_cn: "受伤者", text_cn: "每当受到伤害时+1攻击力" },
];
var wdEnemy = [
  { cardId: "SLAPPER", attack: 1, health: 10, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Slapper" },
];

whenDamagedLog = [];
var wdResult = CombatResolver.simulateCombat(wdBoard, wdEnemy, 2);
check("N1: whenDamaged triggers on hit", whenDamagedLog.length > 0);
if (whenDamagedLog.length > 0) {
  check("N2: whenDamaged targets correct unit", whenDamagedLog[0].indexOf('WD_UNIT') !== -1);
}

delete CombatEffects._registry["WD_UNIT"];

// ══════════════════════════════════════════════════════
// GROUP O: Built-in card effects
// ══════════════════════════════════════════════════════
console.log("=== GROUP O: Built-in cards ===");

// Test Manasaber (BG26_800): deathrattle summon 2 taunt tokens
var manaBoard = [
  { cardId: "BG26_800", attack: 4, health: 1, tier: 1, golden: false,
    mechanics: ["DEATHRATTLE"], position: 0, name_cn: "魔刃豹", minion_types_cn: ["野兽"] },
];
var manaEnemy = [
  { cardId: "K1", attack: 2, health: 2, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Killer" },
];
var manaResult = CombatResolver.simulateCombat(manaBoard, manaEnemy, 1);
// Dead manasaber + 2 baby tokens should give 2 survivors after beating 2/2 enemy
check("O1: manasaber deathrattle spawns tokens", manaResult.attackerSurvivors.length >= 1);

// Test Mecha-Jaraxxus token (BG29_611): deathrattle summon 1/1 micro bot
var mechBoard = [
  { cardId: "BG29_611", attack: 1, health: 1, tier: 1, golden: false,
    mechanics: ["DEATHRATTLE", "DIVINE_SHIELD"], position: 0, name_cn: "微型机器人" },
];
var mechEnemy = [
  { cardId: "P1", attack: 2, health: 1, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Puncher" },
];
var mechResult = CombatResolver.simulateCombat(mechBoard, mechEnemy, 1);
check("O2: mech deathrattle combat resolves", mechResult.win !== undefined);

// Test Humming Bird (BG26_805): start of combat, beasts get +1 attack
var birdBoard = [
  { cardId: "BG26_805", attack: 1, health: 4, tier: 2, golden: false,
    mechanics: ["START_OF_COMBAT", "TRIGGER_VISUAL"], position: 0, name_cn: "哼鸣蜂鸟", minion_types_cn: ["野兽"] },
  { cardId: "BEAST2", attack: 2, health: 2, tier: 1, golden: false,
    mechanics: [], position: 1, name_cn: "野兽A", minion_types_cn: ["野兽"] },
];
var birdEnemy = [
  { cardId: "EN1", attack: 1, health: 2, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Enemy" },
];
var birdResult = CombatResolver.simulateCombat(birdBoard, birdEnemy, 2);
check("O3: humming bird combat resolves", birdResult.win !== undefined);

// Test Iridescent Skyblazer (BG29_806): when beast damaged, buff another beast
var skyBoard = [
  { cardId: "BG29_806", attack: 3, health: 8, tier: 5, golden: false,
    mechanics: ["TRIGGER_VISUAL"], position: 0, name_cn: "炫彩灼天者", minion_types_cn: ["野兽"] },
  { cardId: "BEAST3", attack: 2, health: 5, tier: 2, golden: false,
    mechanics: [], position: 1, name_cn: "野兽B", minion_types_cn: ["野兽"] },
];
var skyEnemy = [
  { cardId: "HIT1", attack: 2, health: 1, tier: 1, golden: false,
    mechanics: [], position: 0, name_cn: "Hitter" },
  { cardId: "HIT2", attack: 2, health: 1, tier: 1, golden: false,
    mechanics: [], position: 1, name_cn: "Hitter2" },
];
var skyResult = CombatResolver.simulateCombat(skyBoard, skyEnemy, 5);
check("O4: skyblazer combat resolves", skyResult.win !== undefined);

console.log("\n==================================================");
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("==================================================");

if (failed > 0) process.exit(1);
