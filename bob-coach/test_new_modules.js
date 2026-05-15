"use strict";

// ═══════════════════════════════════════════════════════════
// 新模块集成验证脚本
// 用法: node test_new_modules.js
// ═══════════════════════════════════════════════════════════

var path = require("path");
var fs = require("fs");
var vm = require("vm");

var MODULES_DIR = path.join(__dirname, "modules");
var DATA_DIR = path.join(__dirname, "data");

// ── 加载源文件 (在全局作用域中执行，共享 var 声明) ──
function loadScript(filepath) {
  var code = fs.readFileSync(filepath, "utf-8");
  vm.runInThisContext(code, filepath);
}

// 加载模块 (顺序依赖)
loadScript(path.join(MODULES_DIR, "MechanicScoring.js"));
loadScript(path.join(MODULES_DIR, "DecisionBase.js"));
loadScript(path.join(MODULES_DIR, "RulesEngine.js"));
loadScript(path.join(MODULES_DIR, "Orchestrator.js"));
loadScript(path.join(MODULES_DIR, "LevelingModule.js"));
loadScript(path.join(MODULES_DIR, "MinionPickModule.js"));
loadScript(path.join(MODULES_DIR, "HeroPowerModule.js"));
loadScript(path.join(MODULES_DIR, "SpellModule.js"));
loadScript(path.join(MODULES_DIR, "TrinketModule.js"));
loadScript(path.join(MODULES_DIR, "RefreshModule.js"));
loadScript(path.join(MODULES_DIR, "FreezeModule.js"));
loadScript(path.join(MODULES_DIR, "OpponentAnalysisModule.js"));
loadScript(path.join(MODULES_DIR, "DecisionsLogger.js"));
loadScript(path.join(MODULES_DIR, "CardDatabase.js"));
loadScript(path.join(MODULES_DIR, "PoolTracker.js"));
loadScript(path.join(MODULES_DIR, "ProfileEngine.js"));
loadScript(path.join(MODULES_DIR, "Recorder.js"));
loadScript(path.join(MODULES_DIR, "DataSyncer.js"));

var passed = 0;
var failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  [PASS] " + name);
  } else {
    failed++;
    console.error("  [FAIL] " + name + (detail ? " — " + detail : ""));
  }
}

// ── 加载卡牌数据 ──
var cardsPath = path.join(DATA_DIR, "cards.json");
var cards = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));

console.log("\n=== 1. CardDatabase ===");
var db = new CardDatabase(cards);
check("总卡牌数 > 0", db.total > 0, "total=" + db.total);
check("getByTier(3) 有结果", db.getByTier(3).length > 0, "count=" + db.getByTier(3).length);
check("getByRace('野兽') 有结果", db.getByRace("野兽").length > 0, "count=" + db.getByRace("野兽").length);
check("getByRace('机械') 有结果", db.getByRace("机械").length > 0, "count=" + db.getByRace("机械").length);
check("getByKeyword('DEATHRATTLE') 有结果", db.getByKeyword("DEATHRATTLE").length > 0, "count=" + db.getByKeyword("DEATHRATTLE").length);
check("getByTag('shield') 有结果", db.getByTag("shield").length > 0, "count=" + db.getByTag("shield").length);
check("getByTag('economy') 有结果", db.getByTag("economy").length > 0, "count=" + db.getByTag("economy").length);
check("getByTiming('early') 有结果", db.getByTiming("early").length > 0, "count=" + db.getByTiming("early").length);
check("getByTiming('mid') 有结果", db.getByTiming("mid").length > 0, "count=" + db.getByTiming("mid").length);
check("getByTiming('late') 有结果", db.getByTiming("late").length > 0, "count=" + db.getByTiming("late").length);
check("getByDimension('economy', 5) 有结果", db.getByDimension("economy", 5).length > 0, "count=" + db.getByDimension("economy", 5).length);
check("getByDimension('tempo', 5) 有结果", db.getByDimension("tempo", 5).length > 0, "count=" + db.getByDimension("tempo", 5).length);
check("getAvailableRaces()", db.getAvailableRaces().length > 0, db.getAvailableRaces().join(","));
check("getAvailableTags()", db.getAvailableTags().length > 0, "count=" + db.getAvailableTags().length);
check("query({tier:3, race:'野兽'})", db.query({tier: 3, race: "野兽"}).length > 0, "count=" + db.query({tier: 3, race: "野兽"}).length);
check("query({minEconomy:5})", db.query({minEconomy: 5}).length > 0, "count=" + db.query({minEconomy: 5}).length);
check("toCardsById()", Object.keys(db.toCardsById()).length === db.total, "keys=" + Object.keys(db.toCardsById()).length);

