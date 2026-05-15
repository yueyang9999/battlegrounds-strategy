"use strict";

// ── 种族配置 ──
var ALL_RACES = ["亡灵", "鱼人", "野兽", "机械", "恶魔", "海盗", "巨龙", "野猪人", "纳迦", "元素"];
var FORBIDDEN_PAIRS = [["巨龙", "野兽"]];

// 每种星级在卡池中的份数
var COPIES_PER_TIER = { 1: 18, 2: 15, 3: 13, 4: 11, 5: 9, 6: 6 };

// 各星级酒馆刷新数量
var SHOP_SIZES = { 1: 3, 2: 4, 3: 4, 4: 5, 5: 5, 6: 6 };

var SharedPool = class SharedPool {
  constructor(cardsById) {
    this.cardsById = cardsById;
    this.counts = {};   // { cardId: remainingCopies }
    this.selectedRaces = [];
    this.availableMinions = []; // all minion cardIds available this game
  }

  selectRaces(rng) {
    var pool = ALL_RACES.slice();
    while (true) {
      rng.shuffle(pool);
      var races = pool.slice(0, 5);
      var valid = true;
      for (var i = 0; i < FORBIDDEN_PAIRS.length; i++) {
        var a = FORBIDDEN_PAIRS[i][0];
        var b = FORBIDDEN_PAIRS[i][1];
        if (races.indexOf(a) !== -1 && races.indexOf(b) !== -1) {
          valid = false;
          break;
        }
      }
      if (valid) {
        this.selectedRaces = races;
        return races;
      }
    }
  }

  init(selectedRaces) {
    this.selectedRaces = selectedRaces || this.selectedRaces;
    this.counts = {};
    this.availableMinions = [];

    var sortedAllIds = Object.keys(this.cardsById).sort();
    for (var ki = 0; ki < sortedAllIds.length; ki++) {
      var cardId = sortedAllIds[ki];
      var c = this.cardsById[cardId];
      if (c.card_type !== "minion") continue;
      if (!c.tier || c.tier < 1 || c.tier > 6) continue;

      // 排除伙伴/任务/畸变等特殊随从 (不进入公共卡池)
      if (cardId.indexOf("Buddy") !== -1 || cardId.indexOf("_Buddy") !== -1) continue;
      if (cardId.indexOf("Quest") !== -1 || cardId.indexOf("_Quest") !== -1) continue;
      if (cardId.indexOf("Anomaly") !== -1 || cardId.indexOf("_Anomaly") !== -1) continue;
      if (cardId.indexOf("Reward") !== -1 || cardId.indexOf("_Reward") !== -1) continue;

      // 检查种族是否在局
      var inGame = false;
      var tribes = c.minion_types_cn || [];

      // 中立/全部种族始终在局
      if (tribes.length === 0 || (tribes.length === 1 && tribes[0] === "中立")) {
        inGame = true;
        // 有关联种族的随从（如小粉关联恶魔）需要对应种族在局
        if (c.associated_race && this.selectedRaces.indexOf(c.associated_race) === -1) {
          inGame = false;
        }
      }

      for (var t = 0; t < tribes.length; t++) {
        if (this.selectedRaces.indexOf(tribes[t]) !== -1) {
          inGame = true;
          break;
        }
      }

      if (!inGame) continue;

      var copies = COPIES_PER_TIER[c.tier] || 7;
      this.counts[cardId] = copies;
      this.availableMinions.push(cardId);
    }
  }

  remove(cardId, count) {
    count = count || 1;
    if (!this.counts[cardId] || this.counts[cardId] < count) return false;
    this.counts[cardId] -= count;
    return true;
  }

  returnToPool(cardId, count) {
    count = count || 1;
    if (this.counts[cardId] === undefined) this.counts[cardId] = 0;
    this.counts[cardId] += count;
  }

  returnBoard(board) {
    for (var i = 0; i < board.length; i++) {
      var m = board[i];
      var copies = m.golden ? 3 : 1;
      this.returnToPool(m.cardId, copies);
    }
  }

  availableCount(cardId) {
    return this.counts[cardId] || 0;
  }

  // 为一名玩家刷新酒馆
  refreshShop(tavernTier, rng) {
    var shop = [];
    var shopSize = SHOP_SIZES[tavernTier] || 3;

    // 收集当前可访问的卡池（随机等级 <= 酒馆等级的随从）
    var accessiblePool = [];
    var sortedCountsIds = Object.keys(this.counts).sort();
    for (var si = 0; si < sortedCountsIds.length; si++) {
      var cardId = sortedCountsIds[si];
      var count = this.counts[cardId];
      if (count <= 0) continue;
      var c = this.cardsById[cardId];
      if (!c || c.tier > tavernTier) continue;
      for (var i = 0; i < count; i++) {
        accessiblePool.push(cardId);
      }
    }

    if (accessiblePool.length === 0) return shop;

    rng.shuffle(accessiblePool);
    var drawn = {};
    for (var i = 0; i < Math.min(shopSize, accessiblePool.length); i++) {
      var id = accessiblePool[i];
      if (!this.remove(id)) continue; // pool exhausted for this card
      drawn[id] = (drawn[id] || 0) + 1;
      shop.push(id);
    }

    return shop;
  }

  // 发现：从指定星级的随从中随机选取
  discoverCard(tier, rng) {
    var candidates = [];
    var sortedDiscIds = Object.keys(this.counts).sort();
    for (var di = 0; di < sortedDiscIds.length; di++) {
      var cardId = sortedDiscIds[di];
      if (this.counts[cardId] <= 0) continue;
      var c = this.cardsById[cardId];
      if (!c || c.tier !== tier) continue;
      candidates.push(cardId);
    }
    if (candidates.length === 0) return null;
    var picked = rng.pick(candidates);
    this.remove(picked);
    return picked;
  }

  // 获取指定星级的可选随从列表（用于发现3选1）
  discoverOptions(tier, count, rng) {
    var candidates = [];
    var sortedOptIds = Object.keys(this.counts).sort();
    for (var oi = 0; oi < sortedOptIds.length; oi++) {
      var cardId = sortedOptIds[oi];
      if (this.counts[cardId] <= 0) continue;
      var c = this.cardsById[cardId];
      if (!c || c.tier !== tier) continue;
      candidates.push(cardId);
    }
    rng.shuffle(candidates);
    return candidates.slice(0, count || 3);
  }
};
