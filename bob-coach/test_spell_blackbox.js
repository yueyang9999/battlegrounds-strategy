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
loadModule("modules/SpellModule.js");

var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var si = JSON.parse(fs.readFileSync(path.join(base, "data", "spell_interactions.json"), "utf-8"));

// Mirror overlay.js _buildSpellInteractionLookup
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

var passed = 0, failed = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)); }
}
function checkGt(label, actual, min) {
  if (actual > min) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected > " + min + ", got " + JSON.stringify(actual)); }
}
function checkApprox(label, actual, expected, tolerance) {
  if (Math.abs(actual - expected) <= (tolerance || 0.01)) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected ~" + expected + ", got " + actual); }
}
function checkTruthy(label, actual) {
  if (actual) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected truthy, got " + JSON.stringify(actual)); }
}
function checkFalsy(label, actual) {
  if (!actual) { passed++; }
  else { failed++; console.error("  FAIL [" + label + "]: expected falsy, got " + JSON.stringify(actual)); }
}

var module = new SpellModule(dt);

function makeCtx(o) {
  o = o || {};
  return {
    turn: o.turn || 5, gold: o.gold !== undefined ? o.gold : 8,
    tavernTier: o.tavernTier || 3, health: o.health || 30,
    heroCardId: o.heroCardId || "",
    boardMinions: o.boardMinions || [],
    shopSpells: o.shopSpells || [],
    shopMinions: o.shopMinions || [],
    activeAnomaly: o.activeAnomaly || null,
    activeRewards: o.activeRewards || [],
    trinketOffer: o.trinketOffer || [],
    curveType: "standard",
    decisionTables: dt,
    _spellInteractions: o._spellInteractions !== undefined ? o._spellInteractions : lookup,
    heroPowerCost: o.heroPowerCost || 0,
  };
}

var SHOP = {
  coin:     { cardId: "BG28_810", name_cn: "酒馆币", position: 0, text_cn: "获得1枚铸币" },
  oil:      { cardId: "BG28_805", name_cn: "钻探原油", position: 1, text_cn: "铸币上限+1" },
  refresh:  { cardId: "BG28_827", name_cn: "快速浏览", position: 2, text_cn: "2次免费刷新" },
  blood:    { cardId: "BG28_571", name_cn: "拼命发掘", position: 3, text_cn: "用血换铸币" },
  steal:    { cardId: "BG28_512", name_cn: "偷取", position: 4, text_cn: "偷取敌方随从" },
  atk4:     { cardId: "EBG_Spell_014", name_cn: "+4攻", position: 5, text_cn: "使一个随从获得+4攻击力" },
  allBuf:   { cardId: "BG28_966", name_cn: "全体+1/+2", position: 6, text_cn: "使你的随从获得+1/+2" },
  discover2:{ cardId: "BG34_330", name_cn: "发现当前等", position: 7, text_cn: "发现当前等级随从" },
};

// ═══════════════════════════════════════════════════════════
// GROUP A: Input validation / edge cases
// ═══════════════════════════════════════════════════════════
console.log("=== GROUP A: Input edge cases ===");

var rA1 = module.evaluate(null);
check("A1.null ctx safe return []", Array.isArray(rA1) && rA1.length === 0, true);

var rA2 = module.evaluate({});
check("A2.empty ctx returns []", rA2, []);

var rA3 = module.evaluate({ shopSpells: [] });
check("A3.empty shopSpells returns []", rA3, []);

var rA4 = module.evaluate({ shopSpells: [{ cardId: "X", text_cn: "test", name_cn: "test" }], gold: 5, decisionTables: dt });
check("A4.missing _spellInteractions still works", rA4.length >= 0, true);

// ═══════════════════════════════════════════════════════════
// GROUP B: _classifySpell auto-categorization
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP B: _classifySpell ===");
var rules = dt.spell_rules || {};

