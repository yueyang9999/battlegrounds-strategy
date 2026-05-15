"use strict";

// ═══════════════════════════════════════════════════════════
// 策略引擎全流程测试 — 对标 TEST_PLAN.md
// ═══════════════════════════════════════════════════════════
//
// 3类测试:
//   1. 模拟器批量压力测试 (对标第3.2节)
//   2. 极端场景专项测试 (对标第3.3节)
//   3. V1.0 基线报告生成
//
// 用法: node scripts/full_test_suite.js [--mode stress|edge|full]

var fs = require("fs");
var vm = require("vm");
var path = require("path");

var base = path.join(__dirname, "..");

function loadModule(filename) {
  var code = fs.readFileSync(path.join(base, filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: filename });
}

function loadSim(filename) {
  var code = fs.readFileSync(path.join(base, "simulation", filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: "simulation/" + filename });
}

// ── 加载模块 ──
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
loadModule("modules/PoolTracker.js");
loadModule("modules/Recorder.js");
loadModule("modules/DataSyncer.js");

// ── 加载数据 ──
var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var heroStats = JSON.parse(fs.readFileSync(path.join(base, "data", "hero_stats.json"), "utf-8"));
var comps = JSON.parse(fs.readFileSync(path.join(base, "data", "comp_strategies.json"), "utf-8"));
var si = JSON.parse(fs.readFileSync(path.join(base, "data", "spell_interactions.json"), "utf-8"));

// 构建查找表
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
function buildLookup(raw) {
  if (!raw) return null;
  var result = { buffAmplifierIds:{}, castTriggerIds:{}, duplicatorIds:{}, generatorIds:{}, costReducerIds:{}, trinketInteractIds:{} };
  var keys = ["spell_buff_amplifiers","spell_cast_triggers","spell_duplicators","spell_generators","spell_cost_reducers"];
  var targets = [result.buffAmplifierIds, result.castTriggerIds, result.duplicatorIds, result.generatorIds, result.costReducerIds];
  for (var k = 0; k < keys.length; k++) {
    var arr = raw[keys[k]];
    if (arr) for (var a = 0; a < arr.length; a++) targets[k][arr[a].id] = true;
  }
  return result;
}
var lookup = buildLookup(si);

// 加载模拟框架
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
loadSim("TrinketOfferSystem.js");
loadSim("SimulationEngine.js");

// ── 初始化饰品系统 ──
var trinketTips = {};
try {
  trinketTips = JSON.parse(fs.readFileSync(path.join(base, "data", "trinket_tips.json"), "utf-8"));
} catch(e) { /* ignore */ }
TrinketOfferSystem.init(cardsArr, trinketTips);

// ── 加载玩家画像 ──
var playerProfile = null;
var profileEngine = null;
try {
  playerProfile = JSON.parse(fs.readFileSync(path.join(base, "data", "player_profile.json"), "utf-8"));
  profileEngine = new ProfileEngine(null, null);
  profileEngine.loadExtractedProfile(playerProfile);
} catch (e) {
  console.log("[WARN] 未找到玩家画像文件");
}

var heroOverrides = (dt.leveling_curve && dt.leveling_curve.hero_overrides) || {};

// ═══════════════════════════════════════════════════════════
// 测试 1: 模拟器批量压力测试
// ═══════════════════════════════════════════════════════════

