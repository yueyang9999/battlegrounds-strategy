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

    // 检查商店是否有高价值卡（weight ≥ 6, 或 T5+）
    var shopHasHighValue = false;
    for (var s = 0; s < shopMinions.length; s++) {
      var shopW = this._getWeight(shopMinions[s], ctx);
      if (shopW >= 6 || shopMinions[s].tier >= 5) { shopHasHighValue = true; break; }
    }

    for (var i = 0; i < boardMinions.length; i++) {
      var minion = boardMinions[i];
      var conditionsMet = 0;
      var reasons = [];

      // 金色随从不建议出售
      if (minion.golden) continue;

      // 战斗关键词保护：圣盾/复生/风怒是核心战力，除非满场+高价值商店卡
      var mechs = minion.mechanics || [];
      var hasCoreCombatMech = false;
      var hasSecondaryCombatMech = false;
      for (var mi = 0; mi < mechs.length; mi++) {
        if (mechs[mi] === "DIVINE_SHIELD" || mechs[mi] === "REBORN" ||
            mechs[mi] === "WINDFURY") {
          hasCoreCombatMech = true;
        }
        if (mechs[mi] === "VENOMOUS" || mechs[mi] === "TAUNT") {
          hasSecondaryCombatMech = true;
        }
      }
      // 有核心战力关键词：只在满场+高价值商店时考虑出售
      var fullBoardPressure = boardMinions.length >= 7 && shopHasHighValue;
      if (hasCoreCombatMech && !fullBoardPressure) continue;

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

      // 二级战力关键词惩罚：降低1个条件
      if (hasSecondaryCombatMech) conditionsMet--;

      // 满场+高价值商店卡：降低门槛（满场压力下1条件即可触发）
      if (fullBoardPressure) conditionsMet = Math.max(conditionsMet, 1);

      // 至少满足2个条件, 或 (满场+高价值商店卡且等级至少差1), 或 (主导种族+无协同且3+同族)
      var shouldSell = conditionsMet >= 2 ||
        (fullBoardPressure && tierGap >= 1) ||
        (conditionsMet >= 1 && hasDominantTribe && !minionHasTribe && dominantTribeCount >= 3);

      if (shouldSell) {
        var sellPrice = (typeof RulesEngine !== "undefined" && RulesEngine.getSellPrice)
          ? RulesEngine.getSellPrice(minion.cardId, ctx)
          : 1;

        var confidence = Math.min(0.85, 0.4 + conditionsMet * 0.15);
        // 经济型随从卖出是倒转常规操作，提高置信度使其优先通过
        if (this._isEconomyMinion(minion)) {
          confidence = Math.min(0.85, confidence + 0.12);
          reasons.push("经济牌轮换");
        }
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

    // 动态卖牌上限：根据场面战力、回合、经济型随从数量自适应调整
    if (decisions.length <= 1) return decisions;
    decisions.sort(function(a, b) {
      return (b.priority * b.confidence) - (a.priority * a.confidence);
    });
    var maxSells = this._calcDynamicSellLimit(ctx, shopHasHighValue);
    return decisions.slice(0, maxSells);
  }

  /**
   * 动态卖牌上限（分数制，需多条件叠加才升档）。
   *
   * 各条件贡献分数：
   *  - 场面碾压 (boardPower >= 2.0)：+0.6
   *  - 后期搜核 (turn >= 9, gold >= 9)：+0.4
   *  - 满场压力 (board >= 7 + 商店高价值卡)：+0.5
   *  - 倒转阵容 (经济型随从 >= 3)：+0.5
   *
   * floor(总分) = 最终上限，范围 1-2。
   * 单条件不足以升档，需多条件叠加（如强场面+后期，或满场+经济）。
   */
  _calcDynamicSellLimit(ctx, shopHasHighValue) {
    var boardLen = (ctx.boardMinions || []).length;
    var boardPower = ctx.boardPower || 0;
    var turn = ctx.turn || 1;
    var gold = ctx.gold || 0;

    var score = 1.0;

    if (boardPower >= 2.0) score += 0.6;
    if (turn >= 9 && gold >= 9) score += 0.4;
    if (boardLen >= 7 && shopHasHighValue) score += 0.5;

    var econCount = this._countEconomyMinions(ctx);
    if (econCount >= 3) score += 0.5;

    // 额外：场面极强(boardPower>=2.5)+后期 再+0.3 确保极端优势下可升档
    if (boardPower >= 2.5 && turn >= 9) score += 0.3;

    return Math.min(2, Math.floor(score));
  }

  /**
   * 判断单张随从是否为经济型（可安全轮换）。
   * 判定：文本含铸币/出售获利/免费刷新关键词，或低费战吼引擎。
   */
  _isEconomyMinion(minion) {
    var text = (minion.text_cn || "").toLowerCase();
    var mechs = minion.mechanics || [];
    var hasBattlecry = false;
    for (var i = 0; i < mechs.length; i++) {
      if (mechs[i] === "BATTLECRY") { hasBattlecry = true; break; }
    }
    if (/铸币|金币|获得.*枚|gain.*coin/i.test(text)) return true;
    if (/出售.*铸币|出售.*获得|sell.*coin|sell.*gain/i.test(text)) return true;
    if (/刷新|refresh/i.test(text) && /免费|free|减.*费|cost.*less/i.test(text)) return true;
    if ((minion.tier || 3) <= 2 && hasBattlecry && /铸币|金币|gain.*coin|出售|sell/i.test(text)) return true;
    return false;
  }

  /**
   * 统计场面上的经济型随从数量。
   */
  _countEconomyMinions(ctx) {
    var board = ctx.boardMinions || [];
    var count = 0;
    for (var i = 0; i < board.length; i++) {
      if (this._isEconomyMinion(board[i])) count++;
    }
    return count;
  }

  _getWeight(minion, ctx) {
    var weights = (ctx.decisionTables && ctx.decisionTables.card_weights) || {};
    var dominantTribe = ctx.dominantTribe;
    var cid = minion.cardId;
    var tribeWeights = dominantTribe ? weights[dominantTribe] : null;
    var neutralW = weights.neutral || {};
    var bestW = (tribeWeights && tribeWeights[cid]) ? tribeWeights[cid] : neutralW[cid];
    var w = bestW ? (bestW.weight || 0) : 0;
    // 兜底：T5+或高身材的未知卡牌也应视为高价值
    if (w === 0 && minion.tier >= 5) w = 6;
    else if (w === 0 && minion.tier >= 4 && ((minion.attack || 0) + (minion.health || 0)) >= 16) w = 6;
    return w;
  }
};