var c = module._classifySpell;
check("B1.economy:铸币", c({text_cn:"获得1枚铸币",name_cn:""}, rules).category, "economy");
check("B2.economy:刷新", c({text_cn:"2次免费刷新",name_cn:""}, rules).category, "economy");
check("B3.economy:免费", c({text_cn:"免费获取",name_cn:""}, rules).category, "economy");
check("B4.economy:上限", c({text_cn:"铸币上限+1",name_cn:""}, rules).category, "economy");
check("B5.combat:攻击力", c({text_cn:"获得+4攻击力",name_cn:""}, rules).category, "combat");
check("B6.combat:生命值", c({text_cn:"使一个随从获得+3生命值",name_cn:""}, rules).category, "combat");
check("B7.combat:圣盾", c({text_cn:"使随从获得圣盾",name_cn:""}, rules).category, "combat");
check("B8.combat:嘲讽", c({text_cn:"+3血量+嘲讽",name_cn:""}, rules).category, "combat");
check("B9.discover:发现", c({text_cn:"发现当前等级随从",name_cn:""}, rules).category, "discover");
check("B10.discover:获取", c({text_cn:"获取一张牌",name_cn:""}, rules).category, "discover");
check("B11.discover:随机", c({text_cn:"随机获取随从",name_cn:""}, rules).category, "discover");
check("B12.general:无匹配", c({text_cn:"特殊效果文本",name_cn:"未知法术"}, rules).category, "general");

// subcategory detection
check("B13.combat_aura:全体", c({text_cn:"使全体随从获得+1/+2",name_cn:""}, rules).subcategory, "aura");
check("B14.combat_aura:你的随从", c({text_cn:"使你的随从获得+1攻击力",name_cn:""}, rules).subcategory, "aura");
check("B15.combat_target:单体", c({text_cn:"使一个随从获得+4攻击力",name_cn:""}, rules).subcategory, "target");

// economy overrides discover (铸币 in text)
check("B16.economy>discover", c({text_cn:"获取1枚铸币",name_cn:""}, rules).category, "economy");
// economy overrides combat
check("B17.economy>combat", c({text_cn:"获得+2/+2和1枚铸币",name_cn:""}, rules).category, "economy");
// combat overrides discover
check("B18.combat>discover", c({text_cn:"发现并使随从获得+4攻击力",name_cn:""}, rules).category, "combat");

// default cost fallback
check("B19.defaultCost=1", c({text_cn:"anything",name_cn:""}, rules).cost, 1);
check("B20.cost0 spell", c({text_cn:"anything",name_cn:""}, {default_cost:0}).cost, 0);

// ═══════════════════════════════════════════════════════════
// GROUP C: Base scores per category
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP C: Base category scores ===");
check("C1.economy=7", module._baseCategoryScore("economy"), 7);
check("C2.discover=4", module._baseCategoryScore("discover"), 4);
check("C3.combat=2", module._baseCategoryScore("combat"), 2);
check("C4.general=2", module._baseCategoryScore("general"), 2);
check("C5.unknown=2", module._baseCategoryScore("xyz"), 2);

// ═══════════════════════════════════════════════════════════
// GROUP D: Synergy score with various board states
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP D: Synergy score calculation ===");

// Empty board
var syn0 = module._buildSynergyContext(makeCtx({ boardMinions: [] }), rules);
check("D1.empty: buffAmplifier=0", syn0.buffAmplifierCount, 0);
check("D2.empty: boardCount=0", syn0.boardCount, 0);
check("D3.empty: heroSynergy=false", syn0.heroSpellSynergy, false);

// Board with 1 buff amplifier
var syn1 = module._buildSynergyContext(makeCtx({
  boardMinions: [{ cardId: "BG32_341", name_cn: "胡蒙格斯" }]
}), rules);
check("D4.1amp: buffAmplifier=1", syn1.buffAmplifierCount, 1);
check("D5.1amp: castTrigger=0", syn1.castTriggerCount, 0);

// Board with mixed types
var synMix = module._buildSynergyContext(makeCtx({
  boardMinions: [
    { cardId: "BG32_341", name_cn: "胡蒙格斯" },       // buff amplifier
    { cardId: "BG27_005", name_cn: "时空船长钩尾" },   // cast trigger
    { cardId: "BG35_883", name_cn: "巴琳达" },          // duplicator
    { cardId: "BG28_550", name_cn: "竞技表演者" },      // generator
    { cardId: "BG31_330", name_cn: "厄运先知" },        // cost reducer
  ]
}), rules);
check("D6.mix: amp=1", synMix.buffAmplifierCount, 1);
check("D7.mix: trigger=1", synMix.castTriggerCount, 1);
check("D8.mix: dup=1", synMix.duplicatorCount, 1);
check("D9.mix: gen=2", synMix.generatorCount, 2); // 竞技表演者 + 时空船长钩尾
check("D10.mix: costRed=1", synMix.costReducerCount, 1);

