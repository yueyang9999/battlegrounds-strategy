"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var base = __dirname;

// Load simulation components
function loadSim(filename) {
  var code = fs.readFileSync(path.join(base, "simulation", filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: "simulation/" + filename });
}

loadSim("SeededRNG.js");
loadSim("DamageSystem.js");
loadSim("ArmorSystem.js");

var passed = 0, failed = 0;

function check(label, condition) {
  if (condition) { passed++; }
  else { console.error("FAIL: " + label); failed++; }
}

function checkEq(label, actual, expected) {
  if (actual === expected) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected " + expected + ")"); failed++; }
}

function checkApprox(label, actual, expected, tol) {
  if (Math.abs(actual - expected) <= (tol || 0.01)) { passed++; }
  else { console.error("FAIL: " + label + " (got " + actual + ", expected " + expected + ")"); failed++; }
}

// ══════════════════════════════════════════════════════
// GROUP A: Damage formula
// ══════════════════════════════════════════════════════
console.log("=== GROUP A: Damage formula ===");

// A1: Empty survivors = just tavern tier
var d1 = DamageSystem.calculateDamage(3, []);
checkEq("A1: no survivors = tavernTier", d1, 3);

// A2: Single survivor
var d2 = DamageSystem.calculateDamage(2, [{tier: 2}]);
checkEq("A2: t2 + 1 surv(tier 2)", d2, 4);

// A3: Multiple survivors
var d3 = DamageSystem.calculateDamage(4, [{tier: 2}, {tier: 3}, {tier: 5}]);
checkEq("A3: t4 + survs(2+3+5)", d3, 14);

// A4: Tier 6 + full board of tier 6s
var d4 = DamageSystem.calculateDamage(6, [
  {tier: 6}, {tier: 6}, {tier: 6}, {tier: 6}, {tier: 6}, {tier: 6}, {tier: 6}
]);
checkEq("A4: max possible damage", d4, 48);

// ══════════════════════════════════════════════════════
// GROUP B: Damage caps
// ══════════════════════════════════════════════════════
console.log("=== GROUP B: Damage caps ===");

// B1: Early game cap (turn 1-3)
checkEq("B1: turn 1, 8 alive → cap 5", DamageSystem.getCap(1, 8), 5);
checkEq("B1b: turn 3, 6 alive → cap 5", DamageSystem.getCap(3, 6), 5);

// B2: Mid game cap (turn 4-7)
checkEq("B2: turn 4, 7 alive → cap 10", DamageSystem.getCap(4, 7), 10);
checkEq("B2b: turn 7, 5 alive → cap 10", DamageSystem.getCap(7, 5), 10);

// B3: Late game cap (turn 8+)
checkEq("B3: turn 8, 6 alive → cap 15", DamageSystem.getCap(8, 6), 15);
checkEq("B3b: turn 12, 5 alive → cap 15", DamageSystem.getCap(12, 5), 15);

// B4: Final 4 — no cap
checkEq("B4: turn 5, 4 alive → no cap", DamageSystem.getCap(5, 4), Infinity);
checkEq("B4b: turn 10, 3 alive → no cap", DamageSystem.getCap(10, 3), Infinity);
checkEq("B4c: turn 8, 2 alive → no cap", DamageSystem.getCap(8, 2), Infinity);

// B5: applyCap
checkEq("B5: 12 dmg turn 2 → cap 5", DamageSystem.applyCap(12, 2, 8), 5);
checkEq("B5b: 8 dmg turn 5 → cap 8 (under 10)", DamageSystem.applyCap(8, 5, 7), 8);
checkEq("B5c: 20 dmg turn 9 → cap 15", DamageSystem.applyCap(20, 9, 6), 15);
checkEq("B5d: 25 dmg turn 9 4 alive → 25 (no cap)", DamageSystem.applyCap(25, 9, 4), 25);

// B6: cappedDamage convenience
checkEq("B6: full calc with cap", DamageSystem.cappedDamage(4, [{tier: 3}, {tier: 3}], 5, 7), 10);

// ══════════════════════════════════════════════════════
// GROUP C: Armor absorption
// ══════════════════════════════════════════════════════
console.log("=== GROUP C: Armor absorption ===");

