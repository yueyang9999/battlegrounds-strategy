"use strict";

// ═══════════════════════════════════════════════════════════
// RefreshModule — 智能刷新建议
// ═══════════════════════════════════════════════════════════
//
// 比 MinionPickModule._checkRefresh 更精细的刷新决策：
//   1. 评估当前酒馆价值（店值）
//   2. 计算有效刷新费用（免费/HP消耗）
//   3. 结合流派匹配度、血量压力、铸币预算

var RefreshModule = class RefreshModule extends BaseModule {
  constructor(config) {
    super("RefreshModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    if (ctx.gamePhase !== "shop") return decisions;
    if (ctx.gold <= 0) return decisions;

    var refreshRules = this.config.refresh_rules || {};
    var shopValue = RulesEngine.estimateShopValue(ctx);
    var effectiveCost = RulesEngine.getEffectiveRefreshCost(ctx);
    var hpRefreshes = RulesEngine.countHpRefreshes(ctx);
    var freeRefreshes = RulesEngine.countFreeRefreshes(ctx);

    // 1. 店值高 → 不建议刷新
    var minSkip = refreshRules.min_shop_value_to_skip || 2;
    if (shopValue.totalScore >= 8 && shopValue.hasCoreCard) {
      return decisions; // 店里有核心卡，先买再说
    }

    // 2. 流派匹配度
    var compMatch = ctx.currentComp ? ctx.currentComp.matchPercent : 0;
    var missingCards = (ctx.currentComp && ctx.currentComp.missingCards) || [];

    // 流派已成型（>=85%）且店里有价值卡 → 跳过
    if (compMatch >= (refreshRules.comp_threshold_high || 85) && shopValue.totalScore >= minSkip) {
      return decisions;
    }

    // 3. 预算检查：刷新后是否还有铸币买牌
    var buyCost = RulesEngine.getBuyCost(ctx);
    var budgetReserve = refreshRules.budget_reserve_after_refresh || 3;
    var goldAfterRefresh = ctx.gold - effectiveCost;
    var canAffordAfter = goldAfterRefresh >= buyCost;
    var isHpRefresh = (hpRefreshes > 0 && effectiveCost === 0);

    // 预算不足且非HP刷新 → 除非店空+急需，否则不刷
    if (!canAffordAfter && !isHpRefresh && shopValue.totalScore > minSkip) {
      return decisions;
    }

    // 4. 构建建议
    var confidence = 0.50;
    var reasonParts = [];
    var label = "搜牌";

    // 店值越低，越该刷新
    if (shopValue.totalScore <= 2) {
      confidence += 0.20;
      reasonParts.push("酒馆价值低");
    } else if (shopValue.totalScore <= 5) {
      confidence += 0.10;
      reasonParts.push("酒馆价值一般");
    }

    // 免费刷新 → 高置信
    if (freeRefreshes > 0 || effectiveCost === 0) {
      confidence += 0.15;
      reasonParts.push("免费刷新可用");
      label = "免费搜";
    }

    // HP刷新
    if (isHpRefresh) {
      confidence += 0.05;
      reasonParts.push("HP刷新（玛克扎尔）");
      label = "HP搜";
    }

    // 流派匹配度低 → 需要搜核心
    if (compMatch < (refreshRules.comp_threshold_low || 50)) {
      confidence += 0.10;
      reasonParts.push("流派未成型(" + compMatch + "%)");
    }

    // 缺卡
    if (missingCards.length > 0) {
      confidence += 0.08;
      var missingNames = missingCards.slice(0, 2).map(function(id) {
        return (ctx._cardsById && ctx._cardsById[id]) ? ctx._cardsById[id].name_cn : id;
      });
      reasonParts.push("缺:" + missingNames.join(","));
    }

    // 血量压力
    if (ctx.health < (refreshRules.health_pressure || 10)) {
      confidence += 0.10;
      reasonParts.push("血量危险(" + ctx.health + ")");
    }

    // 预算紧张
    if (!canAffordAfter && !isHpRefresh) {
      confidence -= 0.10;
      reasonParts.push("刷新后预算紧张");
    }

    confidence = Math.max(0.25, Math.min(0.85, confidence));

    decisions.push(this._decide(
      "refresh_smart",
      DecisionPriority.REFRESH_SMART,
      "refresh_shop_smart",
      label,
      reasonParts.join("; ") || "当前酒馆无可用卡牌",
      confidence,
      {
        cost: effectiveCost,
        shopValue: shopValue.totalScore,
        freeRefreshes: freeRefreshes,
        hpRefreshes: hpRefreshes,
        missingCards: missingCards.slice(0, 3),
      }
    ));

    return decisions;
  }
};