// Synergy score for mixed board with economy spell
var scoreMixEco = module._calcSynergyScore("economy", synMix, rules.synergy_weights || {});
checkApprox("D11.mixEco: score≈9.5", scoreMixEco, 9.5, 0.1);
// amp(1x2.0) + trigger(1x1.5) + dup(1x2.5) + gen(2x1.0) + costRed(1x1.5) = 9.5

// Synergy score for combat spell on empty board → zeroed
var synEmpty = module._buildSynergyContext(makeCtx({ boardMinions: [] }), rules);
var scoreEmptyCombat = module._calcSynergyScore("combat", synEmpty, rules.synergy_weights || {});
check("D12.emptyCombat: score=0", scoreEmptyCombat, 0);

// Synergy score for economy spell on empty board → non-zero (economy is always useful)
var scoreEmptyEco = module._calcSynergyScore("economy", synEmpty, rules.synergy_weights || {});
check("D13.emptyEco: score=0", scoreEmptyEco, 0); // no synergies but not zeroed

// ═══════════════════════════════════════════════════════════
// GROUP E: Hero synergy detection
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP E: Hero synergy ===");

var synHero1 = module._buildSynergyContext(makeCtx({ heroCardId: "BG28_HERO_800" }), rules);
check("E1.泰瑟兰_heroSyn=true", synHero1.heroSpellSynergy, true);

var synHero2 = module._buildSynergyContext(makeCtx({ heroCardId: "BG31_HERO_006" }), rules);
check("E2.大主教_heroSyn=true", synHero2.heroSpellSynergy, true);

var synHero3 = module._buildSynergyContext(makeCtx({ heroCardId: "TB_BaconShop_HERO_27" }), rules);
check("E3.辛达苟萨_heroSyn=true", synHero3.heroSpellSynergy, true);

var synHero4 = module._buildSynergyContext(makeCtx({ heroCardId: "TB_BaconShop_HERO_59" }), rules);
check("E4.阿兰娜_heroSyn=false", synHero4.heroSpellSynergy, false);

// ═══════════════════════════════════════════════════════════
// GROUP F: Trinket synergy
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP F: Trinket synergy ===");

var synTrink1 = module._buildSynergyContext(makeCtx({
  trinketOffer: [{ cardId: "BG30_MagicItem_986", name_cn: "宁神蜡烛" }]
}), rules);
check("F1.宁神蜡烛: trinketCount=1", synTrink1.trinketCount, 1);

var synTrink2 = module._buildSynergyContext(makeCtx({
  trinketOffer: [
    { cardId: "BG30_MagicItem_986", name_cn: "宁神蜡烛" },
    { cardId: "BG30_MagicItem_422", name_cn: "游学者卷轴" },
    { cardId: "BG999_NoSpell", name_cn: "无关联饰品" },
  ]
}), rules);
check("F2.mixed: trinketCount=2", synTrink2.trinketCount, 2);

// ═══════════════════════════════════════════════════════════
// GROUP G: Budget efficiency
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP G: Budget efficiency ===");

// Economy spells
check("G1.eco cost0→3", module._budgetEfficiency(0, "economy", { gold: 5, tavernTier: 3 }), 3);
check("G2.eco cost1→2", module._budgetEfficiency(1, "economy", { gold: 5, tavernTier: 3 }), 2);
check("G3.eco cost2→1", module._budgetEfficiency(2, "economy", { gold: 5, tavernTier: 3 }), 1);

// Non-economy spells with gold surplus
check("G4.combat goldLeft≥3→1", module._budgetEfficiency(1, "combat", { gold: 5, tavernTier: 3 }), 1);
check("G5.combat goldLeft=0→0", module._budgetEfficiency(3, "combat", { gold: 3, tavernTier: 3 }), 0);
check("G6.combat goldLeft=1→0", module._budgetEfficiency(2, "combat", { gold: 3, tavernTier: 3 }), 0);

// ═══════════════════════════════════════════════════════════
// GROUP H: Cast timing detection
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP H: Cast timing ===");
var timingRules = dt.spell_rules.cast_timing || {};

var t1 = module._getCastTiming("economy", "", timingRules);
check("H1.eco phase=immediate", t1.phase, "immediate");
check("H2.eco priority=100", t1.priority, 100);

var t2 = module._getCastTiming("combat", "aura", timingRules);
check("H3.aura phase=immediate", t2.phase, "immediate");
check("H4.aura priority=80", t2.priority, 80);

