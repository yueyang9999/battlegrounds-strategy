"use strict";

// ═══════════════════════════════════════════════════════════
// HeroPowerModule — 英雄技能使用时机建议
// ═══════════════════════════════════════════════════════════

var HeroPowerModule = class HeroPowerModule extends BaseModule {
  constructor(config) {
    super("HeroPowerModule", config);
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    var rules = this.config.hero_power_rules || {};

    // 检查英雄级别覆盖：skip_hint
    var override = this._heroOverride(ctx.heroCardId, rules);
    if (override && override.skip_hint) return decisions;

    var cost = ctx.heroPowerCost;

    // 被动/0费技能跳过提示
    if (cost === 0 || cost === (rules.passive_cost || 0)) return decisions;

    var canAfford = ctx.gold >= cost;
    if (!canAfford) return decisions;

    // 检查英雄特定规则
    var preferBoardFirst = override && override.prefer_board_first;

    var spareAfterHp = ctx.gold - cost;
    var minSpare = rules.min_spare_gold_after_hp || 0;
    var confidenceBase = rules.confidence_base || 0.7;

    // 费用足够买技能+随从 → 强烈建议
    if (spareAfterHp >= 3) {
      // 有3费以上剩余，可以买随从
      decisions.push(this._decide(
        "hero_power",
        DecisionPriority.HERO_POWER_MANDATORY,
        "use_hero_power",
        "使用英雄技能",
        "当前" + ctx.gold + "费，英雄技能花费" + cost + "费，" +
        "使用后仍有" + spareAfterHp + "费可购买随从或刷新。",
        confidenceBase + 0.15,
        { cost: cost, spareAfter: spareAfterHp }
      ));
    } else if (spareAfterHp >= minSpare) {
      // 剩余费用较少但仍可用
      var priority = preferBoardFirst ? DecisionPriority.POWER_MINION : DecisionPriority.POWER_MINION;
      decisions.push(this._decide(
        "hero_power",
        priority,
        "use_hero_power",
        "考虑使用英雄技能",
        "剩余" + ctx.gold + "费，英雄技能花费" + cost + "费。" +
        (preferBoardFirst ? "建议优先购买场面随从后再使用技能。" : "使用后剩余费用有限。"),
        confidenceBase,
        { cost: cost, spareAfter: spareAfterHp, limited: true }
      ));
    }

    return decisions;
  }
};
