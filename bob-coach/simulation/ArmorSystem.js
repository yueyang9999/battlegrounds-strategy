"use strict";

// ═══════════════════════════════════════════════════════════
// ArmorSystem — 护甲管理
// ═══════════════════════════════════════════════════════════
//
// 护甲规则：
// - 英雄初始护甲值来自 cards.json hero.armor 字段
// - 扣血操作优先扣护甲，护甲归零再扣生命值
// - 存活判定只看 health > 0（护甲不算存活）
// - 护甲法术 BG28_500：将护甲设为5
// - 护甲法术 BG34_Treasure_934：获得10点护甲

var ArmorSystem = {

  initPlayer: function(player, heroCardId, cardsById) {
    var heroCard = cardsById[heroCardId];
    if (heroCard && heroCard.card_type === "hero") {
      player.maxHealth = heroCard.health || 30;
      player.health = player.maxHealth;
      player.armor = heroCard.armor || 0;
    } else {
      player.maxHealth = 30;
      player.health = 30;
      player.armor = 0;
    }
  },

  // 扣除生命值/护甲（护甲优先）
  // 返回 { armorLost, healthLost }
  deductCost: function(player, amount) {
    if (amount <= 0) return { armorLost: 0, healthLost: 0 };
    if (player.armor >= amount) {
      player.armor -= amount;
      return { armorLost: amount, healthLost: 0 };
    }
    var remaining = amount - player.armor;
    var armorLost = player.armor;
    player.armor = 0;
    var healthLost = Math.min(remaining, player.health);
    player.health -= healthLost;
    return { armorLost: armorLost, healthLost: healthLost };
  },

  // 战斗伤害（先走DamageSystem的上限，再扣护甲）
  applyDamage: function(player, damage) {
    if (damage <= 0) return { armorLost: 0, healthLost: 0 };
    var armorAbsorbed = Math.min(player.armor, damage);
    player.armor -= armorAbsorbed;
    var healthLost = damage - armorAbsorbed;
    player.health -= healthLost;
    return { armorLost: armorAbsorbed, healthLost: healthLost };
  },

  // BG28_500 "护甲储备"：将护甲设为5
  applySetArmor: function(player, value) {
    value = value || 5;
    player.armor = value;
  },

  // BG34_Treasure_934 "时空扭曲护甲储备"：获得10点护甲
  applyAddArmor: function(player, amount) {
    amount = amount || 10;
    player.armor += amount;
  },

  // 存活判定：只看生命值
  isAlive: function(player) {
    return player.health > 0;
  },

  // HP-cost 卡牌费用扣除
  payHpCost: function(player, cardId, rulesEngine) {
    var cost = 3; // 默认消耗3点生命值
    if (rulesEngine && rulesEngine.getHpCostAmount) {
      cost = rulesEngine.getHpCostAmount(cardId);
    }
    return this.deductCost(player, cost);
  }
};
