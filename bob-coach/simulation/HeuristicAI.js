"use strict";

// ═══════════════════════════════════════════════════════════
// HeuristicAI — 非Bob教练玩家的轻量级AI决策器
// ═══════════════════════════════════════════════════════════
//
// 优先级链：
//   1. 危险保命 — 低血量优先找战力/护甲
//   2. 标准曲线升本
//   3. 买最高价值随从
//   4. 护甲法术（低血高回合）
//   5. 英雄技能（有余钱）
//   6. 刷新（剩余金币）

var HeuristicAI = {

  PERSONALITIES: ["deathrattle", "divine_shield", "big_stats", "balanced"],

  assignPersonality: function(rng) {
    rng = rng || { random: Math.random };
    var list = this.PERSONALITIES;
    return list[Math.floor(rng.random() * list.length)];
  },

  decide: function(player, ctx, rng) {
    var decisions = [];
    var gold = player.gold;
    var boardFull = player.board.length >= 7;

    // ── 1. 危险检查 ──
    var danger = this._checkDanger(player, ctx);
    if (danger) decisions.push(danger);

    // ── 2. 升本决策 ──
    var levelDec = this._checkLevelUp(player, ctx);
    if (levelDec) decisions.push(levelDec);

    // ── 3. 买随从决策 ──
    if (!boardFull && gold >= 3) {
      var minionDecs = this._evaluateMinions(player, ctx, rng);
      for (var i = 0; i < minionDecs.length; i++) {
        decisions.push(minionDecs[i]);
      }
    }

    // ── 4. 卖牌决策 ──
    if (boardFull && gold < 3 && player.shop.length > 0) {
      var sellDec = this._checkSellWeakest(player, ctx);
      if (sellDec) decisions.push(sellDec);
    }

    // ── 5. 护甲法术 ──
    var hp = player.health + player.armor;
    var turn = ctx.turn || 5;
    if (turn >= 6 && hp <= 20) {
      var armorSpell = this._checkArmorSpell(player, ctx);
      if (armorSpell) decisions.push(armorSpell);
    }

    // ── 6. HP-cost 卡评估 ──
    var hpCostDecs = this._evaluateHpCostCards(player, ctx);
    for (var i = 0; i < hpCostDecs.length; i++) {
      decisions.push(hpCostDecs[i]);
    }

    // ── 7. 英雄技能 ──
    if (!player.heroPowerUsed && gold >= player.heroPowerCost && gold - player.heroPowerCost >= 2) {
      decisions.push({
        type: "hero_power",
        priority: 50,
        action: "hero_power",
        message: "使用英雄技能",
        reason: "有余钱",
        confidence: 0.6,
        data: { cost: player.heroPowerCost },
        source: "HeuristicAI",
      });
    }

    // ── 8. 刷新 ──
    if (gold >= 1 && decisions.length <= 1) {
      decisions.push({
        type: "refresh",
        priority: 30,
        action: "refresh",
        message: "刷新酒馆",
        reason: "当前商店不佳",
        confidence: 0.4,
        data: { cost: 1 },
        source: "HeuristicAI",
      });
    }

    return decisions;
  },

  _checkDanger: function(player, ctx) {
    var hpThreshold = 10;
    var dt = ctx.decisionTables || {};
    if (dt.board_power_estimation && dt.board_power_estimation.health_threshold_danger) {
      hpThreshold = dt.board_power_estimation.health_threshold_danger;
    }
    if (player.health <= hpThreshold) {
      return {
        type: "danger",
        priority: 100,
        action: "emergency_defense",
        message: "危险！急需战力",
        reason: "血量仅剩" + player.health,
        confidence: 0.95,
        data: {},
        source: "HeuristicAI",
      };
    }
    return null;
  },

  _checkLevelUp: function(player, ctx) {
    if (player.tavernTier >= 6) return null;
    if (player.gold < player.levelUpCost) return null;

    var dt = ctx.decisionTables || {};
    var lc = dt.leveling_curve || {};
    var curve = lc[player.curveType] || lc.standard || {};
    var entry = curve[String(ctx.turn || 5)];
    if (!entry || !entry.cost) return null;

    // 自适应阈值（简化版）
    var threshold = 0.3;
    if (ctx.turn <= 3) threshold += 0.1;
    if (player.health > 25) threshold -= 0.05;
    if (player.health < 10) threshold += 0.15;

    // 估算场面战力
    var boardPower = 0;
    for (var i = 0; i < player.board.length; i++) {
      var m = player.board[i];
      boardPower += (m.tier || 1) * 0.2 + (m.attack || 1) * 0.05 + (m.health || 1) * 0.05;
    }

    if (boardPower >= threshold && player.gold >= entry.cost) {
      return {
        type: "level_up",
        priority: 65,
        action: "level_up",
        message: "建议升本→" + (player.tavernTier + 1),
        reason: "战力足够，经济允许",
        confidence: 0.75,
        data: { cost: entry.cost, targetTier: player.tavernTier + 1 },
        source: "HeuristicAI",
      };
    }
    return null;
  },

  _evaluateMinions: function(player, ctx, rng) {
    var decisions = [];
    var dominantTribe = player.getDominantTribe();
    var personality = player.aiPersonality || "balanced";

    for (var i = 0; i < player.shop.length; i++) {
      var m = player.shop[i];
      var score = (m.tier || 1) * 2 + (m.attack || 1) * 0.3 + (m.health || 1) * 0.3;

      // 种族协同加成
      if (dominantTribe) {
        var tribes = m.tribes_cn || [];
        if (tribes.indexOf(dominantTribe) !== -1) score *= 1.5;
      }

      // 战斗关键词加成
      var mechs = m.mechanics || [];
      if (mechs.indexOf("DIVINE_SHIELD") !== -1) score *= 1.3;
      if (mechs.indexOf("REBORN") !== -1) score *= 1.2;
      if (mechs.indexOf("VENOMOUS") !== -1) score *= 1.25;

      // 流派倾向加权
      switch (personality) {
        case "deathrattle":
          if (mechs.indexOf("DEATHRATTLE") !== -1) score *= 1.3;
          if (mechs.indexOf("REBORN") !== -1) score *= 1.15;
          break;
        case "divine_shield":
          if (mechs.indexOf("DIVINE_SHIELD") !== -1) score *= 1.35;
          break;
        case "big_stats":
          score *= 1.0 + (m.tier || 1) * 0.06;
          break;
        case "balanced":
        default:
          break;
      }

      // 对子加成
      if (player.pairMemory[m.cardId] && player.pairMemory[m.cardId].count >= 2) {
        score *= 1.8;
      }

      decisions.push({
        type: "minion_pick",
        priority: 55,
        action: "buy_minion",
        message: "买 " + (m.name_cn || m.cardId),
        reason: "评分" + score.toFixed(1),
        confidence: Math.min(0.85, 0.4 + score * 0.05),
        data: { cardId: m.cardId, position: i, shopIndex: i, cost: 3, canTriple: false },
        source: "HeuristicAI",
        _score: score,
      });
    }

    // 按评分降序
    decisions.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
    return decisions.slice(0, 2); // 最多推荐2个
  },

  _checkSellWeakest: function(player, ctx) {
    if (player.board.length < 7) return null;
    var worstIdx = 0;
    var worstScore = Infinity;
    for (var i = 0; i < player.board.length; i++) {
      var m = player.board[i];
      var mechs = m.mechanics || [];
      // 保护战斗关键词随从
      if (mechs.indexOf("DIVINE_SHIELD") !== -1 || mechs.indexOf("REBORN") !== -1 ||
          mechs.indexOf("WINDFURY") !== -1 || mechs.indexOf("VENOMOUS") !== -1 ||
          mechs.indexOf("TAUNT") !== -1) continue;
      var sc = (m.tier || 1) * 2 + (m.attack || 1) * 0.3 + (m.health || 1) * 0.3;
      if (sc < worstScore) { worstScore = sc; worstIdx = i; }
    }
    if (worstScore === Infinity) return null;
    return {
      type: "sell_minion",
      priority: 50,
      action: "sell_minion",
      message: "卖 " + (player.board[worstIdx].name_cn || player.board[worstIdx].cardId),
      reason: "腾位给更优质随从",
      confidence: 0.6,
      data: { boardIndex: worstIdx, sellPrice: player.board[worstIdx].golden ? 3 : 1 },
      source: "HeuristicAI",
    };
  },

  _checkArmorSpell: function(player, ctx) {
    // 检查商店中是否有护甲法术
    for (var i = 0; i < player.spellShop.length; i++) {
      var s = player.spellShop[i];
      if (s.cardId === "BG28_500" || s.cardId === "BG34_Treasure_934") {
        var hp = player.health + player.armor;
        var needArmor = (ctx.turn >= 8 && hp <= 15) || (ctx.turn >= 6 && hp <= 10);
        if (needArmor && player.gold >= 1) {
          return {
            type: "spell_buy",
            priority: 72,
            action: "buy_spell",
            message: "买护甲法术",
            reason: "血量" + hp + "，需要护甲保命",
            confidence: 0.8,
            data: { cardId: s.cardId, cost: 1, category: "armor" },
            source: "HeuristicAI",
          };
        }
      }
    }
    return null;
  },

  _evaluateHpCostCards: function(player, ctx) {
    var decisions = [];
    var hp = player.health + player.armor;
    for (var i = 0; i < player.shop.length; i++) {
      var m = player.shop[i];
      if (m.cardId === "BG25_520" || m.cardId === "BG28_571") {
        // HP-cost 卡：只在安全时才推荐
        if (hp > 15) {
          decisions.push({
            type: "minion_pick",
            priority: 52,
            action: "buy_hp_cost",
            message: "用血量买 " + (m.name_cn || m.cardId),
            reason: "血量充足(HP" + hp + ")，可用血量购买",
            confidence: 0.65,
            data: { cardId: m.cardId, position: i, cost: 0, hpCost: 3 },
            source: "HeuristicAI",
          });
        }
      }
    }
    return decisions;
  }
};
