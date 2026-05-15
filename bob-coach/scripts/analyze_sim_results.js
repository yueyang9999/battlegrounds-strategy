"use strict";
var fs = require("fs");
var path = require("path");

var results = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "sim_results.json"), "utf-8"));

// ── 1. Overall stats ──
var bobPlayers = [];
var heuristicPlayers = [];
for (var g = 0; g < results.length; g++) {
  for (var p = 0; p < results[g].players.length; p++) {
    var pl = results[g].players[p];
    if (pl.aiType === "bob") bobPlayers.push(pl);
    else heuristicPlayers.push(pl);
  }
}

// ── 2. Placement distribution ──
function placementDist(players, label) {
  var dist = [0,0,0,0,0,0,0,0]; // placement 1-8
  for (var i = 0; i < players.length; i++) {
    var pl = players[i].placement;
    if (pl >= 1 && pl <= 8) dist[pl - 1]++;
  }
  console.log("\n=== " + label + " 排名分布 (" + players.length + " 局) ===");
  for (var j = 0; j < 8; j++) {
    var bar = "";
    for (var k = 0; k < Math.round(dist[j] / players.length * 50); k++) bar += "#";
    console.log("  " + (j+1) + "位: " + dist[j].toString().padStart(5) + " (" + (dist[j]/players.length*100).toFixed(1) + "%) " + bar);
  }
}

placementDist(bobPlayers, "Bob教练");
placementDist(heuristicPlayers, "启发式AI");

// ── 3. Hero performance for Bob ──
var bobHeroStats = {};
for (var i = 0; i < bobPlayers.length; i++) {
  var pl = bobPlayers[i];
  var hid = pl.heroCardId;
  if (!bobHeroStats[hid]) bobHeroStats[hid] = { games: 0, totalPlace: 0, top4: 0, top1: 0, avgTier: 0, avgBoardSize: 0 };
  bobHeroStats[hid].games++;
  bobHeroStats[hid].totalPlace += pl.placement;
  if (pl.placement <= 4) bobHeroStats[hid].top4++;
  if (pl.placement === 1) bobHeroStats[hid].top1++;
  bobHeroStats[hid].avgTier += pl.tavernTier;
  bobHeroStats[hid].avgBoardSize += pl.board.length;
}

// Sort by win rate (min 5 games)
var heroList = [];
for (var h in bobHeroStats) {
  var hs = bobHeroStats[h];
  if (hs.games >= 5) {
    heroList.push({ id: h, games: hs.games, avgPlace: hs.totalPlace / hs.games,
                    top4Rate: hs.top4 / hs.games, winRate: hs.top1 / hs.games,
                    avgTier: hs.avgTier / hs.games, avgBoard: hs.avgBoardSize / hs.games });
  }
}
heroList.sort(function(a, b) { return b.winRate - a.winRate; });

console.log("\n=== Bob教练 英雄表现 (胜率排序, >=5局) ===");
console.log("  英雄ID".padEnd(45) + "局数 平均排名  前4率  吃鸡率  平均本数 平均随从");
for (var i = 0; i < Math.min(heroList.length, 25); i++) {
  var h = heroList[i];
  console.log("  " + h.id.padEnd(43) + h.games.toString().padStart(4) + "  " + h.avgPlace.toFixed(2).padStart(5) + "  " + (h.top4Rate*100).toFixed(0).padStart(4) + "%  " + (h.winRate*100).toFixed(0).padStart(4) + "%  " + h.avgTier.toFixed(1).padStart(5) + "  " + h.avgBoard.toFixed(1).padStart(5));
}

// ── 4. Decision breakdown ──
var bobDecCounts = {};
var bobDecTotal = 0;
var bobFollowedTotal = 0;
var bobTotalDecisions = 0;
for (var i = 0; i < bobPlayers.length; i++) {
  var pl = bobPlayers[i];
  bobTotalDecisions += pl.totalDecisions;
  bobFollowedTotal += pl.followedDecisions;
  var decs = pl.decisionsMade || [];
  for (var j = 0; j < decs.length; j++) {
    var action = decs[j].action;
    bobDecCounts[action] = (bobDecCounts[action] || 0) + 1;
  }
}