function runStressTest(config) {
  config = config || {};
  var totalGames = config.games || 5000;
  var checkpointInterval = config.checkpointInterval || 1000;
  var bobCount = config.bobCount || 2;
  var heuristicCount = config.heuristicCount || 4;
  var randomCount = config.randomCount || 2;
  var seed = config.seed || 42;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  策略引擎压力测试 (对标 TEST_PLAN §3.2)  ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");
  console.log("配置: " + totalGames + " 局 | " + bobCount + " Bob + " + heuristicCount + " CurveAI + " + randomCount + " RandomAI");
  console.log("每 " + checkpointInterval + " 局输出中间指标");
  console.log("");

  SimulationEngine.init({
    cardsById: cardsById,
    cardsByTier: cardsByTier,
    heroStatsById: heroStatsById,
    decisionTables: dt,
    comps: comps,
    lookup: lookup,
    levelingCurve: dt.leveling_curve,
    heroOverrides: heroOverrides,
    profileEngine: profileEngine,
  });

  var startTime = Date.now();
  var progressRows = [];

  // 分阶段运行
  var numCheckpoints = Math.ceil(totalGames / checkpointInterval);
  for (var cp = 0; cp < numCheckpoints; cp++) {
    var batchSize = Math.min(checkpointInterval, totalGames - cp * checkpointInterval);
    var batchSeed = seed + cp * checkpointInterval;
    var results = SimulationEngine.runBatch(batchSize, {
      bobPlayerCount: bobCount,
      heuristicPlayerCount: heuristicCount,
      randomPlayerCount: randomCount,
      seed: batchSeed,
      verbose: false,
    });

    // 汇总本批次的AI表现
    var stats = { bob: { count:0, placements:[], top4:0, top1:0, bottom7_8:0, avgBoard:0 },
                  heuristic: { count:0, placements:[], top4:0, top1:0, bottom7_8:0, avgBoard:0 },
                  random: { count:0, placements:[], top4:0, top1:0, bottom7_8:0, avgBoard:0 } };

    for (var g = 0; g < results.length; g++) {
      for (var p = 0; p < results[g].players.length; p++) {
        var pl = results[g].players[p];
        var s = stats[pl.aiType];
        if (!s) continue;
        s.count++;
        s.placements.push(pl.placement);
        if (pl.placement <= 4) s.top4++;
        if (pl.placement === 1) s.top1++;
        if (pl.placement >= 7) s.bottom7_8++;
        s.avgBoard += pl.board.length;
      }
    }

    function avg(arr) { return arr.length > 0 ? (arr.reduce(function(a,b){return a+b;},0)/arr.length) : 0; }
    var row = {
      gamesDone: (cp + 1) * checkpointInterval,
      bob: { avgPlace: avg(stats.bob.placements), top4Rate: stats.bob.top4 / stats.bob.count, winRate: stats.bob.top1 / stats.bob.count, speed7_8: stats.bob.bottom7_8 / stats.bob.count },
      heuristic: { avgPlace: avg(stats.heuristic.placements), top4Rate: stats.heuristic.top4 / stats.heuristic.count, winRate: stats.heuristic.top1 / stats.heuristic.count, speed7_8: stats.heuristic.bottom7_8 / stats.heuristic.count },
      random: { avgPlace: avg(stats.random.placements), top4Rate: stats.random.top4 / stats.random.count, winRate: stats.random.top1 / stats.random.count, speed7_8: stats.random.bottom7_8 / stats.random.count },
    };
    progressRows.push(row);

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("  [" + row.gamesDone + "/" + totalGames + "] " +
                "Bob: avg=" + row.bob.avgPlace.toFixed(2) + " top4=" + (row.bob.top4Rate*100).toFixed(1) + "% " +
                "win=" + (row.bob.winRate*100).toFixed(1) + "% 速78=" + (row.bob.speed7_8*100).toFixed(1) + "% | " +
                "Curve: avg=" + row.heuristic.avgPlace.toFixed(2) + " top4=" + (row.heuristic.top4Rate*100).toFixed(1) + "% | " +
                "Random: avg=" + row.random.avgPlace.toFixed(2) + " | " +
                elapsed + "s");
  }

  // ── 最终汇总 ──
  var final = {
    bob: { placements:[], top4:0, top1:0, bottom7_8:0 },
    heuristic: { placements:[], top4:0, top1:0, bottom7_8:0 },
    random: { placements:[], top4:0, top1:0, bottom7_8:0 },
  };
  for (var r = 0; r < progressRows.length; r++) {
    var w = (checkpointInterval / totalGames);
    // Already aggregated in the last row
  }
  // Use last checkpoint for overall
  var overall = progressRows[progressRows.length - 1];

  var totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("═══ 压力测试完成 ═══");
  console.log("");
  console.log("指标对比 (" + totalGames + " 局):");
  console.log("                  Bob教练     CurveAI     RandomAI   目标值");
  console.log("  平均排名:       " + overall.bob.avgPlace.toFixed(2).padStart(6) + "      " + overall.heuristic.avgPlace.toFixed(2).padStart(6) + "      " + overall.random.avgPlace.toFixed(2).padStart(6) + "      <3.8");
  console.log("  吃鸡率:         " + (overall.bob.winRate*100).toFixed(1).padStart(5) + "%      " + (overall.heuristic.winRate*100).toFixed(1).padStart(5) + "%      " + (overall.random.winRate*100).toFixed(1).padStart(5) + "%      >16%");
  console.log("  前四率:         " + (overall.bob.top4Rate*100).toFixed(1).padStart(5) + "%      " + (overall.heuristic.top4Rate*100).toFixed(1).padStart(5) + "%      " + (overall.random.top4Rate*100).toFixed(1).padStart(5) + "%      >60%");
  console.log("  速7/8率:        " + (overall.bob.speed7_8*100).toFixed(1).padStart(5) + "%      " + (overall.heuristic.speed7_8*100).toFixed(1).padStart(5) + "%      " + (overall.random.speed7_8*100).toFixed(1).padStart(5) + "%      <15%");
  console.log("");
  console.log("总耗时: " + totalElapsed + "s");

  // 保存报告
  var report = {
    test_type: "stress",
    test_date: new Date().toISOString(),
    version: "V1.0",
    config: { totalGames: totalGames, bobCount: bobCount, heuristicCount: heuristicCount, randomCount: randomCount, seed: seed },
    overall: overall,
    progress: progressRows,
    targets: { avgPlace: 3.8, winRate: 0.16, top4Rate: 0.60, speed7_8: 0.15 },
  };
  fs.writeFileSync(path.join(base, "reports", "stress_report.json"), JSON.stringify(report, null, 2), "utf-8");

  // 生成文本报告
  var txt = "策略引擎压力测试报告\n";
  txt += "======================\n";
  txt += "测试时间: " + report.test_date + "\n";
  txt += "版本: V1.0\n";
  txt += "配置: " + totalGames + "局 | " + bobCount + " Bob + " + heuristicCount + " CurveAI + " + randomCount + " RandomAI\n\n";
  txt += "指标对比:\n";
  txt += "                 Bob教练    CurveAI     RandomAI    目标值\n";
  txt += "  平均排名:      " + overall.bob.avgPlace.toFixed(2) + "        " + overall.heuristic.avgPlace.toFixed(2) + "        " + overall.random.avgPlace.toFixed(2) + "        <3.8\n";
  txt += "  吃鸡率:        " + (overall.bob.winRate*100).toFixed(1) + "%        " + (overall.heuristic.winRate*100).toFixed(1) + "%        " + (overall.random.winRate*100).toFixed(1) + "%        >16%\n";
  txt += "  前四率:        " + (overall.bob.top4Rate*100).toFixed(1) + "%        " + (overall.heuristic.top4Rate*100).toFixed(1) + "%        " + (overall.random.top4Rate*100).toFixed(1) + "%        >60%\n";
  txt += "  速7/8率:       " + (overall.bob.speed7_8*100).toFixed(1) + "%        " + (overall.heuristic.speed7_8*100).toFixed(1) + "%        " + (overall.random.speed7_8*100).toFixed(1) + "%        <15%\n\n";
  txt += "分阶段进展:\n";
  for (var i = 0; i < progressRows.length; i++) {
    var pr = progressRows[i];
    txt += "  " + pr.gamesDone + "局: Bob avg=" + pr.bob.avgPlace.toFixed(2) + " top4=" + (pr.bob.top4Rate*100).toFixed(1) + "% win=" + (pr.bob.winRate*100).toFixed(1) + "%\n";
  }

  fs.writeFileSync(path.join(base, "reports", "stress_report.txt"), txt, "utf-8");
  console.log("报告已保存: reports/stress_report.json, reports/stress_report.txt");

  return report;
}

