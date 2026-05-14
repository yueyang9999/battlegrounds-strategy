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
loadModule("modules/Orchestrator.js");
loadModule("modules/LevelingModule.js");
loadModule("modules/MinionPickModule.js");
loadModule("modules/HeroPowerModule.js");
loadModule("modules/SpellModule.js");
loadModule("modules/TrinketModule.js");

// Load data
var dt = JSON.parse(fs.readFileSync(path.join(base, "data", "decision_tables.json"), "utf-8"));
var cardsArr = JSON.parse(fs.readFileSync(path.join(base, "data", "cards.json"), "utf-8"));
var heroStats = JSON.parse(fs.readFileSync(path.join(base, "data", "hero_stats.json"), "utf-8"));
var comps = JSON.parse(fs.readFileSync(path.join(base, "data", "comp_strategies.json"), "utf-8"));
var si = JSON.parse(fs.readFileSync(path.join(base, "data", "spell_interactions.json"), "utf-8"));

// Build lookups
var cardsById = {};
var cardsByTier = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
var spellsList = [];
for (var i = 0; i < cardsArr.length; i++) {
  var c = cardsArr[i];
  cardsById[c.str_id] = c;
  if (c.card_type === "minion" && c.tier && c.tier <= 7) {
    cardsByTier[c.tier].push(c);
  }
  if (c.card_type === "tavern") {
    spellsList.push(c);
  }
}

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

// Hero stats lookup
var heroStatsById = {};
for (var i = 0; i < heroStats.length; i++) {
  heroStatsById[heroStats[i].hero_card_id] = heroStats[i];
}

// ═══════════════════════════════════════════════════════════
// SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════

var MAX_TURNS = 14;
var STARTING_HEALTH = 30;
var DAMAGE_PER_TIER = 1;
var BASE_DAMAGE = 1;

// Estimate board power (mirror overlay.js)
function estimateBoardPower(boardMinions) {
  var powerTable = (dt.board_power_estimation && dt.board_power_estimation.minion_base_power) || {};
  var goldenMul = (dt.board_power_estimation && dt.board_power_estimation.golden_multiplier) || 1.5;
  var synergyBonus = (dt.board_power_estimation && dt.board_power_estimation.synergy_bonus) || 0.15;
  var total = 0;
  for (var i = 0; i < boardMinions.length; i++) {
    var m = boardMinions[i];
    var tier = m.tier || 1;
    var p = powerTable[tier] || (0.2 * tier);
    if (m.golden) p *= goldenMul;
    p *= (1 + (m.attack || 0) / 20 + (m.health || 0) / 30);
    total += p;
  }
  // Synergy bonus for same tribes
  var tribeCounts = {};
  for (var i = 0; i < boardMinions.length; i++) {
    var tribes = boardMinions[i].tribes_cn || [];
    for (var t = 0; t < tribes.length; t++) {
      tribeCounts[tribes[t]] = (tribeCounts[tribes[t]] || 0) + 1;
    }
  }
  var synBonus = 0;
  for (var tribe in tribeCounts) {
    if (tribeCounts[tribe] >= 2) synBonus += tribeCounts[tribe] * synergyBonus;
  }
  total *= (1 + Math.min(synBonus, 1.0));
  return total;
}

// Generate a plausible shop for a given tier
function generateShop(tier, gold) {
  var shop = { minions: [], spells: [] };
  var numMinions = 3 + Math.floor(Math.random() * 2); // 3-4 minions
  var numSpells = Math.random() < 0.4 ? 1 : 0; // 40% chance of a spell

  var availableTiers = [];
  for (var t = 1; t <= tier; t++) {
    if (cardsByTier[t] && cardsByTier[t].length > 0) availableTiers.push(t);
  }

  for (var i = 0; i < numMinions; i++) {
    var t = availableTiers[Math.floor(Math.random() * availableTiers.length)];
    var pool = cardsByTier[t];
    var card = pool[Math.floor(Math.random() * pool.length)];
    shop.minions.push({
      cardId: card.str_id,
      name_cn: card.name_cn || card.str_id,
      tier: card.tier,
      attack: card.attack || 1,
      health: card.health || 1,
      tribes_cn: card.minion_types_cn || [],
      text_cn: card.text_cn || "",
      mechanics: card.mechanics || [],
      position: i,
    });
  }

  if (numSpells > 0 && spellsList.length > 0) {
    var spell = spellsList[Math.floor(Math.random() * spellsList.length)];
    shop.spells.push({
      cardId: spell.str_id,
      name_cn: spell.name_cn || spell.str_id,
      text_cn: spell.text_cn || "",
      position: 0,
    });
  }

  return shop;
}