// 验证维度分数范围
var allMinions = db.getByCardType("minion");
var economyScores = [];
for (var i = 0; i < Math.min(20, allMinions.length); i++) {
  var dims = allMinions[i]._dimensions;
  if (dims) economyScores.push(dims.economy);
}
check("economy 分数范围 0-10", economyScores.every(function(s) { return s >= 0 && s <= 10; }));

console.log("\n=== 2. PoolTracker ===");
var pt = new PoolTracker(db);
var testRaces = ["野兽", "机械", "恶魔", "海盗", "巨龙"];
pt.init(testRaces);
check("初始化后 availableMinions > 0", pt.availableMinions.length > 0, "count=" + pt.availableMinions.length);
check("初始化后 remaining 有值", Object.keys(pt.remaining).length > 0);
check("getAccessible(1) 有结果", pt.getAccessible(1).length > 0, "count=" + pt.getAccessible(1).length);
check("getAccessible(6) > getAccessible(1)", pt.getAccessible(6).length > pt.getAccessible(1).length);
check("getTotalAccessibleCopies(6) > 0", pt.getTotalAccessibleCopies(6) > 0, "total=" + pt.getTotalAccessibleCopies(6));

// 验证概率
var testCardId = pt.getAccessible(3)[0];
if (testCardId) {
  var probBefore = pt.refreshProbability(testCardId, 3);
  check("refreshProbability 返回 0-1", probBefore >= 0 && probBefore <= 1, "prob=" + probBefore.toFixed(4));

  // 购买后概率应降低
  var copiesBefore = pt.getRemaining(testCardId);
  pt.buy(testCardId);
  var probAfter = pt.refreshProbability(testCardId, 3);
  check("购买后概率降低", probAfter <= probBefore, "before=" + probBefore.toFixed(4) + " after=" + probAfter.toFixed(4));
  check("buy 减少剩余份数", pt.getRemaining(testCardId) === copiesBefore - 1);

  // 出售后恢复
  pt.sell(testCardId);
  check("sell 恢复剩余份数", pt.getRemaining(testCardId) === copiesBefore);
}

// 三连测试
pt.combineTriple(testCardId);
check("combineTriple 扣除3张", pt.getRemaining(testCardId) <= copiesBefore - 3);
pt.sellGolden(testCardId);
check("sellGolden 退还3张", pt.getRemaining(testCardId) === copiesBefore);

// getSummary
var summary = pt.getSummary(3);
check("getSummary 有数据", summary.totalCopies > 0, "total=" + summary.totalCopies);

console.log("\n=== 3. ProfileEngine ===");
var pe = new ProfileEngine(null, db);
check("无数据时 hasEnoughData 返回 false", !pe.hasEnoughData());

// 构建模拟画像
pe.buildProfile();
check("空画像构建成功", pe.profile !== null);

// 手动填充画像测试相似度
pe.profile = {
  preferredRaces: { "野兽": 15, "恶魔": 5 },
  preferredKeywords: { "DEATHRATTLE": 12, "REBORN": 8 },
  preferredTags: { "deathrattle": 15, "reborn": 8, "taunt": 3 },
  preferredTiers: { "3": 10, "4": 8 },
  totalGames: 20,
  avgPlacement: 3.5,
};

var beastCards = db.getByRace("野兽");
if (beastCards.length > 0) {
  var sim = pe.cardSimilarity(beastCards[0]);
  check("野兽卡牌相似度 > 0", sim > 0, "sim=" + sim.toFixed(4));

  var nonBeastCards = db.query({race: "机械"}).filter(function(c) {
    var races = c.minion_types_cn || [];
    return races.indexOf("野兽") === -1;
  });
  if (nonBeastCards.length > 0) {
    var sim2 = pe.cardSimilarity(nonBeastCards[0]);
    // 不强制要求 sim2 < sim, 因为其他维度可能匹配
    console.log("  野兽卡相似度=" + sim.toFixed(4) + " 非野兽卡相似度=" + sim2.toFixed(4));
  }
}

check("inferPlaystyle 返回类型", ["aggressive", "tempo", "synergy", "flexible"].indexOf(pe.inferPlaystyle()) !== -1, "style=" + pe.inferPlaystyle());

// recommend
var candidates = db.getByTier(3).slice(0, 30);
var recs = pe.recommend(candidates, 5);
check("recommend 返回正确数量", recs.length <= 5 && recs.length > 0, "count=" + recs.length);
check("推荐结果有 _profileSim", typeof recs[0]._profileSim === "number");