// C1: Damage fully absorbed by armor
var p1 = { health: 30, armor: 10 };
ArmorSystem.applyDamage(p1, 5);
checkEq("C1: armor absorbs 5", p1.armor, 5);
checkEq("C1b: health unchanged", p1.health, 30);

// C2: Damage partially absorbed
var p2 = { health: 30, armor: 3 };
ArmorSystem.applyDamage(p2, 8);
checkEq("C2: armor depleted", p2.armor, 0);
checkEq("C2b: health lost 5", p2.health, 25);

// C3: Damage with no armor
var p3 = { health: 20, armor: 0 };
ArmorSystem.applyDamage(p3, 7);
checkEq("C3: health reduced", p3.health, 13);

// C4: Fatal damage
var p4 = { health: 5, armor: 0 };
ArmorSystem.applyDamage(p4, 10);
checkEq("C4: health goes negative", p4.health, -5);
check("C4b: player is dead", !ArmorSystem.isAlive(p4));

// C5: Armor doesn't keep alive
var p5 = { health: 0, armor: 10 };
check("C5: dead even with armor", !ArmorSystem.isAlive(p5));

// ══════════════════════════════════════════════════════
// GROUP D: Armor spells
// ══════════════════════════════════════════════════════
console.log("=== GROUP D: Armor spells ===");

// D1: Set armor to 5
var pd1 = { health: 10, armor: 0 };
ArmorSystem.applySetArmor(pd1, 5);
checkEq("D1: armor set to 5", pd1.armor, 5);

// D2: Set armor overrides existing
var pd2 = { health: 10, armor: 2 };
ArmorSystem.applySetArmor(pd2, 5);
checkEq("D2: old armor replaced", pd2.armor, 5);

// D3: Add armor
var pd3 = { health: 10, armor: 3 };
ArmorSystem.applyAddArmor(pd3, 10);
checkEq("D3: armor increased to 13", pd3.armor, 13);

// ══════════════════════════════════════════════════════
// GROUP E: HP-cost deduction
// ══════════════════════════════════════════════════════
console.log("=== GROUP E: HP cost deduction ===");

// E1: HP cost fully from armor
var pe1 = { health: 30, armor: 10 };
var r1 = ArmorSystem.deductCost(pe1, 3);
checkEq("E1: armor lost 3", r1.armorLost, 3);
checkEq("E1b: health unchanged", pe1.health, 30);

// E2: HP cost partially from armor
var pe2 = { health: 30, armor: 2 };
var r2 = ArmorSystem.deductCost(pe2, 5);
checkEq("E2: armor lost 2", r2.armorLost, 2);
checkEq("E2b: health lost 3", r2.healthLost, 3);
checkEq("E2c: health remaining 27", pe2.health, 27);

// E3: HP cost no armor
var pe3 = { health: 25, armor: 0 };
var r3 = ArmorSystem.deductCost(pe3, 3);
checkEq("E3: health lost 3", pe3.health, 22);

// ══════════════════════════════════════════════════════
// GROUP F: Patchwerk special case
// ══════════════════════════════════════════════════════
console.log("=== GROUP F: Edge cases ===");

// F1: Patchwerk 60 HP, 0 armor
var pf1 = { health: 0, armor: 0 };
ArmorSystem.initPlayer(pf1, "TB_BaconShop_HERO_34", {
  "TB_BaconShop_HERO_34": { card_type: "hero", health: 60, armor: 0 }
});
checkEq("F1: Patchwerk 60 HP", pf1.health, 60);
checkEq("F1b: Patchwerk 0 armor", pf1.armor, 0);

// F2: Normal hero 30/18
var pf2 = { health: 0, armor: 0 };
ArmorSystem.initPlayer(pf2, "TB_BaconShop_HERO_01", {
  "TB_BaconShop_HERO_01": { card_type: "hero", health: 30, armor: 18 }
});
checkEq("F2: Edwin 30 HP", pf2.health, 30);
checkEq("F2b: Edwin 18 armor", pf2.armor, 18);

// F3: Deduct zero cost
var pf3 = { health: 10, armor: 5 };
var r0 = ArmorSystem.deductCost(pf3, 0);
checkEq("F3: zero cost no loss", r0.armorLost + r0.healthLost, 0);

console.log("\n" + "=".repeat(50));
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);
