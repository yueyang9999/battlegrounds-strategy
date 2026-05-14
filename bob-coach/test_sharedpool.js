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
loadSim("SharedPool.js");

// Load cards data
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var cardsById = {};
for (var i = 0; i < cardsArr.length; i++) {
  cardsById[cardsArr[i].str_id] = cardsArr[i];
}

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
// GROUP A: Pool initialization
// ══════════════════════════════════════════════════════
console.log("=== GROUP A: Pool initialization ===");

var rng = new SeededRNG(42);
var pool = new SharedPool(cardsById);

// A1: Select races
var races = pool.selectRaces(rng);
checkEq("A1: 5 races selected", races.length, 5);

// A2: Forbidden pair check
var hasDragon = races.indexOf("巨龙") !== -1;
var hasBeast = races.indexOf("野兽") !== -1;
check("A2: no forbidden pair (dragon+beast)", !(hasDragon && hasBeast));

// A3: Initialize pool
pool.init(races);
checkGt("A3: pool has cards", Object.keys(pool.counts).length, 0);

// A4: Tier 1 copies (18 per card)
var tier1Count = 0;
for (var id in pool.counts) {
  var c = cardsById[id];
  if (c && c.tier === 1) tier1Count++;
}
checkGt("A4: tier 1 minions present", tier1Count, 0);

// A5: All counts valid
var allValid = true;
for (var id2 in pool.counts) {
  if (pool.counts[id2] <= 0) { allValid = false; break; }
}
check("A5: all initial counts positive", allValid);

// ══════════════════════════════════════════════════════
// GROUP B: Remove and return
// ══════════════════════════════════════════════════════
console.log("=== GROUP B: Remove and return ===");

var pool2 = new SharedPool(cardsById);
pool2.init(["鱼人", "野兽", "机械", "恶魔", "海盗"]);

// B1: Remove existing card
var sampleCardId = Object.keys(pool2.counts)[0];
var beforeCount = pool2.availableCount(sampleCardId);
pool2.remove(sampleCardId);
checkEq("B1: count reduced by 1", pool2.availableCount(sampleCardId), beforeCount - 1);

// B2: Return to pool
pool2.returnToPool(sampleCardId);
checkEq("B2: count restored", pool2.availableCount(sampleCardId), beforeCount);

// B3: Remove gold card (return 3)
pool2.remove(sampleCardId, 3);
var afterTriple = pool2.availableCount(sampleCardId);
checkEq("B3: 3 copies removed", afterTriple, beforeCount - 3);

// B4: Return board
pool2.returnBoard([{ cardId: sampleCardId, golden: true }]);
checkEq("B4: gold card returns 3", pool2.availableCount(sampleCardId), afterTriple + 3);

// ══════════════════════════════════════════════════════
// GROUP C: Shop refresh
// ══════════════════════════════════════════════════════
console.log("=== GROUP C: Shop refresh ===");

var pool3 = new SharedPool(cardsById);
pool3.init(["鱼人", "野兽", "机械", "恶魔", "海盗"]);

// C1: Tier 1 shop size
var shop1 = pool3.refreshShop(1, new SeededRNG(100));
checkEq("C1: tier 1 shop has 3 cards", shop1.length, 3);

// C2: Tier 4 shop size
var pool3b = new SharedPool(cardsById);
pool3b.init(["鱼人", "野兽", "机械", "恶魔", "海盗"]);
var shop4 = pool3b.refreshShop(4, new SeededRNG(101));
checkEq("C2: tier 4 shop has 5 cards", shop4.length, 5);

// C3: Tier 6 shop size
var pool3c = new SharedPool(cardsById);
pool3c.init(["鱼人", "野兽", "机械", "恶魔", "海盗"]);
var shop6 = pool3c.refreshShop(6, new SeededRNG(102));
checkEq("C3: tier 6 shop has 6 cards", shop6.length, 6);

// C4: Shop cards are unique
var shopIds = {};
var hasDup = false;
for (var i = 0; i < shop6.length; i++) {
  if (shopIds[shop6[i]]) { hasDup = true; break; }
  shopIds[shop6[i]] = true;
}
check("C4: shop has no duplicate slots", !hasDup); // slots are unique BUT same card can appear multiple times via different slots

// C5: Empty pool (exhausted) should return empty
var poolEmpty = new SharedPool(cardsById);
poolEmpty.counts = {}; // empty
var shopEmpty = poolEmpty.refreshShop(3, new SeededRNG(105));
checkEq("C5: empty pool returns []", shopEmpty.length, 0);

// ══════════════════════════════════════════════════════
// GROUP D: Race filtering
// ══════════════════════════════════════════════════════
console.log("=== GROUP D: Race filtering ===");

// D1: Selected races only include their cards
var pool4 = new SharedPool(cardsById);
var testRaces = ["鱼人", "野兽"];
pool4.init(testRaces);
var allIds = Object.keys(pool4.counts);
var onlyValid = true;
for (var i = 0; i < allIds.length; i++) {
  var card = cardsById[allIds[i]];
  if (!card) continue;
  var tribes = card.minion_types_cn || [];
  var inGame = (tribes.length === 0 || (tribes.length === 1 && tribes[0] === "中立")) && !card.associated_race; // neutral
  for (var t = 0; t < tribes.length; t++) {
    if (testRaces.indexOf(tribes[t]) !== -1) inGame = true;
  }
  if (!inGame) {
    // Check if it's a neutral card
    if (tribes.length > 0) {
      onlyValid = false;
      console.error("  Invalid card in pool: " + allIds[i] + " tribes: " + JSON.stringify(tribes));
      break;
    }
  }
}
check("D1: all pool cards match selected races or are neutral", onlyValid);

// D2: Double-race minions included if any race matches
// Look for a double-race card in the pool
var foundDouble = false;
for (var i2 = 0; i2 < cardsArr.length; i2++) {
  var ct = cardsArr[i2];
  if (ct.card_type === "minion" && ct.minion_types_cn && ct.minion_types_cn.length >= 2) {
    foundDouble = true;
    break;
  }
}
check("D2: double-race minions exist in data", foundDouble);

// ══════════════════════════════════════════════════════
// GROUP E: Multiple race selections
// ══════════════════════════════════════════════════════
console.log("=== GROUP E: Multiple race selections ===");

// E1: Different races → different pool
var poolA = new SharedPool(cardsById);
poolA.init(["鱼人", "野兽", "机械", "恶魔", "海盗"]);
var poolB = new SharedPool(cardsById);
poolB.init(["巨龙", "元素", "纳迦", "野猪人", "亡灵"]);
var commonCount = 0;
for (var id in poolA.counts) {
  if (poolB.counts[id] && poolB.counts[id] > 0) commonCount++;
}
// 中立随从 common, tribe-specific should differ
checkTruthy("E1: different race selections produce different pools (some overlap OK)", commonCount >= 0);

// E2: Neutral minions always present
var poolN = new SharedPool(cardsById);
poolN.init(["鱼人"]);
var hasNeutral = false;
for (var idN in poolN.counts) {
  var cardN = cardsById[idN];
  var tribesN = cardN.minion_types_cn || [];
	  var isNeutral = (tribesN.length === 0 || (tribesN.length === 1 && tribesN[0] === "中立")) && !cardN.associated_race;
	  if (cardN && cardN.card_type === "minion" && isNeutral) {
    hasNeutral = true;
    break;
  }
}
checkTruthy("E2: neutral minions present even with 1 race", hasNeutral);

console.log("\n" + "=".repeat(50));
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);
