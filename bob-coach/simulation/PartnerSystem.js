"use strict";

// ═══════════════════════════════════════════════════════════
// PartnerSystem — 伙伴系统
// ═══════════════════════════════════════════════════════════
//
// 伙伴规则：
// - 每个英雄可能有 buddy_id（在 cards.json hero.buddy_id 字段）
// - 牛头人(BG25_HERO_105)英雄技能"签约新人"：发现一个伙伴
// - 芬利/阮大师/吉恩/大帝等英雄可能获得牛头人技能
// - 特殊伙伴效果：星探(变金)、威武战驹(出售得伙伴)、雷火掌(回合开始得伙伴)
// - 克罗米伙伴：每回合一次有用刷新
// - 2星龙族伙伴：可将随从进化到高一星级（最高7星）

var PartnerSystem = {

  // 可获取牛头人技能（或类似伙伴相关技能）的英雄
  BUDDY_HERO_SKILLS: {
    "TB_BaconShop_HERO_40": "discover_hp",    // 芬利 → 发现英雄技能
    "BG20_HERO_202":     "rotate_hp",         // 阮大师 → 每回合换技能
    "BG35_HERO_001":     "choose_hp",         // 吉恩 → 第4回合选2个技能
    "BG24_HERO_100":     "quest_hp",          // 德纳修斯大帝 → 任务奖励可能含伙伴
  },

  // 特殊伙伴效果
  SPECIAL_BUDDIES: {
    "BG25_HERO_105_Buddy": { // 星探 — 战吼：使一个伙伴变金色
      effect: "gild_partner",
      description: "战吼：使一个伙伴变为金色",
    },
    "TB_BaconShop_HERO_40_Buddy": { // 威武战驹麦克斯韦
      effect: "sell_get_buddy",
      description: "出售时获取英雄技能对应的伙伴",
    },
    "BG20_HERO_202_Buddy": { // 雷·火掌
      effect: "start_turn_get_buddy",
      description: "回合开始时获取英雄技能对应的伙伴",
    },
    "TB_BaconShop_HERO_57_Buddy": { // 克罗米
      effect: "useful_refresh",
      description: "每回合一次有用刷新",
    },
    "BG21_HERO_010_Buddy": { // 典狱官塞尔沃特
      effect: "next_opponent_buddy",
      description: "回合开始时获取下一个对手的伙伴",
    },
  },

  // 2星龙族伙伴进化链（随从ID到高一星级的映射参考）
  EVOLUTION_BUDDY_ID: "BG25_HERO_105_Buddy", // 星探 — 可进化任意伙伴
  DRAGON_BUDDY_ID: null, // 占位 — 实际2星龙族伙伴ID待确认

  // 获取英雄的伙伴ID
  getBuddyForHero: function(heroCardId, cardsById) {
    var heroCard = cardsById[heroCardId];
    if (!heroCard || heroCard.card_type !== "hero") return null;
    return heroCard.buddy_id || null;
  },

  // 获取可用的伙伴列表（从cards.json中筛选所有buddy minions）
  getAvailableBuddies: function(cardsById) {
    var buddies = [];
    var sortedBuddyIds = Object.keys(cardsById).sort();
    for (var _bi = 0; _bi < sortedBuddyIds.length; _bi++) {
      var cardId = sortedBuddyIds[_bi];
      var c = cardsById[cardId];
      if (c.card_type === "minion" && cardId.indexOf("_Buddy") !== -1) {
        buddies.push(c);
      }
    }
    return buddies;
  },

  // 发现伙伴（牛头人英雄技能效果）
  discoverBuddies: function(player, count, rng, cardsById) {
    var allBuddies = this.getAvailableBuddies(cardsById);
    if (allBuddies.length === 0) return [];

    rng.shuffle(allBuddies);
    var options = allBuddies.slice(0, Math.min(count || 3, allBuddies.length));

    var result = [];
    for (var i = 0; i < options.length; i++) {
      var buddy = options[i];
      result.push({
        cardId: buddy.str_id,
        name_cn: buddy.name_cn || buddy.str_id,
        tier: buddy.tier || 4,
        attack: buddy.attack || 1,
        health: buddy.health || 1,
        tribes_cn: buddy.minion_types_cn || [],
        mechanics: buddy.mechanics || [],
        text_cn: buddy.text_cn || "",
        isBuddy: true,
      });
    }
    return result;
  },

  // 检查英雄是否有伙伴
  hasBuddy: function(heroCardId, cardsById) {
    var buddyId = this.getBuddyForHero(heroCardId, cardsById);
    return !!buddyId;
  },

  // 检查英雄是否可以获取牛头人技能
  canGetBuddySkill: function(heroCardId) {
    return !!this.BUDDY_HERO_SKILLS[heroCardId];
  },

  // 应用伙伴入场效果
  applyBuddyEffect: function(player, buddy, cardsById, sharedPool, rng) {
    var buddyData = this.SPECIAL_BUDDIES[buddy.cardId];
    if (!buddyData) return;

    switch (buddyData.effect) {
      case "gild_partner":
        // 使场上一个伙伴变金色
        this._gildRandomBuddy(player, cardsById);
        break;
      case "useful_refresh":
        // 触发一次有用刷新
        if (typeof WisdomBall !== "undefined") {
          WisdomBall.resolveUsefulRefresh(player, sharedPool, rng, cardsById);
        }
        break;
      case "start_turn_get_buddy":
        // 回合开始时获取伙伴 — 在SimulationEngine中处理
        break;
      case "sell_get_buddy":
        // 出售时获取伙伴 — 在出售逻辑中处理
        break;
    }
  },

  // 进化随从（龙族伙伴特有：升1星，最高7星）
  evolveMinion: function(player, boardIndex, cardsById) {
    if (boardIndex < 0 || boardIndex >= player.board.length) return null;
    var minion = player.board[boardIndex];
    if (minion.tier >= 7) return null;

    var newTier = Math.min(7, (minion.tier || 1) + 1);
    // 简单进化：提升tier + 增加身材
    player.board[boardIndex].tier = newTier;
    player.board[boardIndex].attack = Math.floor((minion.attack || 1) * 1.5);
    player.board[boardIndex].health = Math.floor((minion.health || 1) * 1.5);
    return player.board[boardIndex];
  },

  _gildRandomBuddy: function(player, cardsById) {
    var buddiesOnBoard = [];
    for (var i = 0; i < player.board.length; i++) {
      var m = player.board[i];
      if (m.cardId && m.cardId.indexOf("_Buddy") !== -1 && !m.golden) {
        buddiesOnBoard.push(i);
      }
    }
    if (buddiesOnBoard.length === 0) return;
    var idx = Math.floor((rng ? rng.random() : Math.random)() * buddiesOnBoard.length);
    var gilded = player.board[idx];
    gilded.golden = true;
    gilded.attack *= 2;
    gilded.health *= 2;
  }
};