// Get hero power cost
function getHeroPowerCost(ctx) {
  if (ctx._heroPowerCost && ctx._heroPowerCost[ctx.heroCardId]) {
    return ctx._heroPowerCost[ctx.heroCardId];
  }
  var card = cardsById[ctx.heroCardId];
  if (card) return card.cost || 1;
  return 1;
}

// Get opponent power for a given turn — calibrated against estimateBoardPower
function getOpponentPower(turn, tavernTier) {
  // Expected board power at each turn for an average player
  var turnPower = {
    1: 0.15, 2: 0.3, 3: 0.7, 4: 1.3, 5: 2.0,
    6: 3.2, 7: 5.0, 8: 7.0, 9: 9.5, 10: 12.0,
    11: 14.5, 12: 17.0, 13: 19.5, 14: 22.0
  };
  var base = turnPower[turn] || (turn * 2.0);
  // High-roll opponents (20%): 30% stronger
  var highRoll = Math.random() < 0.20 ? 1.3 : 1.0;
  // Ghost/wounded opponents (10%): 35% weaker
  var ghost = Math.random() < 0.10 ? 0.65 : 1.0;
  var variance = (Math.random() - 0.5) * Math.sqrt(turn) * 1.2;
  return Math.max(0.1, base * highRoll * ghost + variance);
}

// Simulate one combat — realistic Battlegrounds damage model
function simulateCombat(ourPower, opponentPower, opponentTier, turn) {
  var diff = ourPower - opponentPower;
  var winProb = 1 / (1 + Math.exp(-diff * 2.0)); // sigmoid
  var isWin = Math.random() < winProb;

  if (isWin) {
    var damageDealt = opponentTier + Math.floor(Math.random() * 3);
    return { win: true, damageDealt: Math.min(damageDealt, 10), damageTaken: 0 };
  } else {
    // Damage scales up in late game
    var baseDamage = opponentTier + 2;
    var extraDamage = Math.floor(Math.abs(diff) * 1.8);
    var cap = turn >= 12 ? 25 : (turn >= 9 ? 18 : 14);
    return { win: false, damageDealt: 0, damageTaken: Math.min(baseDamage + extraDamage, cap) };
  }
}

