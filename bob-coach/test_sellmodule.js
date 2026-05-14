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
loadModule("modules/SellModule.js");

var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));

var passed = 0;
var failed = 0;

function check(label, condition) {
  if (condition) { passed++; }
  else { console.error("FAIL: " + label); failed++; }
}

function checkTruthy(label, val) { check(label, !!val); }
function checkFalsy(label, val) { check(label, !val); }
function checkGt(label, actual, expected) {
  if (actual > expected) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected > " + expected + ")"); failed++; }
}

function makeMinion(cardId, name, tier, atk, hp, tribes, mechanics) {
  return { cardId: cardId, name_cn: name, tier: tier, attack: atk, health: hp,
           tribes_cn: tribes || [], mechanics: mechanics || [], position: 0 };
}

function makeCtx(overrides) {
  var base = {
    turn: 8, gold: 10, maxGold: 8, tavernTier: 4, health: 20,
    heroCardId: "TEST_HERO", heroName: "Test",
    boardMinions: [], shopMinions: [], shopSpells: [],
    gamePhase: "recruit", boardPower: 2.0,
    dominantTribe: null, compMatches: [], currentComp: null,
    curveType: "standard", decisionTables: dt,
    heroPowerCost: 1, heroPowerUsable: true,
  };
  if (overrides) {
    for (var k in overrides) { base[k] = overrides[k]; }
  }
  return base;
}

// ══════════════════════════════════════════════════════
// GROUP A: Empty / edge cases
// ══════════════════════════════════════════════════════
console.log("=== GROUP A: Empty / edge cases ===");

var sellMod = new SellModule(dt);

var r1 = sellMod.evaluate(null);
check("A1: null ctx returns empty", r1.length === 0);

var r2 = sellMod.evaluate(makeCtx({ boardMinions: [], shopMinions: [] }));
check("A2: empty board returns empty", r2.length === 0);

var r3 = sellMod.evaluate(makeCtx({
  boardMinions: [makeMinion("C1", "好卡", 4, 5, 5, ["龙"])],
  shopMinions: [],
  tavernTier: 4,
}));
check("A3: single good minion, no trigger", r3.length === 0);

// ══════════════════════════════════════════════════════
// GROUP B: Full board + high value shop card
// ══════════════════════════════════════════════════════
console.log("=== GROUP B: Full board + high value shop ===");

// 7 minions on board, shop has a weight-9 card (core value)
var boardB = [];
for (var i = 0; i < 7; i++) {
  boardB.push(makeMinion("B" + i, "弱卡" + i, 2, 2, 2, ["野兽"]));
}
// Add one really weak minion at position 3
boardB[3] = makeMinion("WEAK", "超弱卡", 1, 1, 1, []);

// Shop has 铜须 (weight 10 neutral core)
var shopB = [
  { cardId: "BG_LOE_077", name_cn: "铜须", tier: 5, attack: 5, health: 5, tribes_cn: [], mechanics: [], position: 0 },
];

var r4 = sellMod.evaluate(makeCtx({
  boardMinions: boardB,
  shopMinions: shopB,
  tavernTier: 5,
  dominantTribe: null,
}));
check("B1: full board + high value shop triggers sell", r4.length > 0);
check("B2: sell targets weakest minion", r4.some(function(d) { return d.data.cardId === "WEAK"; }));

// ══════════════════════════════════════════════════════
// GROUP C: Tier gap trigger
// ══════════════════════════════════════════════════════
console.log("=== GROUP C: Tier gap trigger ===");

var boardC = [
  makeMinion("LOW", "低级卡", 1, 1, 1, []),
  makeMinion("MID", "中级卡", 3, 3, 3, ["恶魔"]),
];
var r5 = sellMod.evaluate(makeCtx({
  boardMinions: boardC,
  shopMinions: [makeMinion("SHOP1", "商店卡", 1, 2, 2, [])],
  tavernTier: 5,
}));
check("C1: tier gap >= 3 triggers sell", r5.some(function(d) { return d.data.cardId === "LOW"; }));

// ══════════════════════════════════════════════════════
// GROUP D: Tribe mismatch trigger
// ══════════════════════════════════════════════════════
console.log("=== GROUP D: Tribe mismatch trigger ===");

var boardD = [
  makeMinion("D1", "龙1", 3, 3, 3, ["龙"]),
  makeMinion("D2", "龙2", 3, 3, 3, ["龙"]),
  makeMinion("D3", "龙3", 3, 3, 3, ["龙"]),
  makeMinion("FISH", "鱼人", 3, 3, 3, ["鱼人"]),
];
var r6 = sellMod.evaluate(makeCtx({
  boardMinions: boardD,
  shopMinions: [],
  tavernTier: 4,
  dominantTribe: "龙",
}));
check("D1: tribe mismatch triggers sell", r6.some(function(d) { return d.data.cardId === "FISH"; }));
check("D2: 龙 minions not flagged", !r6.some(function(d) { return d.data.cardId === "D1" || d.data.cardId === "D2" || d.data.cardId === "D3"; }));

// ══════════════════════════════════════════════════════
// GROUP E: Decision contract
// ══════════════════════════════════════════════════════
console.log("=== GROUP E: Decision contract ===");

var boardE = [
  makeMinion("LOW2", "低级卡2", 1, 1, 1, []),
  makeMinion("MID2", "中级卡2", 3, 4, 4, ["机械"]),
];
var r7 = sellMod.evaluate(makeCtx({
  boardMinions: boardE,
  shopMinions: [],
  tavernTier: 5,
}));

checkGt("E1: sell decisions exist", r7.length, 0);
var d = r7[0];
check("E2: type is sell_minion", d.type === "sell_minion");
check("E3: priority is SELL_MINION", d.priority === DecisionPriority.SELL_MINION);
checkTruthy("E4: has message", d.message);
checkTruthy("E5: has reason", d.reason);
checkTruthy("E6: has cardId in data", d.data && d.data.cardId);
check("E7: has sellPrice in data", d.data && typeof d.data.sellPrice === "number");
check("E8: has confidence", typeof d.confidence === "number" && d.confidence > 0);

// ══════════════════════════════════════════════════════
// GROUP F: Multiple sell targets
// ══════════════════════════════════════════════════════
console.log("=== GROUP F: Multiple sell targets ===");

var boardF = [
  makeMinion("T1_HIGH", "高随从", 4, 4, 4, ["龙"]),
  makeMinion("T1_LOW", "低随从", 1, 1, 1, []),
];
var r8 = sellMod.evaluate(makeCtx({
  boardMinions: boardF,
  shopMinions: [],
  tavernTier: 5,
}));
check("F1: only low tier recommended", r8.length === 1 && r8[0].data.cardId === "T1_LOW");

// ══════════════════════════════════════════════════════
// GROUP G: No false positives
// ══════════════════════════════════════════════════════
console.log("=== GROUP G: No false positives ===");

var boardG = [
  makeMinion("G1", "好随从1", 4, 5, 5, ["龙"]),
  makeMinion("G2", "好随从2", 5, 6, 6, ["龙"]),
  makeMinion("G3", "好随从3", 4, 5, 5, ["龙"]),
];
var r9 = sellMod.evaluate(makeCtx({
  boardMinions: boardG,
  shopMinions: [],
  tavernTier: 4,
  dominantTribe: "龙",
}));
check("G1: all good minions, no sell", r9.length === 0);

// ══════════════════════════════════════════════════════
console.log("==================================================");
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("==================================================");

if (failed > 0) process.exit(1);