var heurDecCounts = {};
for (var i = 0; i < heuristicPlayers.length; i++) {
  var pl = heuristicPlayers[i];
  var decs = pl.decisionsMade || [];
  for (var j = 0; j < decs.length; j++) {
    var action = decs[j].action;
    heurDecCounts[action] = (heurDecCounts[action] || 0) + 1;
  }
}

console.log("\n=== 决策类型分布 ===");
console.log("  类型".padEnd(20) + "Bob教练".padEnd(12) + "启发式AI".padEnd(12) + "Bob/局".padEnd(10) + "Heur/局");
var allActions = {};
for (var a in bobDecCounts) allActions[a] = true;
for (var a in heurDecCounts) allActions[a] = true;
for (var a in allActions) {
  console.log("  " + a.padEnd(18) + (bobDecCounts[a]||0).toString().padStart(8) + (heurDecCounts[a]||0).toString().padStart(10) + (bobDecCounts[a]/1000).toFixed(1).padStart(9) + (heurDecCounts[a]/1000).toFixed(1).padStart(9));
}

console.log("\nBob总决策: " + bobTotalDecisions + " | 执行率: " + (bobFollowedTotal / Math.max(1,bobTotalDecisions) * 100).toFixed(1) + "%");

// ── 5. Level-up timing analysis ──
function analyzeLevelTiming(players, label) {
  var levelTurns = {}; // { turn: { 2: count, 3: count, ... } }
  var tierAtTurn = {}; // { turn: [tier1, tier2, ...] }
  for (var i = 0; i < players.length; i++) {
    var pl = players[i];
    var decs = pl.decisionsMade || [];
    for (var j = 0; j < decs.length; j++) {
      if (decs[j].action === "level_up") {
        var turn = decs[j].turn;
        if (!levelTurns[turn]) levelTurns[turn] = {};
        // tier after leveling would be tracked...
        levelTurns[turn].count = (levelTurns[turn].count || 0) + 1;
      }
    }
  }

  // Find most common level-up turns
  var sortedTurns = [];
  for (var t in levelTurns) {
    sortedTurns.push({ turn: parseInt(t), count: levelTurns[t].count });
  }
  sortedTurns.sort(function(a, b) { return a.turn - b.turn; });

  console.log("\n=== " + label + " 升本时机分布 ===");
  console.log("  回合  " + "升本次数".padStart(8) + "  每局平均");
  for (var i = 0; i < sortedTurns.length; i++) {
    console.log("  T" + sortedTurns[i].turn.toString().padStart(2) + "  " + sortedTurns[i].count.toString().padStart(8) + "  " + (sortedTurns[i].count / (players.length / 4)).toFixed(2).padStart(8));
  }
}

analyzeLevelTiming(bobPlayers, "Bob教练");
analyzeLevelTiming(heuristicPlayers, "启发式AI");

// ── 6. Card pick frequency (Bob Coach) ──
var bobCardPickCount = {};
for (var i = 0; i < bobPlayers.length; i++) {
  var pl = bobPlayers[i];
  var decs = pl.decisionsMade || [];
  for (var j = 0; j < decs.length; j++) {
    if (decs[j].action === "buy_minion" && decs[j].cardId) {
      bobCardPickCount[decs[j].cardId] = (bobCardPickCount[decs[j].cardId] || 0) + 1;
    }
  }
}

var cardPickList = [];
for (var c in bobCardPickCount) {
  cardPickList.push({ id: c, count: bobCardPickCount[c] });
}
cardPickList.sort(function(a, b) { return b.count - a.count; });

console.log("\n=== Bob教练 拿牌频次 TOP 25 ===");
var cardsData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cards.json"), "utf-8"));
var cardsById = {};
for (var i = 0; i < cardsData.length; i++) {
  cardsById[cardsData[i].str_id] = cardsData[i];
}
for (var i = 0; i < Math.min(cardPickList.length, 25); i++) {
  var c = cardPickList[i];
  var card = cardsById[c.id];
  var name = card ? (card.name_cn || c.id) : c.id;
  var tier = card ? ("T" + (card.tier || "?")) : "?";
  console.log("  " + (i+1).toString().padStart(3) + ". " + name.padEnd(25) + " " + tier + " x" + c.count);
}

