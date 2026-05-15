"use strict";

// ═══════════════════════════════════════════════════════════
// CardDatabase — 卡牌多维索引库
// ═══════════════════════════════════════════════════════════
//
// 从 data/cards.json 加载，构建 6 维索引：
//   byId / byTier / byRace / byKeyword / byTag / byTiming / byCardType
//
// 每张卡计算 economy/tempo/synergy 三维度分数 (0-10)，
// 复用 MechanicScoring.js 的关键词词典。
//
// 暴露查询接口，供决策模块和 PoolTracker 使用。

var CardDatabase = class CardDatabase {

  /**
   * @param {object[]} cards — data/cards.json 的数组
   */
  constructor(cards) {
    this.cards = cards || [];
    this.total = this.cards.length;

    // ── 6 维索引 ──
    this._byId = Object.create(null);
    this._byTier = Object.create(null);    // { 1: [card], 2: [card], ... }
    this._byRace = Object.create(null);    // { "野兽": [card], "机械": [card], ... }
    this._byKeyword = Object.create(null); // { "圣盾": [card], "亡语": [card], ... }
    this._byTag = Object.create(null);     // { "economy": [card], "anti_divine_shield": [card], ... }
    this._byTiming = Object.create(null);  // { "early": [card], "mid": [card], "late": [card] }
    this._byCardType = Object.create(null);// { "minion": [card], "spell": [card], ... }
    this._byNameCn = Object.create(null);  // { "战吼铜须": card, ... }

    this._buildIndex();
  }

  // ── 构建索引 ──

  _buildIndex() {
    for (var i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      var id = c.str_id || c.id || "";
      if (!id) continue;

      // byId
      this._byId[id] = c;

      // byNameCn
      if (c.name_cn) {
        this._byNameCn[c.name_cn] = c;
      }

      // byCardType
      var type = c.card_type || "minion";
      if (!this._byCardType[type]) this._byCardType[type] = [];
      this._byCardType[type].push(c);

      // 随从专属维度
      if (type === "minion") {
        // byTier
        var tier = c.tier;
        if (tier) {
          if (!this._byTier[tier]) this._byTier[tier] = [];
          this._byTier[tier].push(c);
        }

        // byRace
        var races = c.minion_types_cn || [];
        for (var r = 0; r < races.length; r++) {
          var race = races[r];
          if (!this._byRace[race]) this._byRace[race] = [];
          this._byRace[race].push(c);
        }

        // byKeyword — 从 mechanics 数组提取
        var mechs = c.mechanics || [];
        for (var m = 0; m < mechs.length; m++) {
          var kw = mechs[m];
          if (!this._byKeyword[kw]) this._byKeyword[kw] = [];
          this._byKeyword[kw].push(c);
        }

        // byTag — 从 mechanics + text_cn 推断标签
        var tags = this._inferTags(c);
        for (var t = 0; t < tags.length; t++) {
          var tag = tags[t];
          if (!this._byTag[tag]) this._byTag[tag] = [];
          this._byTag[tag].push(c);
        }

        // byTiming — 根据星级推断
        var timing;
        if (tier <= 2) timing = "early";
        else if (tier <= 4) timing = "mid";
        else timing = "late";
        if (!this._byTiming[timing]) this._byTiming[timing] = [];
        this._byTiming[timing].push(c);
      }
    }

    // ── 为所有卡牌计算维度分数 ──
    this._computeDimensions();
  }

  // ── 标签推断 ──

  _inferTags(card) {
    var tags = [];
    var mechs = card.mechanics || [];
    var text = (card.text_cn || "").toLowerCase();

    // mechanics → tags
    for (var i = 0; i < mechs.length; i++) {
      var m = mechs[i];
      if (m === "DIVINE_SHIELD") tags.push("shield");
      else if (m === "DEATHRATTLE") tags.push("deathrattle");
      else if (m === "WINDFURY") tags.push("windfury");
      else if (m === "REBORN") tags.push("reborn");
      else if (m === "VENOMOUS" || m === "POISONOUS") tags.push("venomous");
      else if (m === "TAUNT") tags.push("taunt");
      else if (m === "Frenzy") tags.push("frenzy");
      else if (m === "AVENGE") tags.push("avenge");
      else if (m === "BATTLECRY") tags.push("battlecry");
      else if (m === "END_OF_TURN_TRIGGER") tags.push("end_of_turn");
      else if (m === "START_OF_COMBAT") tags.push("start_of_combat");
      else if (m === "MAGNETIC") tags.push("magnetic");
      else if (m === "SPELLCRAFT" || m === "CHOOSE_ONE") tags.push("flexible");
      else if (m === "DISCOVER") tags.push("discover");
    }

    // text → economy 标签
    if (/铸币|金币|获得.*枚|gain.*coin/i.test(text)) tags.push("economy");
    if (/刷新.*免费|免费.*刷新|refresh.*free/i.test(text)) tags.push("economy");
    if (/费用.*减少|减费|cost.*less/i.test(text)) tags.push("economy");
    if (/发现|discover/i.test(text) && tags.indexOf("discover") === -1) tags.push("discover");
    if (/出售|sell/i.test(text)) tags.push("sell_synergy");

    // text → 特殊标签
    if (/圣盾|divine shield/i.test(text) && tags.indexOf("shield") === -1) tags.push("shield_synergy");
    if (/亡语|deathrattle/i.test(text) && tags.indexOf("deathrattle") === -1) tags.push("deathrattle_synergy");
    if (/战斗.*召唤|summon.*combat|immediately.*summon/i.test(text)) tags.push("token_generator");
    if (/金色|golden/i.test(text)) tags.push("golden_interact");

    return tags;
  }

  // ── 维度计算 (复用 MechanicScoring 词典) ──

  _computeDimensions() {
    for (var i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      if (c.card_type !== "minion") continue;
      if (c._dimensions) continue; // 已计算

      var text = c.text_cn || "";
      c._dimensions = {
        economy: this._scoreEconomy(text),
        tempo: this._scoreTempo(text, c.tier || 3),
        synergy: this._scoreBaseSynergy(c),
        timing_tier: this._inferTimingTier(c.tier || 3),
      };
    }
  }

  _scoreEconomy(text) {
    var keywords = [
      { re: /铸币|金币|获得.*枚|gain.*coin/i, weight: 3 },
      { re: /刷新.*免费|免费.*刷新|refresh.*free/i, weight: 3 },
      { re: /费用.*减少|减费|cost.*less|cheaper/i, weight: 2 },
      { re: /发现|Discover/i, weight: 2 },
      { re: /免费|free/i, weight: 1.5 },
      { re: /出售|sell/i, weight: 1 },
    ];
    var score = 0;
    for (var i = 0; i < keywords.length; i++) {
      if (keywords[i].re.test(text)) score += keywords[i].weight;
    }
    return Math.min(10, Math.max(0, Math.round(score)));
  }

  _scoreTempo(text, tier) {
    // T1-T2=6 (早期经济+节奏), T3=5 (中期过渡), T4=4 (关键稳血期), T5+=3
    var base = tier <= 2 ? 6 : tier === 3 ? 5 : tier === 4 ? 4 : 3;

    var combatKw = [
      { re: /圣盾|Divine Shield/i, weight: 2 },
      { re: /风怒|Windfury/i, weight: 1.5 },
      { re: /复生|Reborn/i, weight: 1.5 },
      { re: /剧毒|Venomous/i, weight: 2 },
      { re: /召唤|summon/i, weight: 1 },
      { re: /战斗开始时|Start of Combat|immediately/i, weight: 1.5 },
    ];
    var bonus = 0;
    for (var i = 0; i < combatKw.length; i++) {
      if (combatKw[i].re.test(text)) bonus += combatKw[i].weight;
    }

    // 延迟效果惩罚（减轻，end-of-turn 成长也是有效 tempo）
    var delayKw = [
      { re: /回合结束时|end of turn/i, weight: -0.5 },
      { re: /战斗.*之后|after.*combat/i, weight: -0.5 },
      { re: /还剩|remaining|turns/i, weight: -0.5 },
    ];
    for (var j = 0; j < delayKw.length; j++) {
      if (delayKw[j].re.test(text)) bonus += delayKw[j].weight;
    }

    return Math.min(10, Math.max(0, Math.round(base + bonus)));
  }

  _scoreBaseSynergy(card) {
    // 根据 mechanics 数量和种族关联度估计协同分
    var score = 0;
    var mechs = card.mechanics || [];
    if (mechs.length >= 3) score += 3;
    else if (mechs.length >= 2) score += 2;
    else if (mechs.length >= 1) score += 1;

    var races = card.minion_types_cn || [];
    if (races.length >= 2) score += 3; // 双种族，协同面更广
    else if (races.length === 1) score += 2;

    // mechanics 中有特定协同关键词
    for (var i = 0; i < mechs.length; i++) {
      if (mechs[i] === "AVENGE" || mechs[i] === "END_OF_TURN_TRIGGER" || mechs[i] === "TRIGGER_VISUAL") {
        score += 1;
        break;
      }
    }

    return Math.min(10, score);
  }

  _inferTimingTier(tier) {
    if (tier <= 2) return "early";
    if (tier <= 4) return "mid";
    return "late";
  }

  // ═══════════════════════════════════════════════════════════
  // 公共查询 API
  // ═══════════════════════════════════════════════════════════

  /** @returns {object|null} */
  getCard(id) {
    return this._byId[id] || null;
  }

  /** @returns {object[]} */
  getByTier(tier) {
    return this._byTier[tier] || [];
  }

  /** @returns {object[]} */
  getByRace(race) {
    // 模糊匹配：支持中文种族名
    if (this._byRace[race]) return this._byRace[race];
    // 尝试部分匹配
    var keys = Object.keys(this._byRace);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(race) !== -1 || race.indexOf(keys[i]) !== -1) {
        return this._byRace[keys[i]];
      }
    }
    return [];
  }

  /** @returns {object[]} */
  getByKeyword(keyword) {
    return this._byKeyword[keyword] || [];
  }

  /** @returns {object[]} */
  getByTag(tag) {
    return this._byTag[tag] || [];
  }

  /** @returns {object[]} */
  getByTiming(spike) {
    return this._byTiming[spike] || [];
  }

  /** @returns {object[]} */
  getByCardType(type) {
    return this._byCardType[type] || [];
  }

  /**
   * 按维度过滤。
   * @param {"economy"|"tempo"|"synergy"} dim
   * @param {number} min — 最低分 (0-10)
   * @returns {object[]}
   */
  getByDimension(dim, min) {
    var results = [];
    for (var i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      var dims = c._dimensions;
      if (!dims) continue;
      var val = dims[dim];
      if (typeof val === "number" && val >= min) {
        results.push(c);
      }
    }
    return results;
  }

  /**
   * 多维度查询。
   * @param {object} filters — { tier, race, keyword, tag, timing, minEconomy, minTempo, minSynergy }
   * @returns {object[]}
   */
  query(filters) {
    filters = filters || {};
    var results = [];

    for (var i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      if (c.card_type !== "minion") continue;

      if (filters.tier && c.tier !== filters.tier) continue;
      if (filters.race) {
        var races = c.minion_types_cn || [];
        if (races.indexOf(filters.race) === -1) continue;
      }
      if (filters.keyword) {
        var mechs = c.mechanics || [];
        if (mechs.indexOf(filters.keyword) === -1) continue;
      }
      if (filters.tag) {
        var tags = this._inferTags(c);
        if (tags.indexOf(filters.tag) === -1) continue;
      }
      if (filters.timing && this._inferTimingTier(c.tier || 3) !== filters.timing) continue;

      var dims = c._dimensions;
      if (typeof filters.minEconomy === "number" && (!dims || dims.economy < filters.minEconomy)) continue;
      if (typeof filters.minTempo === "number" && (!dims || dims.tempo < filters.minTempo)) continue;
      if (typeof filters.minSynergy === "number" && (!dims || dims.synergy < filters.minSynergy)) continue;

      results.push(c);
    }

    return results;
  }

  /**
   * 获取所有可用的种族列表。
   * @returns {string[]}
   */
  getAvailableRaces() {
    return Object.keys(this._byRace).sort();
  }

  /**
   * 获取所有标签列表。
   * @returns {string[]}
   */
  getAvailableTags() {
    return Object.keys(this._byTag).sort();
  }

  /**
   * 通过中文名称查找卡牌。
   * @param {string} nameCn
   * @returns {object|null}
   */
  getByNameCn(nameCn) {
    return this._byNameCn[nameCn] || null;
  }

  /**
   * 将原始卡牌数据转为 cardsById map（供其他模块快速查询）。
   * @returns {object} { cardId: card }
   */
  toCardsById() {
    return this._byId;
  }
};
