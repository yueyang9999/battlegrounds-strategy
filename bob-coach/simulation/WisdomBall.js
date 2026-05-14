"use strict";

// ═══════════════════════════════════════════════════════════
// WisdomBall — 智慧球有用刷新效果 (BG30_802 / BG24_Reward_313)
// ═══════════════════════════════════════════════════════════
//
// 6种有用刷新效果：
//   1. 复制阵容 — 商店填满当前棋盘随从的普通副本
//   2. 相同随从页 — 商店全部是同一个随机随从
//   3. 高星中立页 — 商店全部是5-6星中立随从
//   4. 七星随从 — 获得一个随机7星随从加入手牌
//   5. 法术页 — 商店全部是随机酒馆法术
//   6. 刷新点金 — 刷新商店并使一个随机随从变金色

var WisdomBall = {

  EFFECTS: [
    { id: "copy_board",       name: "复制阵容",  weight: 1.0 },
    { id: "same_minion",      name: "相同随从",  weight: 1.0 },
    { id: "high_tier_neutral", name: "高星中立",  weight: 1.0 },
    { id: "tier_7",           name: "七星随从",  weight: 0.6 },
    { id: "spells_page",      name: "法术页",    weight: 0.8 },
    { id: "refresh_gild",     name: "刷新点金",  weight: 1.0 },
  ],

  // 玩家购买智慧球时调用：设置充能
  applyWisdomBallCharges: function(player) {
    player.wisdomBallCharges = 2;
  },

  // 每次刷新时调用（如果充能 > 0）
  resolveUsefulRefresh: function(player, sharedPool, rng, cardsById) {
    var effect = this._rollEffect(rng, player.tavernTier);
    this._applyEffect(effect, player, sharedPool, rng, cardsById);
  },

  _rollEffect: function(rng, tavernTier) {
    // 七星随从只有6本才可能roll到
    var candidates = [];
    for (var i = 0; i < this.EFFECTS.length; i++) {
      var e = this.EFFECTS[i];
      if (e.id === "tier_7" && tavernTier < 6) continue;
      candidates.push(e);
    }
    // 加权随机
    var total = 0;
    for (var i = 0; i < candidates.length; i++) total += candidates[i].weight;
    var roll = rng.random() * total;
    var cumulative = 0;
    for (var i = 0; i < candidates.length; i++) {
      cumulative += candidates[i].weight;
      if (roll <= cumulative) return candidates[i];
    }
    return candidates[0];
  },

  _applyEffect: function(effect, player, sharedPool, rng, cardsById) {
    switch (effect.id) {
      case "copy_board":
        this._effectCopyBoard(player, rng, cardsById);
        break;
      case "same_minion":
        this._effectSameMinion(player, sharedPool, rng, cardsById);
        break;
      case "high_tier_neutral":
        this._effectHighTierNeutral(player, sharedPool, rng, cardsById);
        break;
      case "tier_7":
        this._effectTier7(player, rng, cardsById);
        break;
      case "spells_page":
        this._effectSpellsPage(player, rng, cardsById);
        break;
      case "refresh_gild":
        this._effectRefreshGild(player, sharedPool, rng, cardsById);
        break;
    }
  },

  // 1. 复制阵容：商店变成棋盘随从的普通副本
  _effectCopyBoard: function(player, rng, cardsById) {
    player.shop = [];
    for (var i = 0; i < player.board.length; i++) {
      var bm = player.board[i];
      player.shop.push({
        cardId: bm.cardId,
        name_cn: bm.name_cn || bm.cardId,
        tier: bm.tier || 1,
        attack: bm.attack || 1,
        health: bm.health || 1,
        tribes_cn: bm.tribes_cn || [],
        mechanics: bm.mechanics || [],
        text_cn: "",
        position: i,
        golden: false,
      });
    }
  },

  // 2. 相同随从页：所有栏位是同一个随机随从
  _effectSameMinion: function(player, sharedPool, rng, cardsById) {
    var shopSize = player.shop.length > 0 ? player.shop.length : (3 + player.tavernTier);
    // 从当前可访问卡池中随机选一个随从
    var allPool = [];
    var sortedCardIds = Object.keys(cardsById).sort(); for (var _i = 0; _i < sortedCardIds.length; _i++) { var cardId = sortedCardIds[_i];
      var c = cardsById[cardId];
      if (c.card_type !== "minion") continue;
      if (!c.tier || c.tier > player.tavernTier) continue;
      allPool.push(c);
    }
    if (allPool.length === 0) return;
    var picked = rng.pick(allPool);
    player.shop = [];
    for (var i = 0; i < shopSize; i++) {
      player.shop.push({
        cardId: picked.str_id,
        name_cn: picked.name_cn || picked.str_id,
        tier: picked.tier || 1,
        attack: picked.attack || 1,
        health: picked.health || 1,
        tribes_cn: picked.minion_types_cn || [],
        mechanics: picked.mechanics || [],
        text_cn: picked.text_cn || "",
        position: i,
      });
    }
  },

  // 3. 高星中立页：全部5-6星中立随从
  _effectHighTierNeutral: function(player, sharedPool, rng, cardsById) {
    var candidates = [];
    var sortedCardIds = Object.keys(cardsById).sort(); for (var _i = 0; _i < sortedCardIds.length; _i++) { var cardId = sortedCardIds[_i];
      var c = cardsById[cardId];
      if (c.card_type !== "minion") continue;
      if (!c.tier || c.tier < 5) continue;
      var tribes = c.minion_types_cn || [];
      // 中立（无种族标签）或"全部"种族
      if (tribes.length === 0 || tribes[0] === "全部") {
        candidates.push(c);
      }
    }
    if (candidates.length === 0) return;
    var shopSize = player.tavernTier >= 5 ? 5 : 4;
    player.shop = [];
    for (var i = 0; i < shopSize; i++) {
      var picked = rng.pick(candidates);
      player.shop.push({
        cardId: picked.str_id,
        name_cn: picked.name_cn || picked.str_id,
        tier: picked.tier || 5,
        attack: picked.attack || 1,
        health: picked.health || 1,
        tribes_cn: picked.minion_types_cn || [],
        mechanics: picked.mechanics || [],
        text_cn: picked.text_cn || "",
        position: i,
      });
    }
  },

  // 4. 七星随从：获得一个随机7星随从加入手牌
  _effectTier7: function(player, rng, cardsById) {
    var tier7Pool = [];
    var sortedCardIds = Object.keys(cardsById).sort(); for (var _i = 0; _i < sortedCardIds.length; _i++) { var cardId = sortedCardIds[_i];
      var c = cardsById[cardId];
      if (c.card_type === "minion" && c.tier === 7) {
        tier7Pool.push(c);
      }
    }
    if (tier7Pool.length === 0) return;
    var picked = rng.pick(tier7Pool);
    var card = cardsById[picked.str_id];
    player.board.push({
      cardId: card.str_id,
      name_cn: card.name_cn || card.str_id,
      tier: 7,
      attack: card.attack || 10,
      health: card.health || 10,
      golden: false,
      tribes_cn: card.minion_types_cn || [],
      mechanics: card.mechanics || [],
      position: player.board.length,
    });
  },

  // 5. 法术页：全部是随机酒馆法术
  _effectSpellsPage: function(player, rng, cardsById) {
    var spellPool = [];
    var sortedCardIds = Object.keys(cardsById).sort(); for (var _i = 0; _i < sortedCardIds.length; _i++) { var cardId = sortedCardIds[_i];
      var c = cardsById[cardId];
      if (c.card_type === "tavern") spellPool.push(c);
    }
    if (spellPool.length === 0) return;
    var shopSize = player.tavernTier >= 5 ? 5 : 4;
    player.spellShop = [];
    for (var i = 0; i < shopSize; i++) {
      var picked = rng.pick(spellPool);
      player.spellShop.push({
        cardId: picked.str_id,
        name_cn: picked.name_cn || picked.str_id,
        text_cn: picked.text_cn || "",
        tier: picked.tier || 1,
        position: i,
      });
    }
  },

  // 6. 刷新点金：刷新商店并使一个随机随从变金色
  _effectRefreshGild: function(player, sharedPool, rng, cardsById) {
    // 正常刷新
    var shopIds = sharedPool.refreshShop(player.tavernTier, rng);
    player.shop = [];
    for (var i = 0; i < shopIds.length; i++) {
      var card = cardsById[shopIds[i]];
      if (card) {
        player.shop.push({
          cardId: card.str_id,
          name_cn: card.name_cn || card.str_id,
          tier: card.tier || 1,
          attack: card.attack || 1,
          health: card.health || 1,
          tribes_cn: card.minion_types_cn || [],
          mechanics: card.mechanics || [],
          text_cn: card.text_cn || "",
          position: i,
          golden: false,
        });
      }
    }
    // 随机将一个随从变为金色
    if (player.shop.length > 0) {
      var idx = rng.randInt(0, player.shop.length - 1);
      var gilded = player.shop[idx];
      gilded.golden = true;
      gilded.attack *= 2;
      gilded.health *= 2;
    }
  }
};