// ── 7. End-game board tribe analysis ──
var bobTribeCounts = {};
var bobBoardTierSum = 0;
var bobBoardCount = 0;
for (var i = 0; i < bobPlayers.length; i++) {
  var pl = bobPlayers[i];
  for (var j = 0; j < pl.board.length; j++) {
    var tribes = pl.board[j].tribes_cn || [];
    for (var t = 0; t < tribes.length; t++) {
      bobTribeCounts[tribes[t]] = (bobTribeCounts[tribes[t]] || 0) + 1;
    }
    bobBoardTierSum += pl.board[j].tier || 1;
    bobBoardCount++;
  }
}

console.log("\n=== Bob教练 终局种族分布 ===");
var tribeList = [];
for (var tribe in bobTribeCounts) {
  tribeList.push({ tribe: tribe, count: bobTribeCounts[tribe] });
}
tribeList.sort(function(a, b) { return b.count - a.count; });
for (var i = 0; i < tribeList.length; i++) {
  console.log("  " + tribeList[i].tribe.padEnd(10) + " x" + tribeList[i].count + " (" + (tribeList[i].count/bobBoardCount*100).toFixed(1) + "%)");
}
console.log("  平均终局随从星级: " + (bobBoardTierSum / bobBoardCount).toFixed(2));

// ── 8. Loss analysis: what causes Bob to lose? ──
console.log("\n=== Bob教练 淘汰原因分析 ===");
var deathTurns = [];
var lowBoardTurns = [];
for (var i = 0; i < bobPlayers.length; i++) {
  var pl = bobPlayers[i];
  if (pl.placement >= 5) {
    // Lost - check what went wrong
    deathTurns.push({ placement: pl.placement, hero: pl.heroCardId, boardSize: pl.board.length, tavernTier: pl.tavernTier });
  }
}
deathTurns.sort(function(a, b) { return a.placement - b.placement; });
console.log("  未进前4的局数: " + deathTurns.length + " (" + (deathTurns.length/bobPlayers.length*100).toFixed(1) + "%)");
console.log("  其中平均终局随从数: " + (deathTurns.reduce(function(s, d) { return s + d.boardSize; }, 0) / deathTurns.length).toFixed(1));
console.log("  其中平均酒馆等级: " + (deathTurns.reduce(function(s, d) { return s + d.tavernTier; }, 0) / deathTurns.length).toFixed(1));

// Placement analysis for deaths
var deathDist = [0,0,0,0,0,0,0,0];
for (var i = 0; i < deathTurns.length; i++) {
  deathDist[deathTurns[i].placement - 1]++;
}
console.log("  详细排名分布:");
for (var j = 4; j < 8; j++) {
  console.log("    " + (j+1) + "位: " + deathDist[j] + " 局 (" + (deathDist[j]/deathTurns.length*100).toFixed(1) + "%)");
}

// ── 9. Early game decisions correlation with final placement ──
console.log("\n=== 升本节奏 vs 最终排名 ===");
var groups = { early: [], mid: [], late: [] }; // early: 3费升本, mid: 4-5费, late: 6+
for (var i = 0; i < bobPlayers.length; i++) {
  var pl = bobPlayers[i];
  var decs = pl.decisionsMade || [];
  var firstLevelTurn = 99;
  for (var j = 0; j < decs.length; j++) {
    if (decs[j].action === "level_up" && decs[j].turn < firstLevelTurn) {
      firstLevelTurn = decs[j].turn;
    }
  }
  if (firstLevelTurn <= 3) groups.early.push(pl.placement);
  else if (firstLevelTurn <= 5) groups.mid.push(pl.placement);
  else groups.late.push(pl.placement);
}
function avg(arr) { return arr.length > 0 ? (arr.reduce(function(a,b){return a+b;},0)/arr.length).toFixed(2) : "-"; }
console.log("  首升<=3回合: " + groups.early.length + " 局, 平均排名 " + avg(groups.early));
console.log("  首升4-5回合: " + groups.mid.length + " 局, 平均排名 " + avg(groups.mid));
console.log("  首升>=6回合: " + groups.late.length + " 局, 平均排名 " + avg(groups.late));

console.log("\n=== 分析完成 ===");
