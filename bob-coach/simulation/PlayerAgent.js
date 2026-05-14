"use strict";

// ═══════════════════════════════════════════════════════════
// PlayerAgent — 单个玩家的完整状态机
// ═══════════════════════════════════════════════════════════

var PlayerAgent = class PlayerAgent {
  constructor(id, heroCardId, aiType, config) {
    this.id = id;
    this.heroCardId = heroCardId;
    this.aiType = aiType; // "bob" | "heuristic"
    this.config = config || {};

    // 状态
    this.health = 30;
    this.maxHealth = 30;
    this.armor = 0;
    this.gold = 0;
    this.maxGold = 2;
    this.tavernTier = 1;
    this.levelUpCost = 5;

    this.board = [];
    this.hand = [];
    this.shop = [];
    this.spellShop = [];
    this.frozen = false;

    this.heroPowerUsed = false;
    this.heroPowerCost = 1;

    this.trinkets = [];
    this.rewards = [];
    this.anomaly = null;

    this.alive = true;
    this.placement = 0;
    this.curveType = "standard";

    // 对子记忆
    this.pairMemory = {};

    // 智慧球充能
    this.wisdomBallCharges = 0;

    // 决策追踪
    this.decisionsMade = [];
    this.totalDecisions = 0;
    this.followedDecisions = 0;
  }

  // 回合开始：收入 + 升本费-1 + 刷新酒馆
  startTurn(turn, sharedPool, rng, cardsById) {
    // 收入（保留上回合未用完的金币）
    this.maxGold = Math.min(this.maxGold + 1, 10);
    var unspent = Math.max(0, this.gold);
    this.gold = this.maxGold + unspent;
    // 上限（允许超出10但会被决策消耗掉）
    if (this.gold > 20) this.gold = 20;
    this.heroPowerUsed = false;

    // 升本费用每回合-1
    this.levelUpCost = Math.max(0, this.levelUpCost - 1);

    // 刷新酒馆（如果上回合冻结则跳过，之后重置冻结标记）
    if (!this.frozen && sharedPool) {
      this._refreshShop(sharedPool, rng, cardsById);
    }
    this.frozen = false;
  }

  _refreshShop(sharedPool, rng, cardsById) {
    var shopIds = sharedPool.refreshShop(this.tavernTier, rng);
    this.shop = [];
    for (var i = 0; i < shopIds.length; i++) {
      var card = cardsById[shopIds[i]];
      if (card) {
        var mechs = card.mechanics || [];
        this.shop.push({
          cardId: card.str_id,
          name_cn: card.name_cn || card.str_id,
          tier: card.tier || 1,
          attack: card.attack || 1,
          health: card.health || 1,
          tribes_cn: card.minion_types_cn || [],
          mechanics: mechs,
          text_cn: card.text_cn || "",
          position: i,
        });
      }
    }

    // 智慧球效果（如果有充能）
    if (this.wisdomBallCharges > 0 && typeof WisdomBall !== "undefined") {
      WisdomBall.resolveUsefulRefresh(this, sharedPool, rng, cardsById);
      this.wisdomBallCharges--;
    }
  }

  // 购买随从
  buyMinion(shopIndex, sharedPool) {
    if (shopIndex < 0 || shopIndex >= this.shop.length) return null;
    if (this.gold < 3) return null;
    if (this.board.length + this.hand.length >= 7) return null;

    var minion = this.shop.splice(shopIndex, 1)[0];
    this.gold -= 3;
    this.board.push({
      cardId: minion.cardId,
      name_cn: minion.name_cn,
      tier: minion.tier,
      attack: minion.attack || 1,
      health: minion.health || 1,
      golden: false,
      tribes_cn: minion.tribes_cn || [],
      mechanics: minion.mechanics || [],
      position: this.board.length,
    });
    return minion;
  }

  // 购买法术
  buySpell(spellIndex) {
    if (spellIndex < 0 || spellIndex >= this.spellShop.length) return null;
    if (this.gold < 1) return null;

    var spell = this.spellShop.splice(spellIndex, 1)[0];
    this.gold -= 1;
    return spell;
  }

  // 出售随从
  sellMinion(boardIndex) {
    if (boardIndex < 0 || boardIndex >= this.board.length) return 0;
    var minion = this.board.splice(boardIndex, 1)[0];
    var price = minion.golden ? 3 : 1;
    this.gold += price;
    // 重新计算position
    for (var i = 0; i < this.board.length; i++) {
      this.board[i].position = i;
    }
    return price;
  }

  // 升本
  levelUp() {
    if (this.gold < this.levelUpCost) return false;
    if (this.tavernTier >= 6) return false;
    this.gold -= this.levelUpCost;
    this.tavernTier++;
    this.levelUpCost = this.tavernTier + 4; // baseline: 5, 6, 7, 8, 9, 10
    return true;
  }

  // 使用英雄技能
  useHeroPower(cost) {
    cost = cost || this.heroPowerCost;
    if (this.heroPowerUsed) return false;
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.heroPowerUsed = true;
    return true;
  }

  // 出售随从获得铸币(用于卖牌模块)
  sellMinionForGold(boardIndex) {
    if (boardIndex < 0 || boardIndex >= this.board.length) return null;
    var minion = this.board.splice(boardIndex, 1)[0];
    var price = minion.golden ? 3 : 1;
    this.gold += price;
    // 重新计算position
    for (var i = 0; i < this.board.length; i++) {
      this.board[i].position = i;
    }
    return minion;
  }

  // 收到战斗伤害
  takeDamage(amount, turn, alivePlayerCount, armorSystem, damageSystem) {
    var capped = damageSystem
      ? damageSystem.applyCap(amount, turn, alivePlayerCount)
      : amount;
    if (armorSystem) {
      armorSystem.applyDamage(this, capped);
    } else {
      this.health -= capped;
    }
  }

  // 存活判定
  isAlive() {
    return this.health > 0;
  }

  // 更新对子记忆
  updatePairMemory(turn) {
    var freshCounts = {};
    for (var i = 0; i < this.board.length; i++) {
      var bm = this.board[i];
      if (!bm.golden) {
        freshCounts[bm.cardId] = (freshCounts[bm.cardId] || 0) + 1;
      }
    }
    for (var cid in freshCounts) {
      if (freshCounts[cid] >= 2) {
        this.pairMemory[cid] = { count: freshCounts[cid], seenAtTurn: turn };
      } else {
        delete this.pairMemory[cid];
      }
    }
    for (var pmCid in this.pairMemory) {
      if (!freshCounts[pmCid]) delete this.pairMemory[pmCid];
    }
  }

  // 获取主导种族
  getDominantTribe() {
    var tribeCounts = {};
    for (var i = 0; i < this.board.length; i++) {
      var tribes = this.board[i].tribes_cn || [];
      for (var t = 0; t < tribes.length; t++) {
        tribeCounts[tribes[t]] = (tribeCounts[tribes[t]] || 0) + 1;
      }
    }
    var maxTribe = null;
    var maxCount = 0;
    for (var tribe in tribeCounts) {
      if (tribeCounts[tribe] > maxCount) { maxTribe = tribe; maxCount = tribeCounts[tribe]; }
    }
    return maxTribe;
  }
};
