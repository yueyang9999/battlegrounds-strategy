"use strict";

// ═══════════════════════════════════════════════════════════
// SimulationEngine — 8人模拟对局顶层编排器
// ═══════════════════════════════════════════════════════════

var SimulationEngine = {

  // 所有模块和数据引用（由 simulate_games.js 注入）
  _cardsById: null,
  _cardsByTier: null,
  _heroStatsById: null,
  _decisionTables: null,
  _comps: null,
  _lookup: null,
  _moduleCtors: null, // { LevelingModule, MinionPickModule, ... }

  init: function(opts) {
    this._cardsById = opts.cardsById;
    this._cardsByTier = opts.cardsByTier;
    this._heroStatsById = opts.heroStatsById;
    this._decisionTables = opts.decisionTables;
    this._comps = opts.comps;
    this._lookup = opts.lookup;
    this._levelingCurve = opts.levelingCurve;
    this._heroOverrides = opts.heroOverrides;
  },

  // 运行指定数量的8人对局
  runBatch: function(gameCount, config) {
    config = config || {};
    var bobCount = config.bobPlayerCount || 1;
    var heuristicCount = config.heuristicPlayerCount || 7;
    var baseSeed = config.seed || 42;
    var verbose = config.verbose || false;

    var allResults = [];

    for (var g = 0; g < gameCount; g++) {
      var gameSeed = baseSeed + g * 1000;
      var rng = new SeededRNG(gameSeed);
      var result = this.runOneGame(g, bobCount, heuristicCount, rng, verbose);
      allResults.push(result);
    }

    return allResults;
  },

  // 运行一局8人对局
  runOneGame: function(gameIndex, bobCount, heuristicCount, rng, verbose) {
    var MAX_TURNS = 25;
    var cardsById = this._cardsById;
    var heroStatsById = this._heroStatsById;

    // ── 1. 种族选取 ──
    var sharedPool = new SharedPool(cardsById);
    var selectedRaces = sharedPool.selectRaces(rng);
    sharedPool.init(selectedRaces);

    // ── 2. 选取英雄 ──
    var heroIds = Object.keys(heroStatsById);
    rng.shuffle(heroIds);
    var totalPlayers = bobCount + heuristicCount;
    if (totalPlayers !== 8) totalPlayers = 8; // force 8

    var players = [];
    for (var i = 0; i < totalPlayers; i++) {
      var heroId = heroIds[i % heroIds.length];
      var aiType = i < bobCount ? "bob" : "heuristic";
      var player = new PlayerAgent(i + 1, heroId, aiType, {});
      ArmorSystem.initPlayer(player, heroId, cardsById);

      // 英雄技能费用
      var heroCard = cardsById[heroId];
      if (heroCard && heroCard.hp_ids && heroCard.hp_ids.length > 0) {
        var hpCard = cardsById[heroCard.hp_ids[0]];
        player.heroPowerCost = (hpCard && hpCard.mana_cost) ? hpCard.mana_cost : 1;
      } else {
        player.heroPowerCost = 1;
      }

      // 英雄特定曲线
      if (this._heroOverrides && this._heroOverrides[heroId]) {
        player.curveType = this._heroOverrides[heroId].curve_type || "standard";
      }

      // 非Bob教练玩家分配AI流派倾向
      if (aiType === "heuristic" && typeof HeuristicAI !== "undefined") {
        player.aiPersonality = HeuristicAI.assignPersonality(
          new SeededRNG(gameIndex * 30000 + i * 100)
        );
      }

      // 验证初始护甲值
      if (verbose && i === 0) {
        console.log("Hero: " + (heroCard ? heroCard.name_cn : heroId) +
                    " | HP: " + player.health + " | Armor: " + player.armor +
                    " | Tier: " + player.tavernTier);
      }

      players.push(player);
    }

    // ── 初始化对手追踪器 ──
    if (typeof OpponentTracker !== "undefined") {
      OpponentTracker.init(players);
    }

    var matchHistory = [];
    var turn = 1;

    // ── 主循环 ──
    while (true) {
      var alivePlayers = players.filter(function(p) { return p.alive; });

      if (alivePlayers.length <= 1) break;
      if (turn > MAX_TURNS) break;

      if (verbose && turn <= 3) {
        console.log("--- Turn " + turn + " | Alive: " + alivePlayers.length + " | Races: " + selectedRaces.join(", ") + " ---");
      }

      // ── 招募阶段 ──
      for (var pi = 0; pi < players.length; pi++) {
        var p = players[pi];
        if (!p.alive) continue;

        p.startTurn(turn, sharedPool, new SeededRNG(gameIndex * 10000 + pi * 100 + turn), cardsById);

        // 构建决策上下文
        var ctx = this._buildContext(p, turn, cardsById, sharedPool);

        // 根据AI类型决策
        var decisions;
        if (p.aiType === "bob") {
          decisions = this._runBobCoach(p, ctx);
        } else {
          decisions = HeuristicAI.decide(p, ctx, new SeededRNG(gameIndex * 20000 + pi * 100 + turn));
        }

        p.totalDecisions += decisions.length;

        // 应用决策
        this._applyDecisions(p, decisions, sharedPool, turn, ctx, cardsById, verbose && p.aiType === "bob");
      }

      // ── 配对阶段 ──
      var pairs = MatchmakingSystem.pair(alivePlayers, matchHistory, turn, new SeededRNG(gameIndex * 500 + turn));

      // ── 战斗阶段（第1回合跳过，第2回合开始战斗）──
      var roundHistory = [];
      if (turn >= 2) {
      for (var pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
        var pair = pairs[pairIdx];
        var attacker = pair[0];
        var defender = pair[1];

        if (!defender) {
          // 奇数配对：只记录
          roundHistory.push([attacker.id, null]);
          continue;
        }

        var result = CombatResolver.simulateCombat(
          attacker.board,
          defender.board,
          attacker.tavernTier,
          new SeededRNG(attacker.id * 70000 + defender.id * 100 + turn)
        );

        var aliveCount = alivePlayers.length;

        if (result.win) {
          // attacker wins
          var damage = DamageSystem.cappedDamage(
            attacker.tavernTier,
            result.attackerSurvivors,
            turn,
            aliveCount
          );
          if (!defender.isGhost) {
            ArmorSystem.applyDamage(defender, damage);
          }
          if (verbose && turn <= 3 && attacker.aiType === "bob") {
            console.log("  Combat: WIN vs Player " + defender.id + " | dmg: " + damage +
                        " | survivors: " + result.attackerAlive);
          }
        } else {
          // defender wins
          var defDamage = DamageSystem.cappedDamage(
            defender.tavernTier,
            result.defenderSurvivors,
            turn,
            aliveCount
          );
          if (!attacker.isGhost) {
            ArmorSystem.applyDamage(attacker, defDamage);
          }
          if (verbose && turn <= 3 && attacker.aiType === "bob") {
            console.log("  Combat: LOSS vs Player " + defender.id + " | dmg: " + defDamage +
                        " | our survivors: " + result.attackerAlive);
          }
        }

        // ── 记录对手追踪数据 ──
        if (typeof OpponentTracker !== "undefined") {
          OpponentTracker.recordBoardSummary(attacker.id, attacker.board);
          if (!defender.isGhost) {
            OpponentTracker.recordBoardSummary(defender.id, defender.board);
          }
          OpponentTracker.recordCombat(attacker.id, defender.id, result, turn);
        }

        roundHistory.push([attacker.id, defender.id]);
      }
      } // end if (turn >= 2)
      matchHistory.push(roundHistory);

      // ── 淘汰回收 ──
      var stillAlive = [];
      for (var ei = 0; ei < players.length; ei++) {
        var ep = players[ei];
        if (!ep.alive) continue;
        if (!ArmorSystem.isAlive(ep)) {
          ep.alive = false;
          var aliveNow = players.filter(function(x) { return x.alive; }).length;
          ep.placement = aliveNow + 1;
          sharedPool.returnBoard(ep.board);
          if (typeof OpponentTracker !== "undefined") {
            OpponentTracker.markEliminated(ep.id, ep.placement);
          }
          if (verbose) {
            console.log("  Player " + ep.id + " (" + ep.heroCardId + ") eliminated at placement " + ep.placement);
          }
        } else {
          stillAlive.push(ep);
        }
      }

      // 更新对子记忆
      for (var mi = 0; mi < players.length; mi++) {
        if (players[mi].alive) players[mi].updatePairMemory(turn);
      }

      turn++;
    }

    // ── 终局排名 ──
    var finalAlive = players.filter(function(p) { return p.alive; });
    for (var fi = 0; fi < finalAlive.length; fi++) {
      finalAlive[fi].placement = fi + 1;
    }
    // 补全已淘汰玩家的排名
    for (var ri = 0; ri < players.length; ri++) {
      if (players[ri].placement === 0) players[ri].placement = finalAlive.length + 1;
    }

    // 排序确定最终排名
    players.sort(function(a, b) { return a.placement - b.placement; });

    if (verbose) {
      console.log("Game " + gameIndex + " results:");
      for (var si = 0; si < players.length; si++) {
        console.log("  " + (si + 1) + ". Player " + players[si].id + " (" + players[si].aiType +
                    ") " + (players[si].heroCardId) + " HP:" + players[si].health);
      }
    }

    return {
      gameIndex: gameIndex,
      players: players,
      selectedRaces: selectedRaces,
      totalTurns: turn - 1,
    };
  },

  // 构建Bob教练决策上下文
  _buildContext: function(player, turn, cardsById, sharedPool) {
    var dt = this._decisionTables;
    var comps = this._comps;

    // 核心卡ID集合
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

    // 英雄信息
    var heroCard = cardsById[player.heroCardId];
    var heroName = heroCard ? heroCard.name_cn : player.heroCardId;
    var heroStats = this._heroStatsById ? this._heroStatsById[player.heroCardId] : null;

    // 估算场面战力
    var boardPower = 0;
    for (var i = 0; i < player.board.length; i++) {
      var m = player.board[i];
      boardPower += (m.tier || 1) * 0.2 + (m.attack || 1) * 0.05 + (m.health || 1) * 0.05;
    }

    // ── 对手推测 ──
    var nextOppId = null;
    var nextOppSummary = null;
    if (typeof OpponentTracker !== "undefined" && turn >= 2) {
      var recentOpps = OpponentTracker.getRecentOpponents(player.id, 2);
      if (recentOpps.length >= 2 && recentOpps[recentOpps.length - 1] === recentOpps[recentOpps.length - 2]) {
        nextOppId = recentOpps[recentOpps.length - 1];
      } else if (recentOpps.length >= 1) {
        nextOppId = recentOpps[recentOpps.length - 1];
      }
      if (nextOppId) {
        nextOppSummary = OpponentTracker.getOpponentSummary(nextOppId);
      }
    }

    return {
      turn: turn,
      gold: player.gold,
      maxGold: player.maxGold,
      tavernTier: player.tavernTier,
      health: player.health,
      armor: player.armor,
      heroCardId: player.heroCardId,
      heroName: heroName,
      boardMinions: player.board,
      handMinions: player.hand,
      shopMinions: player.shop,
      shopSpells: player.spellShop,
      gamePhase: "recruit",
      heroTips: {},
      heroTipList: [],
      heroStats: heroStats,
      boardPower: boardPower,
      dominantTribe: player.getDominantTribe(),
      compMatches: [],
      currentComp: null,
      curveType: player.curveType,
      decisionTables: dt,
      heroPowerCost: player.heroPowerCost,
      heroPowerUsable: !player.heroPowerUsed,
      activeAnomaly: player.anomaly,
      activeRewards: player.rewards,
      trinketOffer: player.trinkets,
      trinketTips: {},
      _heroHpMap: {},
      _heroPowerCost: {},
      _compCoreCardIds: coreCardIds,
      _spellInteractions: this._lookup,
      _cardsById: cardsById,
      _shopEvaluations: null,
      frozenShop: player.frozen,
      freeRefreshCount: 0,
      hpRefreshRemaining: 0,
      _pairMemory: player.pairMemory,
      _opponentTracker: typeof OpponentTracker !== "undefined" ? OpponentTracker : null,
      _bobPlayerId: player.id,
      _nextOpponentId: nextOppId,
      _nextOpponentSummary: nextOppSummary,
    };
  },

  // 运行Bob教练决策引擎
  _runBobCoach: function(player, ctx) {
    var dt = this._decisionTables;

    // 实例化所有模块
    var modules = [];
    if (typeof LevelingModule !== "undefined") modules.push(new LevelingModule(dt));
    if (typeof MinionPickModule !== "undefined") modules.push(new MinionPickModule(dt));
    if (typeof HeroPowerModule !== "undefined") modules.push(new HeroPowerModule(dt));
    if (typeof SpellModule !== "undefined") modules.push(new SpellModule(dt));
    if (typeof TrinketModule !== "undefined") modules.push(new TrinketModule(dt));
    if (typeof RefreshModule !== "undefined") modules.push(new RefreshModule(dt));
    if (typeof FreezeModule !== "undefined") modules.push(new FreezeModule(dt));
    if (typeof SellModule !== "undefined") modules.push(new SellModule(dt));
    if (typeof OpponentAnalysisModule !== "undefined") modules.push(new OpponentAnalysisModule({
      counter_tags: (dt && dt.counter_tags) || {},
      opponent_analysis: (dt && dt.opponent_analysis) || {},
    }));

    var allDecisions = [];
    for (var i = 0; i < modules.length; i++) {
      var modDecs = modules[i].evaluate(ctx);
      if (modDecs && modDecs.length > 0) {
        allDecisions = allDecisions.concat(modDecs);
      }
    }

    // 按优先级×置信度排序
    allDecisions.sort(function(a, b) {
      return (b.priority * b.confidence) - (a.priority * a.confidence);
    });

    return allDecisions;
  },

  // 应用决策
  _applyDecisions: function(player, decisions, sharedPool, turn, ctx, cardsById, verbose) {
    var goldSpent = 0;
    var didLevelUp = false;
    var usedHeroPower = false;

    // 按优先级排序
    var sorted = decisions.slice().sort(function(a, b) {
      return (b.priority * b.confidence) - (a.priority * a.confidence);
    });

    // PHASE 0: 卖牌
    for (var d = 0; d < sorted.length; d++) {
      var dec = sorted[d];
      if (dec.type !== "sell_minion") continue;
      var idx = dec.data.boardIndex;
      if (idx !== undefined && idx < player.board.length) {
        var sold = player.sellMinionForGold(idx);
        if (sold) {
          sharedPool.returnToPool(sold.cardId, sold.golden ? 3 : 1);
          player.followedDecisions++;
          player.decisionsMade.push({ turn: turn, action: "sell_minion", cardId: sold.cardId, followed: true });
        }
      }
    }

    // PHASE 1: 升本
    for (var d2 = 0; d2 < sorted.length; d2++) {
      var ldec = sorted[d2];
      if (ldec.type !== "level_up" || didLevelUp) continue;
      var cost = ldec.data.cost || player.levelUpCost;
      if (player.gold >= cost) {
        if (player.levelUp()) {
          didLevelUp = true;
          player.followedDecisions++;
          player.decisionsMade.push({ turn: turn, action: "level_up", followed: true });
        }
      }
    }

    // PHASE 2: 购买随从/法术
    for (var d3 = 0; d3 < sorted.length; d3++) {
      var bdec = sorted[d3];
      var cost = bdec.data.cost || 3;

      if (bdec.type === "minion_pick" && player.gold >= cost && player.board.length < 7) {
        var idx2 = bdec.data.position !== undefined ? bdec.data.position : bdec.data.shopIndex;
        if (idx2 !== undefined && idx2 < player.shop.length) {
          var bought = player.buyMinion(idx2, sharedPool);
          if (bought) {
            // HP-cost 卡处理
            if (bdec.data.hpCost && bdec.data.hpCost > 0) {
              ArmorSystem.deductCost(player, bdec.data.hpCost);
            }
            player.followedDecisions++;
            player.decisionsMade.push({ turn: turn, action: "buy_minion", cardId: bought.cardId, followed: true });
          }
        }
      } else if (bdec.type === "spell_buy" && player.gold >= cost) {
        // 从法术商店找到对应法术
        for (var si = 0; si < player.spellShop.length; si++) {
          if (player.spellShop[si].cardId === bdec.data.cardId) {
            var spell = player.spellShop.splice(si, 1)[0];
            player.gold -= cost;
            // 护甲法术效果
            if (spell.cardId === "BG28_500") {
              ArmorSystem.applySetArmor(player, 5);
            } else if (spell.cardId === "BG34_Treasure_934") {
              ArmorSystem.applyAddArmor(player, 10);
            } else if (spell.cardId === "BG30_802") {
              // 智慧球：2次有用刷新充能
              player.wisdomBallCharges = 2;
            }
            player.followedDecisions++;
            player.decisionsMade.push({ turn: turn, action: "buy_spell", cardId: spell.cardId, followed: true });
            break;
          }
        }
      } else if ((bdec.type === "refresh" || bdec.type === "refresh_smart") && player.gold >= 1) {
        var refreshCost = (typeof RulesEngine !== "undefined" && RulesEngine.getEffectiveRefreshCost)
          ? RulesEngine.getEffectiveRefreshCost(ctx)
          : 1;
        if (player.gold >= refreshCost) {
          player.gold -= refreshCost;
          player._refreshShop(sharedPool, new SeededRNG(player.id * 1000 + turn), cardsById);
          player.followedDecisions++;
          player.decisionsMade.push({ turn: turn, action: "refresh", followed: true });
        }
      } else if (bdec.type === "freeze") {
        player.frozen = true;
        player.followedDecisions++;
        player.decisionsMade.push({ turn: turn, action: "freeze", followed: true });
      } else if (bdec.type === "unfreeze") {
        player.frozen = false;
        player.followedDecisions++;
        player.decisionsMade.push({ turn: turn, action: "unfreeze", followed: true });
      }
    }

    // PHASE 3: 英雄技能
    for (var d4 = 0; d4 < sorted.length; d4++) {
      var hdec = sorted[d4];
      if (hdec.type !== "hero_power" || usedHeroPower) continue;
      var hpCost = hdec.data.cost || player.heroPowerCost;
      if (player.gold >= hpCost && player.useHeroPower(hpCost)) {
        usedHeroPower = true;
        player.followedDecisions++;
        player.decisionsMade.push({ turn: turn, action: "hero_power", followed: true });
      }
    }
  }
};