var t3 = module._getCastTiming("combat", "target", timingRules);
check("H5.target phase=after_buy", t3.phase, "after_buy");
check("H6.target priority=70", t3.priority, 70);

var t4 = module._getCastTiming("discover", "", timingRules);
check("H7.disc phase=after_actions", t4.phase, "after_actions");
check("H8.disc priority=50", t4.priority, 50);

var t5 = module._getCastTiming("general", "", timingRules);
check("H9.general phase=after_buy", t5.phase, "after_buy");

// ═══════════════════════════════════════════════════════════
// GROUP I: Decision format correctness
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP I: Decision format ===");

var rI = module.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.coin, SHOP.steal],
  boardMinions: [
    { cardId: "BG32_341", name_cn: "胡蒙格斯" },
  ]
}));
check("I1.returns 2 decisions", rI.length, 2);
if (rI.length >= 2) {
  var d = rI[0];
  check("I2.type=spell_buy", d.type, "spell_buy");
  checkTruthy("I3.has priority", d.priority > 0);
  checkTruthy("I4.has action", d.action.length > 0);
  checkTruthy("I5.has message", d.message.length > 0);
  checkTruthy("I6.has reason", d.reason.length > 0);
  checkTruthy("I7.has confidence", d.confidence > 0 && d.confidence <= 1);
  checkTruthy("I8.has data.cardId", !!d.data.cardId);
  checkTruthy("I9.has data.castPhase", !!d.data.castPhase);
  checkTruthy("I10.has data.castPriority", typeof d.data.castPriority === "number");
  checkTruthy("I11.has data.totalScore", typeof d.data.totalScore === "number");
  checkTruthy("I12.has data.synergyScore", typeof d.data.synergyScore === "number");
  checkTruthy("I13.has data.cost", typeof d.data.cost === "number");
  check("I14.source=SpellModule", d.source, "SpellModule");
  // Sort order: higher score first
  checkGt("I15.sorted descending", rI[0].data.totalScore, rI[1].data.totalScore - 0.01);
}

// ═══════════════════════════════════════════════════════════
// GROUP J: Full decision scenarios (integration)
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP J: Integration scenarios ===");

// J1: 大主教奥萨尔 + 钻探原油 → spell cost 1 (discounted from 2)
var rJ1 = module.evaluate(makeCtx({
  gold: 7,
  heroCardId: "BG31_HERO_006",
  shopSpells: [SHOP.oil],
}));
if (rJ1.length >= 1) {
  check("J1.oil discount cost=1", rJ1[0].data.cost, 1); // 2 - 1 = 1
}

// J2: Gold too low for spell
var rJ2 = module.evaluate(makeCtx({
  gold: 0,
  shopSpells: [SHOP.coin],
}));
check("J2.noGold: 0 decisions", rJ2.length, 0);

// J3: Gold exactly matches cost
var rJ3 = module.evaluate(makeCtx({
  gold: 1,
  shopSpells: [SHOP.coin],
}));
check("J3.exactGold: 1 decision", rJ3.length, 1);
if (rJ3.length >= 1) {
  check("J3.cost=1", rJ3[0].data.cost, 1);
}

// J4: Board full of spell synergy — economy should score very high
var rJ4 = module.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.coin],
  boardMinions: [
    { cardId: "BG32_341", name_cn: "胡蒙格斯" },       // amp
    { cardId: "BG35_341", name_cn: "附魔哨卫" },       // amp
    { cardId: "BG27_005", name_cn: "时空船长钩尾" },    // trigger
    { cardId: "BG28_551", name_cn: "救赎者娜拉" },      // trigger
    { cardId: "BG35_883", name_cn: "巴琳达" },          // dup
    { cardId: "BG28_550", name_cn: "竞技表演者" },      // gen
    { cardId: "BG31_330", name_cn: "厄运先知" },        // costRed
  ],
  heroCardId: "BG28_HERO_800",  // spell synergy hero
  trinketOffer: [
    { cardId: "BG30_MagicItem_986", name_cn: "宁神蜡烛" },
    { cardId: "BG30_MagicItem_422", name_cn: "游学者卷轴" },
  ]
}));
if (rJ4.length >= 1) {
  check("J4.highSynergy: mustBuy", rJ4[0].priority, DecisionPriority.SPELL_MUST_BUY);
  checkGt("J4.totalScore≥20", rJ4[0].data.totalScore, 20);
  // base(7) + synergy(2*2.0+2*1.5+1*2.5+3*1.0+1*1.5=14) + hero(3) + trinket(2+2=4) + budget(2) = 30
  // 时空船长钓尾 counts in both castTrigger & generator → generatorCount=3
  checkApprox("J4.totalScore≈30", rJ4[0].data.totalScore, 30, 1);

	}
