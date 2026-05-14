"use strict";

// ═══════════════════════════════════════════════════════════
// FreezeModule — 冻结/解冻建议
// ═══════════════════════════════════════════════════════════
//
// 冻结判定：
//   1. 店值高（核心卡/三连潜力/点金法术）且玩家铸币不足 → 冻结
//   2. 点金之触连招：店有点金法术 + 核心随从 → 高置信冻结
//   3. 血量安全 + 连续冻结 <= 2 回合
//
// 解冻判定：
//   已冻结 + 店值低 → 建议解冻

var FreezeModule = class FreezeModule extends BaseModule {
  constructor(config) {
    super("FreezeModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    if (ctx.gamePhase !== "shop") return decisions;

    var freezeRules = this.config.freeze_rules || {};
    var shopValue = RulesEngine.estimateShopValue(ctx);
    var totalScore = shopValue.totalScore || 0;

    // ── 解冻检查（优先） ──
    var isFrozen = ctx.frozenShop === true;
    if (isFrozen) {
      var unfreezeThreshold = freezeRules.unfreeze_value_threshold || 4;
      if (totalScore < unfreezeThreshold) {
        decisions.push(this._decide(
          "unfreeze",
          DecisionPriority.INFO,
          "unfreeze_shop",
          "建议取消冻结",
          "酒馆价值低(" + totalScore + ")，解除冻结可供下回合正常刷新",
          0.65,
          { shopValue: totalScore }
        ));
        return decisions;
      }
      // 已冻结但店值仍高 → 保持冻结，不重复建议
      return decisions;
    }

    // ── 冻结检查 ──
    var minValue = freezeRules.min_shop_value_to_freeze || 8;
    if (totalScore < minValue) return decisions;

    // 预算检查：有足够铸币就直接买，不需要冻结
    var buyCost = RulesEngine.getBuyCost(ctx);
    var goldShortfall = freezeRules.gold_shortfall_multiplier || 1.5;
    var shopHighlights = shopValue.highlights || [];
    var topCardScore = shopHighlights.length > 0 ? shopHighlights[0].score : 0;

    // 金币足够买下核心卡 + 预留一次刷新的钱 → 不冻结
    var canBuyNow = ctx.gold >= buyCost && topCardScore < (freezeRules.shop_value_weights.triple_card || 12);
    if (canBuyNow && shopValue.hasCoreCard && !shopValue.hasGoldenSpell) {
      return decisions;
    }

    var confidence = 0.50;
    var reasonParts = [];

    // 点金之触连招检测
    if (shopValue.hasGoldenSpell && shopValue.hasCoreCard) {
      confidence += 0.30;
      reasonParts.push("点金连招: 店有点金法术+核心随从");
      // 检查是否有具体的高价值目标
      var targets = freezeRules.point_of_gold_targets || {};
      for (var h = 0; h < shopHighlights.length; h++) {
        var hl = shopHighlights[h];
        if (targets[hl.cardId]) {
          reasonParts.push("可点金" + targets[hl.cardId]);
          break;
        }
      }
    }

    // 核心卡检测
    if (shopValue.hasCoreCard) {
      confidence += 0.15;
      if (reasonParts.length === 0) reasonParts.push("店有核心卡");
    }

    // 三连潜力
    if (shopValue.hasTripleCard) {
      confidence += 0.20;
      if (reasonParts.length === 0) reasonParts.push("三连机会");
      else reasonParts.push("可凑三连");
    }

    // 铸币不足 → 更该冻结
    if (ctx.gold < buyCost) {
      confidence += 0.12;
      reasonParts.push("铸币不足(" + ctx.gold + "/" + buyCost + ")");
    }

    // 血量安全检查
    var healthMin = freezeRules.aggressive_freeze_health_min || 20;
    if (ctx.health < healthMin) {
      var freezeDuration = ctx.freezeDuration || 0;
      if (freezeDuration >= (freezeRules.freeze_duration_warning_turns || 2)) {
        confidence -= 0.15;
        reasonParts.push("连续冻结" + freezeDuration + "回合,血量偏低");
      }
    }

    confidence = Math.max(0.30, Math.min(0.92, confidence));

    decisions.push(this._decide(
      "freeze",
      DecisionPriority.FREEZE,
      "freeze_shop",
      "建议冻结",
      reasonParts.join("; ") || "酒馆价值高，建议锁定",
      confidence,
      {
        shopValue: totalScore,
        hasCoreCard: shopValue.hasCoreCard,
        hasTripleCard: shopValue.hasTripleCard,
        hasGoldenSpell: shopValue.hasGoldenSpell,
      }
    ));

    return decisions;
  }
};