// Run one simulated game
function runOneGame(heroCardId, guidanceMode, verbose) {
  var heroCard = cardsById[heroCardId];
  var heroStats = heroStatsById[heroCardId];
  var heroName = (heroCard && heroCard.name_cn) || heroCardId;

  // Initial state
  var health = STARTING_HEALTH;
  var gold = 3;
  var maxGold = 3;
  var tavernTier = 1;
  var boardMinions = [];
  var handMinions = [];
  var trinketOffer = [];
  var activeRewards = [];
  var activeAnomaly = null;
  var curveType = "standard";
  var turn = 1;

  var decisionsMade = [];
  var totalDecisions = 0;
  var followedDecisions = 0;

  // Get curve type from hero overrides
  var lcHero = (dt.leveling_curve && dt.leveling_curve.hero_overrides) || {};
  if (lcHero[heroCardId]) {
    curveType = lcHero[heroCardId].curve_type || "standard";
  }

  var heroHpMap = {};
  heroHpMap[heroCardId] = true;

  var heroTips = {};
  var heroTipList = [];

  while (health > 0 && turn <= MAX_TURNS) {
    if (verbose) console.log("\n--- Turn " + turn + " | Gold: " + gold + " | Tier: " + tavernTier + " | HP: " + health + " ---");

    // Generate shop
    var shop = generateShop(tavernTier, gold);

    // Build context for decision engine
    var coreCardIds = new Set();
    if (comps && comps.length > 0) {
      for (var ci = 0; ci < comps.length; ci++) {
        var compCards = comps[ci].cards || [];
        for (var cc = 0; cc < compCards.length; cc++) {
          if (compCards[cc].role === "core" || compCards[cc].role === "CORE") {
            coreCardIds.add(compCards[cc].id);
          }
        }
      }
    }

    var ctx = {
      turn: turn,
      gold: gold,
      maxGold: maxGold,
      tavernTier: tavernTier,
      health: health,
      heroCardId: heroCardId,
      heroName: heroName,
      boardMinions: boardMinions,
      handMinions: handMinions,
      shopMinions: shop.minions,
      shopSpells: shop.spells,
      gamePhase: "recruit",
      heroTips: heroTips,
      heroTipList: heroTipList,
      heroStats: heroStats,
      boardPower: estimateBoardPower(boardMinions),
      dominantTribe: null,
      compMatches: [],
      currentComp: null,
      curveType: curveType,
      decisionTables: dt,
      heroPowerCost: 1,
      heroPowerUsable: true,
      activeAnomaly: activeAnomaly,
      activeRewards: activeRewards,
      trinketOffer: trinketOffer,
      trinketTips: {},
      _heroHpMap: heroHpMap,
      _heroPowerCost: {},
      _compCoreCardIds: coreCardIds,
      _spellInteractions: lookup,
      _cardsById: cardsById,
      _shopEvaluations: null,
    };

    // Determine dominant tribe
    var tribeCounts = {};
    for (var i = 0; i < boardMinions.length; i++) {
      var tribes = boardMinions[i].tribes_cn || [];
      for (var t = 0; t < tribes.length; t++) {
        tribeCounts[tribes[t]] = (tribeCounts[tribes[t]] || 0) + 1;
      }
    }
    var maxTribe = "";
    var maxCount = 0;
    for (var tribe in tribeCounts) {
      if (tribeCounts[tribe] > maxCount) { maxTribe = tribe; maxCount = tribeCounts[tribe]; }
    }
    ctx.dominantTribe = maxTribe;

    // Run decision engine — call each module directly
    var levelMod = new LevelingModule(dt);
    var minionMod = new MinionPickModule(dt);
    var heroMod = new HeroPowerModule(dt);
    var spellMod = new SpellModule(dt);
    var trinketMod = new TrinketModule(dt);

    var allDecisions = [];
    allDecisions = allDecisions.concat(levelMod.evaluate(ctx));
    allDecisions = allDecisions.concat(minionMod.evaluate(ctx));
    allDecisions = allDecisions.concat(heroMod.evaluate(ctx));
    allDecisions = allDecisions.concat(spellMod.evaluate(ctx));
    allDecisions = allDecisions.concat(trinketMod.evaluate(ctx));

    // Sort by priority * confidence desc
    allDecisions.sort(function(a, b) {
      return (b.priority * b.confidence) - (a.priority * a.confidence);
    });

    if (verbose) {
      console.log("  Shop minions: " + shop.minions.map(function(m) { return m.name_cn; }).join(", "));
      console.log("  Decisions (" + allDecisions.length + "):");
      for (var d = 0; d < Math.min(allDecisions.length, 5); d++) {
        var dec = allDecisions[d];
        console.log("    [" + dec.priority + "] " + dec.message + " | conf=" + dec.confidence.toFixed(2));
      }
    }

    totalDecisions += allDecisions.length;

    // Apply decisions based on guidance mode
    var goldSpent = 0;
    var boughtMinions = [];
    var castSpells = [];
    var didLevelUp = false;
    var didRefresh = false;
    var usedHeroPower = false;

    // Sort decisions by priority * confidence
    var sortedDecisions = allDecisions.slice().sort(function(a, b) {
      return (b.priority * b.confidence) - (a.priority * a.confidence);
    });

    // SMART APPLICATION ORDER: level_up first, then buy, then hero power with leftover

    if (guidanceMode === "none") {
      // ── Random mode: random level-first, always buy minion, occasional refresh ──
      var lvlCost = 5 + tavernTier - 1;
      if (!didLevelUp && gold - goldSpent >= lvlCost && Math.random() < 0.35) {
        didLevelUp = true;
        goldSpent += lvlCost;
        tavernTier++;
        decisionsMade.push({ turn: turn, action: "level_random", followed: false });
      }
      if (gold - goldSpent >= 3 && shop.minions.length > 0 && boardMinions.length + boughtMinions.length < 7) {
        var rm = shop.minions[Math.floor(Math.random() * shop.minions.length)];
        boughtMinions.push(rm);
        goldSpent += 3;
        decisionsMade.push({ turn: turn, action: "buy_random", cardId: rm.cardId, followed: false });
      }
      if (boughtMinions.length === 0 && gold - goldSpent >= 3 && shop.minions.length > 0) {
        var rm2 = shop.minions[Math.floor(Math.random() * shop.minions.length)];
        boughtMinions.push(rm2);
        goldSpent += 3;
        decisionsMade.push({ turn: turn, action: "buy_random2", cardId: rm2.cardId, followed: false });
      }
      if (gold - goldSpent >= 1 && Math.random() < 0.05) {
        didRefresh = true;
        goldSpent += 1;
      }
    } else {
      // ── Full / Partial guidance: follow decision engine ──

      // PHASE 1: Level up (highest priority, checked first)
      for (var d = 0; d < sortedDecisions.length; d++) {
        var dec = sortedDecisions[d];
        if (guidanceMode === "partial" && Math.random() >= 0.5 &&
            dec.type !== "level_up" && dec.type !== "danger" && dec.type !== "hero_power") {
          decisionsMade.push({ turn: turn, action: dec.action, cardId: dec.data.cardId, followed: false });
          continue;
        }
        if (dec.type === "level_up" && !didLevelUp) {
          var lvlCost2 = dec.data.cost || (5 + tavernTier - 1);
          if (gold - goldSpent >= lvlCost2) {
            didLevelUp = true;
            goldSpent += lvlCost2;
            tavernTier++;
            decisionsMade.push({ turn: turn, action: "level_up", followed: true });
            followedDecisions++;
          }
        }
      }

      // PHASE 2: Buy minions/spells with remaining gold (after level-up)
      for (var d = 0; d < sortedDecisions.length; d++) {
        var dec = sortedDecisions[d];
        if (guidanceMode === "partial" && Math.random() >= 0.5 &&
            dec.type !== "level_up" && dec.type !== "danger") {
          continue;
        }
        var cost = dec.data.cost || 3;
        if (gold - goldSpent < cost) continue;

        if (dec.type === "minion_pick" && dec.data.cardId && dec.data.position !== undefined) {
          var bought = shop.minions[dec.data.position];
          if (bought) {
            boughtMinions.push(bought);
            goldSpent += cost;
            followedDecisions++;
            decisionsMade.push({ turn: turn, action: "buy_minion", cardId: dec.data.cardId, followed: true });
          }
        } else if (dec.type === "spell_buy" && dec.data.cardId) {
          var spellBought = null;
          for (var s = 0; s < shop.spells.length; s++) {
            if (shop.spells[s].cardId === dec.data.cardId) { spellBought = shop.spells[s]; break; }
          }
          if (spellBought) {
            castSpells.push(spellBought);
            goldSpent += cost;
            followedDecisions++;
            decisionsMade.push({ turn: turn, action: "buy_spell", cardId: dec.data.cardId, followed: true });
          }
        } else if (dec.type === "refresh" && !didRefresh && gold - goldSpent >= 1) {
          didRefresh = true;
          goldSpent += 1;
          followedDecisions++;
          decisionsMade.push({ turn: turn, action: "refresh", followed: true });
          shop = generateShop(tavernTier, gold - goldSpent);
        }
      }

      // SAFETY BUY: Always buy at least one minion if gold >= 3 and board not full
      if (boughtMinions.length === 0 && gold - goldSpent >= 3 && shop.minions.length > 0 && boardMinions.length < 7) {
        var bestMinion = shop.minions[0];
        var bestScore = -1;
        for (var sm = 0; sm < shop.minions.length; sm++) {
          var smScore = (shop.minions[sm].tier || 1) * 2 + (shop.minions[sm].attack || 1) * 0.5 + (shop.minions[sm].health || 1) * 0.5;
          if (smScore > bestScore) { bestScore = smScore; bestMinion = shop.minions[sm]; }
        }
        boughtMinions.push(bestMinion);
        goldSpent += 3;
        decisionsMade.push({ turn: turn, action: "buy_safety", cardId: bestMinion.cardId, followed: true });
      }

      // PHASE 3: Hero power with leftover gold only
      for (var d = 0; d < sortedDecisions.length; d++) {
        var dec = sortedDecisions[d];
        if (dec.type === "hero_power" && !usedHeroPower) {
          var hpCost = dec.data.cost || 1;
          if (gold - goldSpent >= hpCost && (gold - goldSpent - hpCost >= 3 || boughtMinions.length > 0)) {
            usedHeroPower = true;
            goldSpent += hpCost;
            followedDecisions++;
            decisionsMade.push({ turn: turn, action: "hero_power", followed: true });
          }
        }
      }
    }

    // Add bought minions to board
    for (var b = 0; b < boughtMinions.length; b++) {
      boardMinions.push({
        cardId: boughtMinions[b].cardId,
        name_cn: boughtMinions[b].name_cn,
        tier: boughtMinions[b].tier,
        attack: boughtMinions[b].attack || 1,
        health: boughtMinions[b].health || 1,
        golden: false,
        tribes_cn: boughtMinions[b].tribes_cn || [],
        position: boardMinions.length,
      });
    }

    // Simulate combat
    if (turn >= 2) {
      var ourPower = estimateBoardPower(boardMinions);
      var oppTier = Math.max(1, Math.min(6, tavernTier + Math.floor(Math.random() * 3) - 1));
      var oppPower = getOpponentPower(turn, oppTier);
      var combatResult = simulateCombat(ourPower, oppPower, oppTier, turn);

      if (combatResult.damageTaken > 0) {
        health -= combatResult.damageTaken;
        if (verbose) console.log("  Combat: LOSS - took " + combatResult.damageTaken + " dmg (ourPower=" + ourPower.toFixed(2) + " vs oppPower=" + oppPower.toFixed(2) + ")");
      } else {
        if (verbose) console.log("  Combat: WIN - dealt " + combatResult.damageDealt + " dmg (ourPower=" + ourPower.toFixed(2) + " vs oppPower=" + oppPower.toFixed(2) + ")");
      }
    }

    // Trim board to max 7 (sell weakest)
    while (boardMinions.length > 7) {
      var worstIdx = 0;
      var worstPower = Infinity;
      for (var bi = 0; bi < boardMinions.length; bi++) {
        var p = (boardMinions[bi].tier || 1) * (boardMinions[bi].golden ? 1.5 : 1);
        if (p < worstPower) { worstPower = p; worstIdx = bi; }
      }
      boardMinions.splice(worstIdx, 1);
    }

    // Economy phase: fresh gold each turn + unspent carries over
    var goldRemaining = gold - goldSpent;
    maxGold = Math.min(maxGold + 1, 10);
    gold = Math.max(0, goldRemaining) + maxGold;
    gold = Math.min(gold, 10); // cap at 10
    turn++;
  }

  var placement = estimatePlacement(health, turn);

  return {
    heroCardId: heroCardId,
    heroName: heroName,
    guidanceMode: guidanceMode,
    turns: turn - 1,
    finalHealth: health,
    finalTier: tavernTier,
    finalBoardSize: boardMinions.length,
    finalBoardPower: estimateBoardPower(boardMinions),
    placement: placement,
    decisionsMade: decisionsMade.length,
    followedDecisions: followedDecisions,
    totalDecisions: totalDecisions,
    died: health <= 0,
  };
}

