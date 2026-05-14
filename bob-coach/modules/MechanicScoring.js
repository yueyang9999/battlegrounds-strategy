"use strict";

// ═══════════════════════════════════════════════════════════
// MechanicScoring — 通用卡牌文本分析评分引擎
// ═══════════════════════════════════════════════════════════
//
// 适用于饰品/任务/伙伴/畸变 等所有赛季机制。
// 从卡牌文本中提取关键词，四维度评分 → S/A/B/C/D。
//
// 创新点 (vs HDT/Firestone):
//   - 文本分析回退: 无预计算数据时仍可工作
//   - 动态协同: 根据当前阵容种族/关键词实时调整权重
//   - 新赛季上线当天可用，不依赖外部数据更新

var MechanicScoring = {

  // ── 关键词词典 ──

  _economyKeywords: [
    { re: /铸币|金币|获得.*枚|gain.*coin/i, weight: 3 },
    { re: /刷新.*免费|免费.*刷新|refresh.*free/i, weight: 3 },
    { re: /费用.*减少|减费|cost.*less|cheaper/i, weight: 2 },
    { re: /发现|Discover/i, weight: 2 },
    { re: /免费|free/i, weight: 1.5 },
    { re: /出售|sell/i, weight: 1 },  // sell bonus effects
  ],

  _combatKeywords: [
    { re: /攻击力|Attack/i, weight: 2 },
    { re: /生命值|生命|Health/i, weight: 2 },
    { re: /圣盾|Divine Shield/i, weight: 3 },
    { re: /亡语|Deathrattle/i, weight: 2.5 },
    { re: /风怒|Windfury/i, weight: 2.5 },
    { re: /复生|Reborn/i, weight: 3 },
    { re: /剧毒|Venomous/i, weight: 3 },
    { re: /嘲讽|Taunt/i, weight: 1 },
    { re: /暴怒|Frenzy/i, weight: 1.5 },
    { re: /战斗|combat/i, weight: 1 },
    { re: /召唤|summon/i, weight: 2 },
    { re: /属性值|stats/i, weight: 1.5 },
    { re: /翻倍|double/i, weight: 2.5 },
    { re: /相邻|adjacent/i, weight: 1 },
    { re: /永久|permanent/i, weight: 2 },
    { re: /全体|所有随从|all.*minion|your.*minions/i, weight: 2.5 },
    { re: /金色|golden/i, weight: 2 },
  ],

  _tribeKeywords: {
    "亡灵": [/亡灵|undead/i],
    "鱼人": [/鱼人|murloc/i],
    "野兽": [/野兽|beast/i],
    "机械": [/机械|mech|mecha/i],
    "恶魔": [/恶魔|demon/i],
    "海盗": [/海盗|pirate/i],
    "巨龙": [/巨龙|龙|dragon/i],
    "野猪人": [/野猪人|野猪|quilboar/i],
    "纳迦": [/纳迦|naga/i],
    "元素": [/元素|elemental/i],
  },

  _tempoKeywords: [
    { re: /战斗开始时|Start of Combat|immediately/i, weight: 1 },
    { re: /每回合|each turn|every turn|每两个|every.*turn|start of.*turn/i, weight: -0.5 },
    { re: /回合结束时|end of turn/i, weight: -0.5 },
    { re: /战斗.*之后|after.*combat/i, weight: -1 },
    { re: /还剩|remaining|turns/i, weight: -1 },
    { re: /在你.*后|after you/i, weight: 0 },
  ],

  // ── 通用评分函数 ──

  /**
   * @param {Object} card — { cardId, name_cn, text_cn, mechanics[], tier }
   * @param {Object} context — { dominantTribe, boardKeywords, health, availableRaces }
   * @returns {{ totalScore: number, tier: string, dimensions: {...}, reasons: [] }}
   */
  score: function(card, context) {
    context = context || {};
    var text = card.text_cn || card.text || "";
    var name = card.name_cn || "";

    var economy = this._scoreDimension(text, this._economyKeywords, 10);
    var combat = this._scoreDimension(text, this._combatKeywords, 10);
    var synergy = this._scoreSynergy(text, name, context);
    var tempo = this._scoreDimension(text, this._tempoKeywords, 6);

    // 节奏维度允许负分（延迟效果），规范到 0-10
    tempo = Math.max(0, Math.min(10, tempo + 5));

    // 加权总分 (0-10)
    var weighted = economy * 0.25 + combat * 0.30 + synergy * 0.30 + tempo * 0.15;
    var totalScore = Math.round(weighted);

    // S/A/B/C/D 映射
    var tier;
    if (totalScore >= 8) tier = "S";
    else if (totalScore >= 6) tier = "A";
    else if (totalScore >= 4) tier = "B";
    else if (totalScore >= 2) tier = "C";
    else tier = "D";

    return {
      totalScore: totalScore,
      tier: tier,
      dimensions: {
        economy: Math.round(economy),
        combat: Math.round(combat),
        synergy: Math.round(synergy),
        tempo: Math.round(tempo),
      },
      reasons: this._buildReasons(card, totalScore, tier, { economy: economy, combat: combat, synergy: synergy }),
    };
  },

  // ── 内部 ──

  _scoreDimension: function(text, keywords, cap) {
    var score = 0;
    for (var i = 0; i < keywords.length; i++) {
      if (keywords[i].re.test(text)) {
        score += keywords[i].weight;
      }
    }
    return Math.min(cap, Math.max(0, score));
  },

  _scoreSynergy: function(text, name, context) {
    var score = 0;
    var dominantTribe = context.dominantTribe || "";

    // 检查文本是否提到特定种族
    var tribes = Object.keys(this._tribeKeywords);
    for (var i = 0; i < tribes.length; i++) {
      var tribe = tribes[i];
      var patterns = this._tribeKeywords[tribe];
      var matches = false;
      for (var p = 0; p < patterns.length; p++) {
        if (patterns[p].test(text) || patterns[p].test(name)) {
          matches = true;
          break;
        }
      }
      if (!matches) continue;

      // 基础分: 提到了某个种族
      score += 2;

      // 加成: 种族与当前阵容匹配
      if (dominantTribe && tribe === dominantTribe) {
        score += 5;
      }
    }

    // 与阵容关键词匹配 (圣盾/亡语等)
    var boardKeywords = context.boardKeywords || [];
    for (var k = 0; k < boardKeywords.length; k++) {
      var kw = boardKeywords[k];
      for (var j = 0; j < this._combatKeywords.length; j++) {
        if (this._combatKeywords[j].re.test(kw) && this._combatKeywords[j].re.test(text)) {
          score += 1.5;
          break;
        }
      }
    }

    return Math.min(10, score);
  },

  _buildReasons: function(card, score, tier, dims) {
    var reasons = [];
    if (dims.economy >= 5) reasons.push("经济收益高");
    if (dims.combat >= 5) reasons.push("战力提升显著");
    if (dims.synergy >= 5) reasons.push("与阵容高度协同");
    if (dims.synergy >= 3 && dims.synergy < 5) reasons.push("有一定阵容适配性");
    if (dims.economy < 3 && dims.combat < 3 && dims.synergy < 3) reasons.push("效果较弱，优先度低");
    return reasons;
  },

  /**
   * 从卡牌列表批量评分，返回按分数降序排列
   */
  scoreAll: function(cards, context) {
    var results = [];
    for (var i = 0; i < cards.length; i++) {
      results.push(this.score(cards[i], context));
    }
    results.sort(function(a, b) { return b.totalScore - a.totalScore; });
    return results;
  },
};
