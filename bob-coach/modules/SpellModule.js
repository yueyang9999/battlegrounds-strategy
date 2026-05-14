"use strict";

// ═══════════════════════════════════════════════════════════
// SpellModule — 法术购买/施放/时机/顺序建议（v2 协同增强）
// ═══════════════════════════════════════════════════════════
//
// 五维评分模型：
//   1. 法术自身类别权重 (economy > discover > combat)
//   2. 场面协同加成 (buff_amplifier / cast_trigger / duplicator / generator)
//   3. 英雄技能协同
//   4. 饰品协同
//   5. 铸币预算效率
//
// 施放时机分三级： immediate → after_buy → after_actions
// 施放顺序按 cast_order 优先级排序

var SpellModule = class SpellModule extends BaseModule {
  constructor(config) {
    super("SpellModule", config);
    this._interactions = null; // lazy load
  }

  /** @override */
  evaluate(ctx) {
    var decisions = [];
    if (!ctx) return decisions;
    var shopSpells = ctx.shopSpells || [];
    if (shopSpells.length === 0) return decisions;

    var rules = this.config.spell_rules || {};
    var weights = this.config.spell_weights || {};
    var synergyRules = rules.synergy_weights || {};
    var timingRules = rules.cast_timing || {};

    // 计算场面协同分数（对所有法术共享）
    var synergyCtx = this._buildSynergyContext(ctx, rules);

    for (var i = 0; i < shopSpells.length; i++) {
      var spell = shopSpells[i];
      var w = weights[spell.cardId];
      // 如果 spell_weights 有预设但没有 subcategory，从 auto-classify 补充
      var autoClassified = null;
      if (!w) {
        w = this._classifySpell(spell, rules);
      } else if (!w.subcategory && w.category === "combat") {
        // 预设条目通常缺少 subcategory，补充分类以区分 aura/target
        autoClassified = this._classifySpell(spell, rules);
        w = Object.assign({}, w, { subcategory: autoClassified.subcategory });
      }

      if (w.skip) continue;

      var cost = (typeof RulesEngine !== "undefined" && RulesEngine.getSpellCost)
        ? RulesEngine.getSpellCost(spell.cardId, ctx)
        : (w.cost || rules.default_cost || 1);
      if (ctx.gold < cost) continue;

      // ── 五维评分 ──
      var baseScore = this._baseCategoryScore(w.category);
      var synergyScore = this._calcSynergyScore(w.category, synergyCtx, synergyRules);
      var heroBonus = synergyCtx.heroSpellSynergy ? synergyRules.hero_spell_synergy || 3 : 0;
      var trinketBonus = synergyCtx.trinketCount * (synergyRules.trinket_spell_synergy || 2);
      var budgetScore = this._budgetEfficiency(cost, w.category, ctx);

      var totalScore = baseScore + synergyScore + heroBonus + trinketBonus + budgetScore;

      // ── 特殊法术加成 ──
      // 护甲法术：低血量/高回合时提升评分
      if (spell.cardId === "BG28_500" || spell.cardId === "BG34_Treasure_934") {
        var effectiveHp = (ctx.health || 0) + (ctx.armor || 0);
        if (effectiveHp <= 15) {
          totalScore += 5;  // 危险血量，护甲法术优先级高
        } else if (effectiveHp <= 25 && (ctx.turn || 5) >= 8) {
          totalScore += 3;  // 中后期，护甲提供容错
        } else if (effectiveHp <= 25) {
          totalScore += 1;
        }
      }

      // 智慧球：高优先级
      if (spell.cardId === "BG30_802" || spell.cardId === "BG24_Reward_313") {
        totalScore += 4;  // 智慧球始终高价值
        if ((ctx.turn || 5) >= 8) totalScore += 2;  // 后期更高价值（可出七星随从）
      }

      // HP-cost 法术：低血量时不推荐
      if (spell.cardId === "BG28_571") {
        var hp = (ctx.health || 30) + (ctx.armor || 0);
        if (hp <= 15) {
          totalScore -= 8;  // 危险血量，不推荐用血换铸币
        } else if (hp <= 25 && (ctx.turn || 5) <= 6) {
          totalScore -= 3;
        }
      }

      // ── 决策生成 ──
      var priority, confidence, label;

      if (totalScore >= 12) {
        priority = DecisionPriority.SPELL_MUST_BUY;
        confidence = 0.9;
        label = "必买 " + spell.name_cn;
      } else if (totalScore >= 7) {
        priority = DecisionPriority.SPELL_MUST_BUY;
        confidence = 0.75;
        label = "推荐买 " + spell.name_cn;
      } else if (totalScore >= 4) {
        priority = DecisionPriority.SPELL_GOOD;
        confidence = 0.55;
        label = "可选买 " + spell.name_cn;
      } else {
        priority = DecisionPriority.SPELL_GOOD;
        confidence = 0.4;
        label = "买 " + spell.name_cn;
      }

      // 组合 reason 字符串
      var reasonParts = [];
      if (w.reason) reasonParts.push(w.reason);
      if (synergyScore >= 2) reasonParts.push("场面协同+" + synergyScore.toFixed(1));
      if (heroBonus > 0) reasonParts.push("英雄协同");
      if (trinketBonus > 0) reasonParts.push("饰品协同+" + trinketBonus.toFixed(0));

      // 施放时机
      var timing = this._getCastTiming(w.category, w.subcategory || "", timingRules);
      var castPhase = timing ? timing.phase : "after_buy";
      var castPriority = timing ? timing.priority : 50;

      decisions.push(this._decide(
        "spell_buy",
        priority,
        "buy_spell_" + (spell.position !== undefined ? spell.position : i),
        label,
        reasonParts.join("; ") || "法术 — " + (spell.text_cn || spell.name_cn),
        confidence,
        {
          cardId: spell.cardId,
          position: spell.position,
          cost: cost,
          category: w.category,
          totalScore: totalScore,
          synergyScore: synergyScore,
          castPhase: castPhase,
          castPriority: castPriority,
        }
      ));
    }

    // 按 totalScore 降序排序（即推荐购买顺序）
    decisions.sort(function (a, b) {
      return (b.data.totalScore || 0) - (a.data.totalScore || 0);
    });

    // 重新编号 action（保持排序后的顺序）
    for (var d = 0; d < decisions.length; d++) {
      decisions[d].action = "buy_spell_" + d;
    }

    return decisions;
  }

  // ── 五维评分计算 ──

  _baseCategoryScore(category) {
    switch (category) {
      case "economy": return 7;
      case "discover": return 4;
      case "combat": return 2;
      default: return 2;
    }
  }

  _calcSynergyScore(category, ctx, rules) {
    var score = 0;

    // 每张效果放大随从 +weight
    score += ctx.buffAmplifierCount * (rules.buff_amplifier_per_card || 2);
    // 每张施放触发随从 +weight
    score += ctx.castTriggerCount * (rules.cast_trigger_per_card || 1.5);
    // 每张法术复制随从 +weight
    score += ctx.duplicatorCount * (rules.duplicator_per_card || 2.5);
    // 每张法术生成随从 +weight
    score += ctx.generatorCount * (rules.generator_per_card || 1);
    // 每张法术减费随从 +weight
    score += ctx.costReducerCount * (rules.cost_reducer_per_card || 1.5);

    // 无场面协同但有战斗法术 → 检查是否确实需要
    if (ctx.boardCount === 0 && category === "combat") {
      score = 0; // 空场买战力法术无意义
    }

    return score;
  }

  _budgetEfficiency(cost, category, ctx) {
    // 经济法术：净收益 = 预期回报 - 花费
    if (category === "economy") {
      // 节省铸币的法术（酒馆币、钻探原油等）净值>0
      if (cost === 0) return 3;
      if (cost === 1) return 2;
      return 1;
    }
    // 其他法术：铸币充裕时加分，紧张时减分
    var goldAfterBuy = ctx.gold - cost;
    if (goldAfterBuy >= 3) return 1;   // 还有余钱
    if (goldAfterBuy >= 0) return 0;   // 刚好花完
    return -1; // (不会到这里，前面已检查 canAfford)
  }

  // ── 施放时机 ──

  _getCastTiming(category, subcategory, timingRules) {
    switch (category) {
      case "economy":
        return timingRules.economy || { phase: "immediate", priority: 100 };
      case "combat":
        // 光环类（全体buff）→ immediate；目标类 → after_buy
        if (subcategory === "aura") {
          return timingRules.combat_aura || { phase: "immediate", priority: 80 };
        }
        return timingRules.combat_target || { phase: "after_buy", priority: 70 };
      case "discover":
        return timingRules.discover || { phase: "after_actions", priority: 50 };
      default:
        return { phase: "after_buy", priority: 50 };
    }
  }

  // ── 场面协同上下文 ──

  _buildSynergyContext(ctx, rules) {
    var synergyCtx = {
      boardCount: (ctx.boardMinions || []).length,
      buffAmplifierCount: 0,
      castTriggerCount: 0,
      duplicatorCount: 0,
      generatorCount: 0,
      costReducerCount: 0,
      heroSpellSynergy: false,
      trinketCount: 0,
    };

    // 加载交互数据
    this._ensureInteractions(ctx);

    var interactions = this._interactions || ctx._spellInteractions;
    if (!interactions) return synergyCtx;

    // 扫描场上随从
    var board = ctx.boardMinions || [];
    var boardIds = {};
    for (var i = 0; i < board.length; i++) {
      boardIds[board[i].cardId] = true;
    }

    synergyCtx.buffAmplifierCount = this._countOverlap(boardIds, interactions.buffAmplifierIds);
    synergyCtx.castTriggerCount = this._countOverlap(boardIds, interactions.castTriggerIds);
    synergyCtx.duplicatorCount = this._countOverlap(boardIds, interactions.duplicatorIds);
    synergyCtx.generatorCount = this._countOverlap(boardIds, interactions.generatorIds);
    synergyCtx.costReducerCount = this._countOverlap(boardIds, interactions.costReducerIds);

    // 英雄技能是否与法术协同
    if (ctx.heroCardId && rules.hero_spell_synergy) {
      synergyCtx.heroSpellSynergy = !!rules.hero_spell_synergy[ctx.heroCardId];
    }

    // 已装备饰品中法术相关数量（简化：检查 trinketOffer 中的法术相关饰品）
    var trinkets = ctx.trinketOffer || [];
    var trinketInteractIds = interactions.trinketInteractIds || {};
    for (var t = 0; t < trinkets.length; t++) {
      if (trinketInteractIds[trinkets[t].cardId || trinkets[t].id]) {
        synergyCtx.trinketCount++;
      }
    }

    return synergyCtx;
  }

  _countOverlap(boardIds, interactSet) {
    if (!interactSet) return 0;
    var count = 0;
    for (var id in interactSet) {
      if (boardIds[id]) count++;
    }
    return count;
  }

  _ensureInteractions(ctx) {
    if (this._interactions) return;
    // 优先使用 ctx 预加载的交互数据
    if (ctx._spellInteractions) {
      this._interactions = ctx._spellInteractions;
      return;
    }
    // ctx 无数据时使用空集（但不缓存，下次 ctx 有数据时再尝试）
    // 缓存空集会导致后续 ctx 有数据也被忽略
  }

  // ── 自动分类：根据卡牌描述文本 ──

  _classifySpell(spell, rules) {
    var text = (spell.text_cn || "").replace(/\s+/g, "").toLowerCase();
    var name = (spell.name_cn || "").replace(/\s+/g, "").toLowerCase();
    var combined = text + name;

    var categoryMap = rules.category_keywords || {};
    var category = "general";
    var subcategory = "";

    for (var cat in categoryMap) {
      var keywords = categoryMap[cat];
      for (var k = 0; k < keywords.length; k++) {
        if (combined.indexOf(keywords[k]) !== -1) {
          category = cat;
          break;
        }
      }
      if (category !== "general") break;
    }

    // 子分类检测
    if (category === "combat") {
      // 全体buff vs 单体目标
      if (combined.indexOf("全体") !== -1 || combined.indexOf("所有") !== -1 ||
          combined.indexOf("你的随从") !== -1) {
        subcategory = "aura";
      } else {
        subcategory = "target";
      }
    }

    var reasons = {
      economy: "经济法术，性价比高",
      combat: subcategory === "aura" ? "光环类战力法术，立即生效" : "目标型战力法术，增强场面",
      discover: "发现法术，补充手牌资源",
      general: "通用法术",
    };

    return {
      category: category,
      subcategory: subcategory,
      cost: (rules.default_cost != null) ? rules.default_cost : 1,
      reason: reasons[category] || reasons.general,
    };
  }
};