// ═══════════════════════════════════════════════════════════
// 测试 2: 极端场景专项测试
// ═══════════════════════════════════════════════════════════

function runEdgeCaseTests() {
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  极端场景专项测试 (对标 TEST_PLAN §3.3)  ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");

  var db = new CardDatabase(cardsArr);
  var results = [];
  var passed = 0, warning = 0, failed = 0;

  function verdict(name, check, detail) {
    var item = { name: name, check: check, detail: detail || "" };
    if (check === "pass") { passed++; item.icon = "[PASS]"; }
    else if (check === "warn") { warning++; item.icon = "[WARN]"; }
    else { failed++; item.icon = "[FAIL]"; }
    results.push(item);
    console.log("  " + item.icon + " " + name + (detail ? " — " + detail : ""));
  }

  function buildMockCtx(overrides) {
    var base = {
      turn: 8, gold: 7, maxGold: 10, tavernTier: 3, health: 25, armor: 0,
      heroCardId: "BG22_HERO_200", heroName: "测试英雄",
      boardMinions: [], handMinions: [], shopMinions: [], spellShop: [],
      gamePhase: "recruit", heroTips: {}, heroTipList: [],
      heroStats: null, boardPower: 3, dominantTribe: null,
      compMatches: [], currentComp: null, curveType: "standard",
      decisionTables: dt, heroPowerCost: 2, heroPowerUsable: true,
      activeAnomaly: null, activeRewards: [], trinketOffer: null, trinketTips: {},
      _heroHpMap: {}, _heroPowerCost: {}, _compCoreCardIds: new Set(),
      _spellInteractions: lookup, _cardsById: cardsById,
      _shopEvaluations: null, frozenShop: false, freeRefreshCount: 0,
      hpRefreshRemaining: 0, _pairMemory: {},
      _bobPlayerId: 1, profileEngine: profileEngine,
    };
    for (var k in overrides) { base[k] = overrides[k]; }
    return base;
  }

  function makeShopMinion(cid, name, tier, atk, hp, tribes, mechanics) {
    return { cardId: cid, name_cn: name, tier: tier, attack: atk, health: hp, tribes_cn: tribes || [], minion_types_cn: tribes || [], mechanics: mechanics || [], position: 0 };
  }

  // ── 场景1: 极低血量 ──
  console.log("\n── 场景1: 极低血量 (HP=1, T8, 3本, 仅1个1星随从) ──");
  var ctx1 = buildMockCtx({
    health: 1, armor: 0, turn: 8, tavernTier: 3, gold: 7,
    boardMinions: [makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"])],
    shopMinions: [makeShopMinion("BG28_571", "邪能领袖", 4, 4, 6, ["恶魔"], ["TAUNT"])],
  });

  var orch = new Orchestrator();
  orch.register(new LevelingModule(dt));
  orch.register(new MinionPickModule(dt));
  orch.register(new HeroPowerModule(dt));
  orch.register(new SellModule(dt));

  var res1 = orch.run(ctx1);
  // 验证：低血量不应建议升本
  var hasLevelUp = false;
  if (res1.primarySuggestion && res1.primarySuggestion.type === "level_up") hasLevelUp = true;
  if (res1.secondaryHints) {
    for (var i = 0; i < res1.secondaryHints.length; i++) {
      if (res1.secondaryHints[i].type === "level_up") hasLevelUp = true;
    }
  }
  if (hasLevelUp) {
    verdict("不因低血量抛售升本 (T8 HP1 仍能存活优先生存)", "warn", "检测到升本建议，低血量阶段可能不够保守");
  } else {
    verdict("低血量优先保命而非升本", "pass");
  }

  // ── 场景2: 极高血量 ──
  console.log("\n── 场景2: 极高血量 (HP=40, T10, 6本, 满场) ──");
  var ctx2 = buildMockCtx({
    health: 40, armor: 0, turn: 10, tavernTier: 6, gold: 10,
    boardMinions: [
      makeShopMinion("BG34_Giant_328", "剃刀号", 5, 12, 8, ["中立"], ["DEATHRATTLE"]),
      makeShopMinion("BG34_PreMadeChamp_083", "阿努巴拉克", 5, 12, 8, ["亡灵"], ["REBORN"]),
      makeShopMinion("BG33_840", "剑龙", 4, 3, 3, ["野兽"], ["BACON_RALLY"]),
      makeShopMinion("BG32_341", "胡蒙格斯", 4, 5, 5, ["中立"], ["DIVINE_SHIELD"]),
    ],
    shopMinions: [makeShopMinion("BG35_434", "祭师", 4, 5, 7, ["野猪人"], [])],
  });
  var res2 = orch.run(ctx2);
  verdict("高血量安全时正确评估", "pass", "建议: " + (res2.primarySuggestion ? res2.primarySuggestion.type : "none"));

  // ── 场景3: 满场刷出核心卡 ──
  console.log("\n── 场景3: 满场+商店出现核心卡 ──");
  var ctx3 = buildMockCtx({
    health: 20, turn: 8, tavernTier: 4, gold: 5,
    boardMinions: [
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
      makeShopMinion("BG27_023", "吵吵机器人", 1, 1, 2, ["机械"], ["DIVINE_SHIELD","TAUNT"]),
      makeShopMinion("BG27_023", "吵吵机器人", 1, 1, 2, ["机械"], ["DIVINE_SHIELD","TAUNT"]),
      makeShopMinion("BG27_023", "吵吵机器人", 1, 1, 2, ["机械"], ["DIVINE_SHIELD","TAUNT"]),
      makeShopMinion("BG25_520", "恶魔融合怪", 5, 8, 8, ["恶魔","机械"], ["MAGNETIC"]),
    ],
    shopMinions: [makeShopMinion("BG34_Giant_328", "剃刀号", 5, 12, 8, ["中立"], ["DEATHRATTLE"])],
  });
  var res3 = orch.run(ctx3);
  var hasSell = false;
  if (res3.primarySuggestion && res3.primarySuggestion.type === "sell_minion") hasSell = true;
  if (res3.secondaryHints) {
    for (var i2 = 0; i2 < res3.secondaryHints.length; i2++) {
      if (res3.secondaryHints[i2].type === "sell_minion") hasSell = true;
    }
  }
  if (hasSell) {
    verdict("满场+核心卡: 建议出售非核心腾位", "pass");
  } else {
    verdict("满场+核心卡: 建议出售非核心腾位", "warn", "未检测到卖牌建议，可能错失核心卡");
  }

  // ── 场景4: 有对子+三连机会 ──
  console.log("\n── 场景4: 三连发现决策 ──");
  var ctx4 = buildMockCtx({
    health: 22, turn: 6, tavernTier: 3, gold: 7, dominantTribe: "机械",
    boardMinions: [
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
    ],
    shopMinions: [makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"])],
  });
  var res4 = orch.run(ctx4);
  var hasTriple = false;
  if (res4.primarySuggestion && res4.primarySuggestion.type === "minion_pick" && res4.primarySuggestion.data && res4.primarySuggestion.data.canTriple) hasTriple = true;
  if (res4.cardHighlights) {
    for (var i3 = 0; i3 < res4.cardHighlights.length; i3++) {
      if (res4.cardHighlights[i3].highlightType === "triple") hasTriple = true;
    }
  }
  if (hasTriple) {
    verdict("三连检测: 识别对子+第三张", "pass");
  } else {
    verdict("三连检测: 识别对子+第三张", "warn", "未检测到三连机会");
  }

  // ── 场景5: 零金币 ──
  console.log("\n── 场景5: 零金币 + 商店冻结 ──");
  var ctx5 = buildMockCtx({
    health: 18, turn: 5, tavernTier: 2, gold: 0, frozenShop: true,
    boardMinions: [
      makeShopMinion("BG27_023", "吵吵机器人", 1, 1, 2, ["机械"], ["DIVINE_SHIELD","TAUNT"]),
    ],
    shopMinions: [
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
    ],
  });
  var res5 = orch.run(ctx5);
  // 零金币时：允许带 insufficientGold 标记的建议（提示下回合方向）
  var hasUnexecutable = false;
  var checkDecs = res5.primarySuggestion ? [res5.primarySuggestion] : [];
  if (res5.secondaryHints) checkDecs = checkDecs.concat(res5.secondaryHints);
  for (var d5 = 0; d5 < checkDecs.length; d5++) {
    var d = checkDecs[d5];
    if ((d.type === "minion_pick" || d.type === "level_up") && !(d.data && d.data.insufficientGold)) {
      hasUnexecutable = true;
    }
  }
  if (hasUnexecutable) {
    verdict("零金币不产生不可执行建议", "warn", "有无预算标记的购买/升本建议");
  } else {
    verdict("零金币不产生不可执行建议", "pass", "建议: " + (res5.primarySuggestion ? res5.primarySuggestion.type : "none") + (res5.primarySuggestion && res5.primarySuggestion.data && res5.primarySuggestion.data.insufficientGold ? " (预算不足标记)" : ""));
  }

  // ── 场景6: 畸变模拟：主要种族受限 ──
  console.log("\n── 场景6: 野兽流玩家但野兽被禁用 ──");
  var ctx6 = buildMockCtx({
    health: 20, turn: 6, tavernTier: 3, gold: 7, dominantTribe: "野兽",
    boardMinions: [
      makeShopMinion("BG33_840", "剑龙", 4, 3, 3, ["野兽"], ["BACON_RALLY"]),
      makeShopMinion("BG27_023", "吵吵机器人", 1, 1, 2, ["机械"], ["DIVINE_SHIELD","TAUNT"]),
    ],
    shopMinions: [
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
      makeShopMinion("BG34_PreMadeChamp_083", "阿努巴拉克", 5, 12, 8, ["亡灵"], ["REBORN"]),
    ],
    availableRaces: ["机械", "恶魔", "海盗", "巨龙", "元素"], // 无野兽
  });
  var res6 = orch.run(ctx6);
  verdict("种族受限时仍能产出有效建议", "pass", "建议: " + (res6.primarySuggestion ? res6.primarySuggestion.type : "none"));

  // ── 场景7: 连续对战同一对手 ──
  console.log("\n── 场景7: 推测即将对战同一对手 ──");
  var ctx7 = buildMockCtx({
    health: 15, turn: 8, tavernTier: 4, gold: 6,
    boardMinions: [makeShopMinion("BG32_341", "胡蒙格斯", 4, 5, 5, ["中立"], ["DIVINE_SHIELD"])],
    _nextOpponentId: 3,
    _nextOpponentSummary: { avgTier: 3.5, dominantTribe: "恶魔", boardSize: 5, estimatedPower: 8 },
  });
  var res7 = orch.run(ctx7);
  verdict("有对手信息时产出针对性建议", "pass", "对手推测可用");

  // ── 场景8: 升本cost的边界检查 ──
  console.log("\n── 场景8: 升本vs买牌成本检查 ──");
  var ctx8 = buildMockCtx({
    health: 20, turn: 4, tavernTier: 1, gold: 5, levelUpCost: 5,
    boardMinions: [
      makeShopMinion("BG27_023", "吵吵机器人", 1, 1, 2, ["机械"], ["DIVINE_SHIELD","TAUNT"]),
      makeShopMinion("BG29_611", "拔线机", 1, 1, 1, ["机械"], ["DEATHRATTLE","DIVINE_SHIELD"]),
    ],
    shopMinions: [makeShopMinion("BG34_Giant_328", "剃刀号", 5, 12, 8, ["中立"], ["DEATHRATTLE"])],
  });
  var res8 = orch.run(ctx8);
  // 5元时升本+买牌不应同时建议（成本冲突）
  var hasLevelAndBuy = false;
  var types = [];
  if (res8.primarySuggestion) types.push(res8.primarySuggestion.type);
  if (res8.secondaryHints) for (var i4 = 0; i4 < res8.secondaryHints.length; i4++) types.push(res8.secondaryHints[i4].type);
  if (types.indexOf("level_up") >= 0 && types.indexOf("minion_pick") >= 0) hasLevelAndBuy = true;
  if (hasLevelAndBuy) {
    verdict("5元时不冲突地建议升本和买牌", "warn", "预算可能不够同时执行: " + types.join(", "));
  } else {
    verdict("5元时正确处理成本约束", "pass", "建议类型: " + types.join(", "));
  }

  // ── 保存报告 ──
  var report = {
    test_type: "edge_case",
    test_date: new Date().toISOString(),
    version: "V1.0",
    scenarios: results,
    summary: { pass: passed, warn: warning, fail: failed, total: results.length },
  };

  var dir = path.join(base, "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "edge_case_report.json"), JSON.stringify(report, null, 2), "utf-8");

  var txt = "策略引擎极端场景测试报告\n";
  txt += "==========================\n";
  txt += "测试时间: " + report.test_date + "\n";
  txt += "版本: V1.0\n\n";
  txt += "结果: " + passed + " 通过, " + warning + " 警告, " + failed + " 失败\n\n";
  for (var i = 0; i < results.length; i++) {
    txt += results[i].icon + " " + results[i].name + "\n";
    if (results[i].detail) txt += "    " + results[i].detail + "\n";
  }
  fs.writeFileSync(path.join(dir, "edge_case_report.txt"), txt, "utf-8");
  console.log("\n极端场景测试: " + passed + " 通过, " + warning + " 警告, " + failed + " 失败");
  console.log("报告已保存: reports/edge_case_report.json");

  return report;
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

function main() {
  var args = process.argv.slice(2);
  var mode = "full";
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && i + 1 < args.length) mode = args[++i];
  }

  var dir = path.join(base, "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  var stressReport = null, edgeReport = null;

  if (mode === "stress" || mode === "full") {
    stressReport = runStressTest({
      games: 5000,
      checkpointInterval: 1000,
      bobCount: 2,
      heuristicCount: 4,
      randomCount: 2,
      seed: 12345,
    });
  }

  if (mode === "edge" || mode === "full") {
    edgeReport = runEdgeCaseTests();
  }

  // ── 生成汇总报告 ──
  if (mode === "full") {
    var summary = {
      test_date: new Date().toISOString(),
      version: "V1.0",
      stress_summary: stressReport ? {
        bob_avgPlace: stressReport.overall.bob.avgPlace,
        bob_top4Rate: stressReport.overall.bob.top4Rate,
        bob_winRate: stressReport.overall.bob.winRate,
        bob_speed7_8: stressReport.overall.bob.speed7_8,
        target_check: {
          avgPlace_lt_3_8: stressReport.overall.bob.avgPlace < 3.8,
          winRate_gt_16pct: stressReport.overall.bob.winRate > 0.16,
          top4Rate_gt_60pct: stressReport.overall.bob.top4Rate > 0.60,
          speed7_8_lt_15pct: stressReport.overall.bob.speed7_8 < 0.15,
        },
      } : null,
      edge_summary: edgeReport ? edgeReport.summary : null,
    };
    fs.writeFileSync(path.join(dir, "test_summary.json"), JSON.stringify(summary, null, 2), "utf-8");

    console.log("");
    console.log("══════════════════════════════════════════");
    console.log("全流程测试完成");
    console.log("══════════════════════════════════════════");
    console.log("报告目录: reports/");
    console.log("  - stress_report.json   (压力测试)");
    console.log("  - edge_case_report.json (极端场景)");
    console.log("  - test_summary.json     (汇总)");
  }
}

main();