// boostScore
var baseScore = 5;
var boosted = pe.boostScore(beastCards[0], baseScore);
check("boostScore 有加成", boosted >= baseScore, "base=" + baseScore + " boosted=" + boosted.toFixed(2));

console.log("\n=== 4. Recorder ===");
var rec = new Recorder(db);
rec.startGame("TB_TestHero_001", "测试英雄", 7000, "35.2.2");
check("startGame 初始化", rec._started);

// 模拟选牌
for (var r = 0; r < 5; r++) {
  var pickId = pt.getAccessible(3)[r];
  if (pickId) rec.recordPick(pickId);
}
check("recordPick 记录卡牌", rec.pickedCards.length > 0, "count=" + rec.pickedCards.length);

var record = rec.endGame(3);
check("endGame 生成 CompactRecord", record !== null);
check("v = 1", record.v === 1);
check("seg 正确", record.seg === 7000);
check("seg_bucket 正确", record.seg_bucket === "tier_6001_8999");
check("hero 正确", record.hero === "TB_TestHero_001");
check("rank 正确", record.rank === 3);
check("cards 去重", record.cards.length <= 5);
check("tags 格式", Array.isArray(record.tags) && record.tags.length > 0);
check("kw 格式", Array.isArray(record.kw) && record.kw.length > 0);
check("race 格式", Array.isArray(record.race) && record.race.length > 0);
check("ts 有日期", typeof record.ts === "string" && record.ts.length === 10);
check("record JSON 大小 < 5KB", JSON.stringify(record).length < 5000, "size=" + JSON.stringify(record).length + " bytes");

// 验证分桶逻辑
rec.mmr = 3000;
var r2 = rec.endGame(5);
check("MMR 3000 → tier_0_6000", r2.seg_bucket === "tier_0_6000");
rec.mmr = 9500;
var r3 = rec.endGame(2);
check("MMR 9500 → tier_9000_plus", r3.seg_bucket === "tier_9000_plus");

console.log("\n=== 5. DataSyncer ===");
var ds = new DataSyncer();
check("构造函数成功", ds !== null);
check("localMeta 初始为 null", ds.localMeta === null);

// getSegmentForMMR
check("getSegmentForMMR(6000) 返回 null (无缓存)", ds.getSegmentForMMR(6000) === null);
check("getAllSegments 返回空对象", Object.keys(ds.getAllSegments()).length === 0);

// 模拟保存分段数据
try {
  // 在 Node 环境没有 localStorage, 但 DataSyncer 会安全降级
  ds._saveSegmentData("tier_0_6000", { test: true });
  console.log("  [INFO] localStorage 降级测试通过");
} catch (e) {
  console.log("  [INFO] localStorage 不可用 (Node 环境，正常)");
}

console.log("\n=== 6. 集成交叉验证 ===");
// 验证 ctx 中模块引用可用
var mockCtx = {
  turn: 5,
  gold: 7,
  tavernTier: 3,
  heroCardId: "TB_Test",
  heroName: "测试",
  boardMinions: [],
  handMinions: [],
  shopMinions: [],
  gamePhase: "shop",
  decisionTables: {},
  heroPowerCost: 2,
  heroPowerUsable: true,
  cardDb: db,
  poolTracker: pt,
  profileEngine: pe,
  recorder: rec,
  dataSyncer: ds,
  dominantTribe: "野兽",
  compMatches: [],
  activeAnomaly: null,
  activeRewards: [],
  availableRaces: testRaces,
};

// Orchestrator 集成
var orch = new Orchestrator();
var minionMod = new MinionPickModule({});
orch.register(minionMod);
var result = orch.run(mockCtx);
check("Orchestrator.run 返回结果", result !== null, "has primarySuggestion=" + !!(result && result.primarySuggestion));

// ProfileEngine boostScore 在 ctx 中的可用性
check("profileEngine.hasEnoughData 对 mock 画像返回 true", mockCtx.profileEngine.hasEnoughData());

// PoolTracker summary
var poolSum = mockCtx.poolTracker.getSummary(3);
check("PoolTracker summary 包含必要字段", poolSum.initialized && typeof poolSum.totalCopies === "number");

// ── 总结 ──
console.log("\n" + "=".repeat(50));
console.log("测试完成: " + passed + " 通过, " + failed + " 失败");
if (failed > 0) {
  process.exit(1);
} else {
  console.log("所有测试通过!");
}
