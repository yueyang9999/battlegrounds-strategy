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
loadModule("modules/MinionPickModule.js");

var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var cardsById = {};
for (var i = 0; i < cardsArr.length; i++) {
  cardsById[cardsArr[i].str_id] = cardsArr[i];
}

var m = new MinionPickModule(dt);
var passed = 0, failed = 0;

function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)); }
}

function checkTruthy(label, actual) {
  if (actual) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected truthy, got " + JSON.stringify(actual)); }
}

function firstPick(decisions) {
  for (var i = 0; i < decisions.length; i++) {
    if (decisions[i].type === "minion_pick") return decisions[i];
  }
  return null;
}

function makeCtx(o) {
  o = o || {};
  return {
    turn: o.turn || 5, gold: o.gold !== undefined ? o.gold : 8, tavernTier: o.tavernTier || 3,
    health: o.health || 30, heroCardId: o.heroCardId || "", boardMinions: o.boardMinions || [],
    shopMinions: o.shopMinions || [], shopSpells: [], activeAnomaly: o.activeAnomaly || null,
    activeRewards: o.activeRewards || [], trinketOffer: o.trinketOffer || [],
    curveType: "standard", decisionTables: dt, _cardsById: cardsById,
    _compCoreCardIds: o._compCoreCardIds || new Set(),
    dominantTribe: o.dominantTribe || null,
  };
}

// ======================
// GROUP A: Triple detection
// ======================
console.log("=== GROUP A: Triple detection ===");

// A1: 2 copies on board -> buying 3rd = triple
var a1 = firstPick(m.evaluate(makeCtx({
  boardMinions: [
    { cardId: "BG24_009", name_cn: "挑食魔犬", golden: false },
    { cardId: "BG24_009", name_cn: "挑食魔犬", golden: false },
  ],
  shopMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", position: 0 }],
})));
checkTruthy("A1.triple detected", a1 && a1.data.canTriple);
checkTruthy("A1.label has 碰", a1 && a1.message.indexOf("碰") !== -1);
checkTruthy("A1.golden effect predicted", a1 && a1.data.goldenEffectHint.length > 0);

// A2: 1 copy -> pair, not triple
var a2 = firstPick(m.evaluate(makeCtx({
  boardMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", golden: false }],
  shopMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", position: 0 }],
})));
check("A2.pair canTriple=false", a2 && a2.data.canTriple, false);

// A3: Already have golden core card -> still valuable but not marked triple
var a3 = firstPick(m.evaluate(makeCtx({
  boardMinions: [
    { cardId: "BGS_041", name_cn: "碧蓝幼龙", golden: true },
  ],
  dominantTribe: "龙",
  shopMinions: [{ cardId: "BGS_041", name_cn: "碧蓝幼龙", position: 0 }],
})));
checkTruthy("A3.golden exists still pickable", a3 !== null);
check("A3.golden exists canTriple=false", a3 && a3.data.canTriple, false);

// A4: Deathrattle card golden effect
var a4 = firstPick(m.evaluate(makeCtx({
  boardMinions: [
    { cardId: "BG26_800", name_cn: "魔刃豹", golden: false },
    { cardId: "BG26_800", name_cn: "魔刃豹", golden: false },
  ],
  shopMinions: [{ cardId: "BG26_800", name_cn: "魔刃豹", position: 0 }],
})));
checkTruthy("A4.dr golden effect", a4 && a4.data.goldenEffectHint.indexOf("亡语") !== -1);

// A5: BC+Shield card -> golden effect mentions 战吼
var a5 = firstPick(m.evaluate(makeCtx({
  boardMinions: [
    { cardId: "BG32_236", name_cn: "夺金健将", golden: false },
    { cardId: "BG32_236", name_cn: "夺金健将", golden: false },
  ],
  shopMinions: [{ cardId: "BG32_236", name_cn: "夺金健将", position: 0 }],
})));
checkTruthy("A5.bc golden effect", a5 && a5.data.goldenEffectHint.indexOf("战吼") !== -1);

// ======================
// GROUP B: 2-copy triple rules
// ======================
console.log("\n=== GROUP B: 2-copy triple rules ===");

// B1: double speed hero -> only 2 copies for triple
var b1 = firstPick(m.evaluate(makeCtx({
  heroCardId: "BG34_HERO_002",
  boardMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", golden: false }],
  shopMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", position: 0 }],
})));
checkTruthy("B1.doubleSpeed: canTriple=true", b1 && b1.data.canTriple);
checkTruthy("B1.reason mentions 2张", b1 && b1.reason.indexOf("仅需2张") !== -1);

// B2: false idol anomaly -> only 2 copies
var b2 = firstPick(m.evaluate(makeCtx({
  activeAnomaly: "BG27_Anomaly_301",
  boardMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", golden: false }],
  shopMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", position: 0 }],
})));
checkTruthy("B2.anomaly: canTriple=true", b2 && b2.data.canTriple);

// B3: Normal -> 3 copies needed
var b3 = firstPick(m.evaluate(makeCtx({
  boardMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", golden: false }],
  shopMinions: [{ cardId: "BG24_009", name_cn: "挑食魔犬", position: 0 }],
})));
check("B3.normal: canTriple=false", b3 && b3.data.canTriple, false);

// ======================
// GROUP C: Discover minion detection
// ======================
console.log("\n=== GROUP C: Discover minion detection ===");

// C1: 蛮鱼斥候 is discover
var c1 = firstPick(m.evaluate(makeCtx({
  shopMinions: [{ cardId: "BGS_020", name_cn: "蛮鱼斥候", position: 0 }],
})));
checkTruthy("C1.discover minion", c1 && c1.data.isDiscoverMinion);

// C2: Non-discover minion
var c2 = firstPick(m.evaluate(makeCtx({
  shopMinions: [{ cardId: "BGS_001", name_cn: "鱼人潮猎人", position: 0 }],
})));
check("C2.non-discover", c2 && c2.data.isDiscoverMinion, false);

// C3: 竞技表演者 discovers tavern spell
var c3 = firstPick(m.evaluate(makeCtx({
  shopMinions: [{ cardId: "BG28_550", name_cn: "竞技表演者", position: 0 }],
})));
checkTruthy("C3.battlecry discover spell", c3 && c3.data.isDiscoverMinion);

// C4: Discover minion picked even without weight if it's the only highlight
var c4 = firstPick(m.evaluate(makeCtx({
  shopMinions: [{ cardId: "BG34_523", name_cn: "猎食的虎鲨", position: 0 }],
})));
checkTruthy("C4.discover beast minion", c4 && c4.data.isDiscoverMinion);

console.log("\n" + "=".repeat(50));
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);
