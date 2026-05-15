"use strict";

// ═══════════════════════════════════════════════════════════
// RandomAI — 随机合法操作基准AI（对标测试方案中的RandomAI）
// ═══════════════════════════════════════════════════════════
//
// 用于压力测试中的对照基线。在合法操作中随机选择。
// 优先链：升本（随机概率）→ 买随从（随机选）→ 英雄技能 → 刷新

var RandomAI = {

  decide: function(player, ctx, rng) {
    var decisions = [];
    rng = rng || { random: Math.random };
    var rand = rng.random();
    var gold = player.gold;
    var boardFull = player.board.length >= 7;

    // 1. 升本（30% 概率，如果负担得起）
    if (!player.heroPowerUsed && rand < 0.3 && gold >= player.levelUpCost && player.tavernTier < 6) {
      decisions.push({
        type: "level_up",
        priority: 50,
        action: "level_up",
        message: "升本",
        reason: "随机决定",
        confidence: 0.4 + rng.random() * 0.2,
        data: { cost: player.levelUpCost, targetTier: player.tavernTier + 1 },
        source: "RandomAI",
      });
    }

    // 2. 买随从（如果未满场且有金币）
    if (!boardFull && gold >= 3 && player.shop.length > 0) {
      var idx = Math.floor(rng.random() * player.shop.length);
      var m = player.shop[idx];
      decisions.push({
        type: "minion_pick",
        priority: 45,
        action: "buy_minion",
        message: "买 " + (m.name_cn || m.cardId),
        reason: "随机选牌",
        confidence: 0.3 + rng.random() * 0.3,
        data: { cardId: m.cardId, position: idx, shopIndex: idx, cost: 3 },
        source: "RandomAI",
      });
    }

    // 3. 英雄技能（50% 概率）
    if (!player.heroPowerUsed && gold >= player.heroPowerCost && rng.random() < 0.5) {
      decisions.push({
        type: "hero_power",
        priority: 40,
        action: "hero_power",
        message: "使用英雄技能",
        reason: "随机使用",
        confidence: 0.4 + rng.random() * 0.3,
        data: { cost: player.heroPowerCost },
        source: "RandomAI",
      });
    }

    // 4. 刷新（60% 概率，有余钱时）
    if (gold >= 1 && rng.random() < 0.6) {
      decisions.push({
        type: "refresh",
        priority: 30,
        action: "refresh",
        message: "刷新酒馆",
        reason: "随机刷新",
        confidence: 0.3 + rng.random() * 0.3,
        data: { cost: 1 },
        source: "RandomAI",
      });
    }

    // 兜底：至少做一个动作
    if (decisions.length === 0 && gold >= 1) {
      decisions.push({
        type: "refresh",
        priority: 20,
        action: "refresh",
        message: "刷新酒馆",
        reason: "没别的事做",
        confidence: 0.2,
        data: { cost: 1 },
        source: "RandomAI",
      });
    }

    return decisions;
  }
};