// Estimate final placement based on health and turns survived
function estimatePlacement(health, turns) {
  // 8th = died very early, 1st = survived longest with most health
  if (health <= 0) {
    if (turns <= 7) return 8;
    if (turns <= 9) return 7;
    if (turns <= 11) return 6;
    if (turns <= 13) return 5;
    return 4;
  }
  if (health >= 25 && turns >= 14) return 1;
  if (health >= 20) return 2;
  if (health >= 12) return 3;
  if (health >= 5) return 4;
  return 5;
}

// ═══════════════════════════════════════════════════════════
// BATCH SIMULATION
// ═══════════════════════════════════════════════════════════

function runBatch(gamesPerHero, guidanceMode) {
  var heroes = Object.keys(heroStatsById);
  // Sample heroes
  var sampleHeroes = [];
  for (var i = 0; i < Math.min(heroes.length, 20); i++) {
    sampleHeroes.push(heroes[Math.floor(Math.random() * heroes.length)]);
  }

  var results = [];
  for (var h = 0; h < sampleHeroes.length; h++) {
    var heroId = sampleHeroes[h];
    for (var g = 0; g < gamesPerHero; g++) {
      var result = runOneGame(heroId, guidanceMode, false);
      results.push(result);
    }
  }
  return results;
}

// Run and report
console.log("╔══════════════════════════════════════════╗");
console.log("║   Bob教练 模拟对局测试                    ║");
console.log("╚══════════════════════════════════════════╝");
console.log("");

