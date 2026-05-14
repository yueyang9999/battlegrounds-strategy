"use strict";

// ═══════════════════════════════════════════════════════════
// SellModule — 卖牌/轮换建议
// ═══════════════════════════════════════════════════════════
//
// 触发卖牌建议的条件（至少满足2条，或满场+高价值商店卡1条即可）：
//   A. 棋盘已满(7)且商店有weight≥7的卡
//   B. 随从等级比酒馆等级低2级以上且身材低于同等级平均
//   C. 已确立主导种族(3+同族)，该随从无种族重叠
//   D. 等级差距≥3（酒馆等级 vs 随从等级）

var SellModule = class SellModule extends BaseModule {
  constructor(config) {
    super("SellModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    if (!ctx) return decisions;

    var boardMinions = ctx.boardMinions || [];
    if (boardMinions.length === 0) return decisions;

    var shopMinions = ctx.shopMinions || [];
    var dominantTribe = ctx.dominantTribe || null;
    var tavernTier = ctx.tavernTier || 1;
    var powerTable = (ctx.decisionTables && ctx.decisionTables.board_power_estimation &&
      ctx.decisionTables.board_power_estimation.minion_base_power) || {};

    // 检查商店是否有高价值卡（weight ≥ 7）
    var shopHasHighValue = false;
    for (var s = 0; s < shopMinions.length; s++) {
      var shopW = this._getWeight(shopMinions[s], ctx);
      if (shopW >= 7) { shopHasHighValue = true; break; }
    }

    for (var i = 0; i < boardMinions.length; i++) {
      var minion = boardMinions[i];
      var conditionsMet = 0;
      var reasons = [];

      // 保护：有战斗关键词的随从不卖（价值被 underestimate）
      var mechs = minion.mechanics || [];
      var hasCombatMech = false;
      for (var mi = 0; mi < mechs.length; mi++) {
        if (mechs[mi] === "DIVINE_SHIELD" || mechs[mi] === "REBORN" ||
            mechs[mi] === "WINDFURY" || mechs[mi] === "VENOMOUS" || mechs[mi] === "TAUNT") {
          hasCombatMech = true; break;
        }
      }
      if (hasCombatMech) continue; // 保留有价值机制的随从

      // 提前判断：是否有主导种族、本随从是否匹配
      var hasDominantTribe = false;
      var minionHasTribe = false;
      var dominantTribeCount = 0;
      if (dominantTribe) {
        hasDominantTribe = true;
        var tribes = minion.tribes_cn || [];
        for (var t2 = 0; t2 < tribes.length; t2++) {
          if (tribes[t2] === dominantTribe) { minionHasTribe = true; break; }
        }
        for (var bm2 = 0; bm2 < boardMinions.length; bm2++) {
          if ((boardMinions[bm2].tribes_cn || []).indexOf(dominantTribe) !== -1) {
            dominantTribeCount++;
          }
        }
      }

      // 条件A：棋盘满 + 商店有高价值卡
      if (boardMinions.length >= 7 && shopHasHighValue) {
        conditionsMet++;
        reasons.push("满场需腾位");
      }

      // 条件B：低等级+低身材
      var tierGap = tavernTier - (minion.tier || 1);
      var avgPower = powerTable[minion.tier] || (0.2 * (minion.tier || 1));
      var minionPower = ((minion.attack || 1) * 0.5 + (minion.health || 1) * 0.5) / 10;
      if (tierGap >= 2 && minionPower < avgPower) {
        conditionsMet++;
        reasons.push("等级落后(差" + tierGap + "级)且身材不足");
      }

      // 条件C：主导种族不匹配
      if (hasDominantTribe && !minionHasTribe && boardMinions.length >= 4) {
        conditionsMet++;
        reasons.push("无" + dominantTribe + "种族协同");
      }

      // 条件D：等级差距>=3
      if (tierGap >= 3) {
        conditionsMet++;
        reasons.push("等级差" + tierGap + "级，严重落后");
      }

      // 至少满足2个条件, 或 (条件A单独+高价值商店卡), 或 (已确立主导种族+无协同且3+同族)
      var shouldSell = conditionsMet >= 2 ||
        (conditionsMet >= 1 && boardMinions.length >= 7 && shopHasHighValue && tierGap >= 1) ||
        (conditionsMet >= 1 && hasDominantTribe && !minionHasTribe && dominantTribeCount >= 3);

      if (shouldSell) {
        var sellPrice = (typeof RulesEngine !== "undefined" && RulesEngine.getSellPrice)
          ? RulesEngine.getSellPrice(minion.cardId, ctx)
          : 1;

        var confidence = Math.min(0.85, 0.4 + conditionsMet * 0.15);
        var label = "建议卖掉 " + (minion.name_cn || minion.cardId) + "（" + reasons.join("，") + "）";
        var message = "卖 " + (minion.name_cn || minion.cardId);

        decisions.push(this._decide(
          "sell_minion",
          DecisionPriority.SELL_MINION,
          "sell_minion_" + i,
          message,
          label + " 获得" + sellPrice + "铸币。",
          confidence,
          { cardId: minion.cardId, position: i, boardIndex: i, sellPrice: sellPrice, reasons: reasons }
        ));
      }
    }

    return decisions;
  }

  _getWeight(minion, ctx) {
    var weights = (ctx.decisionTables && ctx.decisionTables.card_weights) || {};
    var dominantTribe = ctx.dominantTribe;
    var cid = minion.cardId;
    var tribeWeights = dominantTribe ? weights[dominantTribe] : null;
    var neutralW = weights.neutral || {};
    var bestW = (tribeWeights && tribeWeights[cid]) ? tribeWeights[cid] : neutralW[cid];
    return bestW ? (bestW.weight || 0) : 0;
  }
};