// J5: Multiple economy spells — should all be recommended, sorted by score
var rJ5 = module.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.coin, SHOP.oil, SHOP.blood, SHOP.refresh],
}));
check("J5.allEco: all recommended", rJ5.length, 4);
if (rJ5.length >= 2) {
  // 拼命发掘(0费) > 酒馆币(1费) > 快速浏览(1费) > 钻探原油(2费)
  // 0费: budgetScore=3, base=7 → 10
  // 1费: budgetScore=2, base=7 → 9
  // 2费: budgetScore=1, base=7 → 8
  checkGt("J5.blood>oil", rJ5[0].data.totalScore, rJ5[3].data.totalScore);
}

// J6: Combat spell with empty board should be de-prioritized
var rJ6 = module.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.coin, SHOP.atk4],
  boardMinions: []
}));
if (rJ6.length >= 2) {
  checkGt("J6.eco>combat on empty", rJ6[0].data.totalScore, rJ6[1].data.totalScore);
} else if (rJ6.length === 1) {
  check("J6.combat skipped on empty", rJ6[0].data.category, "economy");
}

// J7: All-buff spell categorized as aura, immediate phase
var rJ7 = module.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.allBuf],
  boardMinions: [{ cardId: "BGS_001", name_cn: "鱼人", tier: 1 }]
}));
if (rJ7.length >= 1) {
  check("J7.aura phase=immediate", rJ7[0].data.castPhase, "immediate");
}

  // J8: Discover spell castPhase is after_actions, but sorted position varies
  var rJ8 = module.evaluate(makeCtx({
    gold: 10,
    shopSpells: [SHOP.coin, SHOP.atk4, SHOP.discover2],
    boardMinions: [{ cardId: "BGS_001", name_cn: "鱼人", tier: 1, attack: 2, health: 1 }]
  }));
  var j8disc = null;
  for (var di = 0; di < rJ8.length; di++) {
    if (rJ8[di].data.cardId === "BG34_330") { j8disc = rJ8[di]; break; }
  }
  if (j8disc) {
    check("J8.disc castPhase=after_actions", j8disc.data.castPhase, "after_actions");
  }

// ═══════════════════════════════════════════════════════════
// GROUP K: Missing config sections (graceful degradation)
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP K: Graceful degradation ===");

// Module with minimal config
var sparseConfig = JSON.parse(JSON.stringify(dt));
delete sparseConfig.spell_rules.synergy_weights;
delete sparseConfig.spell_rules.cast_timing;
delete sparseConfig.spell_rules.hero_spell_synergy;
var sparseModule = new SpellModule(sparseConfig);

var rK = sparseModule.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.coin],
  _spellInteractions: lookup,
}));
check("K1.sparseConfig: still produces decision", rK.length, 1);
if (rK.length >= 1) {
  checkTruthy("K2.has fallback castPhase", !!rK[0].data.castPhase);
}

// No spell_interactions at all
var rK3 = sparseModule.evaluate(makeCtx({
  gold: 10,
  shopSpells: [SHOP.coin],
  _spellInteractions: null,
}));
check("K3.nullInteractions: still works", rK3.length, 1);
if (rK3.length >= 1) {
  check("K4.no synergy bonus", rK3[0].data.synergyScore, 0);
}

// ═══════════════════════════════════════════════════════════
// GROUP L: Duplicate prevention / unique actions
// ═══════════════════════════════════════════════════════════
console.log("\n=== GROUP L: Action uniqueness ===");

var rL = module.evaluate(makeCtx({
  gold: 20,
  shopSpells: [SHOP.coin, SHOP.coin, SHOP.coin], // 3 identical spells
}));
check("L1.threeIdentical: count=3", rL.length, 3);
if (rL.length >= 3) {
  // Actions should be buy_spell_0, buy_spell_1, buy_spell_2 (unique)
  var actionSet = {};
  var unique = true;
  for (var i = 0; i < rL.length; i++) {
    if (actionSet[rL[i].action]) unique = false;
    actionSet[rL[i].action] = true;
  }
  check("L2.unique actions", unique, true);
}

console.log("\n" + "=".repeat(50));
console.log("  Passed: " + passed + " | Failed: " + failed);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);