var modes = ["full", "partial", "none"];
var modeLabels = { full: "完全遵循指导", partial: "部分遵循指导(50%)", none: "随机决策(无指导)" };
var allResults = {};

for (var m = 0; m < modes.length; m++) {
  var mode = modes[m];
  console.log("模拟: " + modeLabels[mode] + " (20 heroes × 5 games)");
  var results = runBatch(5, mode);
  allResults[mode] = results;

  var avgPlacement = 0;
  var avgTurns = 0;
  var avgHealth = 0;
  var avgPower = 0;
  var top4Rate = 0;
  var top1Rate = 0;
  var diedRate = 0;

  for (var r = 0; r < results.length; r++) {
    avgPlacement += results[r].placement;
    avgTurns += results[r].turns;
    avgHealth += results[r].finalHealth;
    avgPower += results[r].finalBoardPower;
    if (results[r].placement <= 4) top4Rate++;
    if (results[r].placement === 1) top1Rate++;
    if (results[r].died) diedRate++;
  }
  var n = results.length;
  avgPlacement /= n;
  avgTurns /= n;
  avgHealth /= n;
  avgPower /= n;
  top4Rate = (top4Rate / n * 100);
  top1Rate = (top1Rate / n * 100);
  diedRate = (diedRate / n * 100);

  console.log("");
  console.log("  ┌─────────────────────────────────────────┐");
  console.log("  │ " + modeLabels[mode].padEnd(13) + "                        │");
  console.log("  ├─────────────────────────────────────────┤");
  console.log("  │ 平均排名:  " + avgPlacement.toFixed(2).padStart(6) + "                        │");
  console.log("  │ 前4率:     " + top4Rate.toFixed(1).padStart(6) + "%                       │");
  console.log("  │ 吃鸡率:    " + top1Rate.toFixed(1).padStart(6) + "%                       │");
  console.log("  │ 死亡局:    " + diedRate.toFixed(1).padStart(6) + "%                       │");
  console.log("  │ 平均回合:  " + avgTurns.toFixed(1).padStart(6) + "                        │");
  console.log("  │ 剩余血量:  " + avgHealth.toFixed(1).padStart(6) + "                        │");
  console.log("  │ 最终战力:  " + avgPower.toFixed(2).padStart(6) + "                        │");
  console.log("  └─────────────────────────────────────────┘");
}

// Save detailed results
fs.writeFileSync(
  path.join(base, "sim_results.json"),
  JSON.stringify(allResults, null, 2),
  "utf-8"
);
console.log("\n详细结果已保存到 sim_results.json");
