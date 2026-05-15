"use strict";

// ═══════════════════════════════════════════════════════════
// PoolTracker — 实时卡池追踪与概率计算
// ═══════════════════════════════════════════════════════════
//
// 对接 log-parser 的 GameStateTracker 事件，维护当前对局的
// 随从卡池剩余量，提供实时刷新/三连发现概率。
//
// 规则:
//   - 购买/三连: 从卡池扣除
//   - 出售: 退还卡池
//   - 玩家淘汰: 全部退还
//   - 复制/点金法术: 不扣卡池（需区分来源）
//   - 金色随从 = 3张普通版合成，出售金色退还3张

var COPIES_PER_TIER = { 1: 18, 2: 15, 3: 13, 4: 11, 5: 9, 6: 6 };
var SHOP_SIZES = { 1: 3, 2: 4, 3: 4, 4: 5, 5: 5, 6: 6 };

var PoolTracker = class PoolTracker {

  /**
   * @param {CardDatabase} cardDb — CardDatabase 实例
   */
  constructor(cardDb) {
    this.db = cardDb;

    // 当前对局状态
    this.remaining = Object.create(null);    // { cardId: copiesLeft }
    this.selectedRaces = [];                 // 本局可用种族
    this.availableMinions = [];              // 本局所有可用随从 ID
    this.minionTiers = Object.create(null);  // { cardId: tier }
    this.opponentCount = 7;                  // 对手数量 (7 = 满员)
    this.playersAlive = 8;                   // 存活的玩家数
    this.playerEliminated = false;
    this._initialized = false;
  }

  // ── 初始化 ──

  /**
   * 根据本局可用种族，初始化卡池。
   * @param {string[]} selectedRaces — 本局 5 个种族
   * @param {string[]} [availableMinionIds] — 可选：预计算好的随从ID列表
   */
  init(selectedRaces, availableMinionIds) {
    this.selectedRaces = selectedRaces || [];
    this.remaining = Object.create(null);
    this.availableMinions = [];
    this.minionTiers = Object.create(null);
    this._initialized = true;

    // 如果没有预计算列表，从 CardDatabase 查询
    if (!availableMinionIds) {
      availableMinionIds = this._findAvailableMinions(selectedRaces);
    }
    this.availableMinions = availableMinionIds;

    // 初始化卡池计数
    for (var i = 0; i < availableMinionIds.length; i++) {
      var id = availableMinionIds[i];
      var card = this.db.getCard(id);
      var tier = card ? card.tier : 6;
      this.minionTiers[id] = tier;
      var copies = COPIES_PER_TIER[tier] || 6;
      this.remaining[id] = copies;
    }
  }

  /**
   * 查找可用种族的所有随从。
   */
  _findAvailableMinions(selectedRaces) {
    var available = [];
    var seen = Object.create(null);

    for (var r = 0; r < selectedRaces.length; r++) {
      var cards = this.db.getByRace(selectedRaces[r]);
      for (var i = 0; i < cards.length; i++) {
        var id = cards[i].str_id || cards[i].id;
        if (id && !seen[id]) {
          seen[id] = true;
          available.push(id);
        }
      }
    }

    // 中立随从 (无种族但有 tier 的 minion)
    var allCards = this.db.cards;
    for (var j = 0; j < allCards.length; j++) {
      var c = allCards[j];
      if (c.card_type !== "minion") continue;
      var cid = c.str_id || c.id;
      if (!cid || seen[cid]) continue;
      var races = c.minion_types_cn || [];
      if (races.length === 0) {
        seen[cid] = true;
        available.push(cid);
      }
    }

    return available;
  }

  // ── 卡池操作 ──

  /**
   * 购买随从 — 从卡池移除 1 张。
   */
  buy(minionId) {
    var cur = this.remaining[minionId];
    if (typeof cur === "number" && cur > 0) {
      this.remaining[minionId] = cur - 1;
    }
  }

  /**
   * 出售随从 — 退还卡池 1 张。
   */
  sell(minionId) {
    var cur = this.remaining[minionId];
    if (typeof cur === "number") {
      var tier = this.minionTiers[minionId] || 6;
      var maxCopies = COPIES_PER_TIER[tier] || 6;
      if (cur < maxCopies) {
        this.remaining[minionId] = cur + 1;
      }
    }
  }

  /**
   * 三连合成 — 扣除 3 张普通版。
   * (金色版本不占用额外卡池位置，因为已经扣了3张)
   */
  combineTriple(minionId) {
    var cur = this.remaining[minionId];
    if (typeof cur === "number") {
      this.remaining[minionId] = Math.max(0, cur - 3);
    }
  }

  /**
   * 出售金色随从 — 退还 3 张。
   */
  sellGolden(minionId) {
    var cur = this.remaining[minionId];
    if (typeof cur === "number") {
      var tier = this.minionTiers[minionId] || 6;
      var maxCopies = COPIES_PER_TIER[tier] || 6;
      this.remaining[minionId] = Math.min(maxCopies, cur + 3);
    }
  }

  /**
   * 对手淘汰 — 将其持有的随从退还卡池。
   * @param {string[]} knownMinionIds — 该对手已知的随从ID
   */
  opponentEliminated(knownMinionIds) {
    this.playersAlive = Math.max(1, this.playersAlive - 1);
    if (!knownMinionIds) return;
    for (var i = 0; i < knownMinionIds.length; i++) {
      this.sell(knownMinionIds[i]);
    }
  }

  /**
   * 玩家自己淘汰。
   */
  playerEliminate() {
    this.playerEliminated = true;
  }

  // ── 概率计算 ──

  /**
   * 获取当前酒馆等级可刷出的所有随从。
   * @param {number} tavernTier
   * @returns {string[]}
   */
  getAccessible(tavernTier) {
    var ids = [];
    for (var i = 0; i < this.availableMinions.length; i++) {
      var id = this.availableMinions[i];
      var tier = this.minionTiers[id];
      if (tier && tier <= tavernTier && (this.remaining[id] || 0) > 0) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * 获取可刷出随从的总份数。
   * @param {number} tavernTier
   * @returns {number}
   */
  getTotalAccessibleCopies(tavernTier) {
    var accessible = this.getAccessible(tavernTier);
    var total = 0;
    for (var i = 0; i < accessible.length; i++) {
      total += this.remaining[accessible[i]] || 0;
    }
    return total;
  }

  /**
   * 单次刷新出现特定随从的概率。
   *
   * 计算方式: 假设每格从剩余卡池有放回抽取。
   * P(至少出现1次) = 1 - P(不出现)^shopSize
   *
   * @param {string} targetId
   * @param {number} tavernTier
   * @returns {number} 概率 (0-1)
   */
  refreshProbability(targetId, tavernTier) {
    var targetCard = this.db.getCard(targetId);
    if (!targetCard || !targetCard.tier) return 0;
    if (targetCard.tier > tavernTier) return 0;

    var targetCopies = this.remaining[targetId];
    if (!targetCopies || targetCopies <= 0) return 0;

    var totalCopies = this.getTotalAccessibleCopies(tavernTier);
    if (totalCopies <= 0) return 0;

    var shopSize = SHOP_SIZES[tavernTier] || 3;

    // 无放回抽样近似: P(不出现) = Π(各格)
    var probNone = 1.0;
    var remainingTotal = totalCopies;
    for (var i = 0; i < shopSize; i++) {
      if (remainingTotal <= 0) break;
      probNone *= 1 - targetCopies / remainingTotal;
      remainingTotal--;
      // 近似：每抽一张后总数和目标数都微调
      // (简化处理，不精确追踪每张抽到的可能结果)
    }

    return Math.min(1, Math.max(0, 1 - probNone));
  }

  /**
   * 三连发现特定随从的概率。
   *
   * 发现规则: 从高一星的随从中选 3 个不重复的。
   * P(出现) ≈ 3 * targetCopies / totalCopiesAtTier
   *
   * @param {string} targetId
   * @param {number} discoverTier — 发现的星级 (= 当前等级 + 1)
   * @returns {number} 概率 (0-1)
   */
  discoverProbability(targetId, discoverTier) {
    var targetCard = this.db.getCard(targetId);
    if (!targetCard || !targetCard.tier) return 0;
    if (targetCard.tier !== discoverTier) return 0;

    var targetCopies = this.remaining[targetId];
    if (!targetCopies || targetCopies <= 0) return 0;

    // 获取该星级所有有剩余份数的随从
    var atTier = [];
    for (var i = 0; i < this.availableMinions.length; i++) {
      var id = this.availableMinions[i];
      var tier = this.minionTiers[id];
      if (tier === discoverTier && (this.remaining[id] || 0) > 0) {
        atTier.push(id);
      }
    }

    var totalAtTier = 0;
    for (var j = 0; j < atTier.length; j++) {
      totalAtTier += this.remaining[atTier[j]] || 0;
    }
    if (totalAtTier <= 0) return 0;

    // 3 个选项不重复，简化估计 (不是精确超几何，但足够指导)
    return Math.min(1, (3 * targetCopies) / totalAtTier);
  }

  /**
   * 获取剩余份数。
   * @returns {number}
   */
  getRemaining(minionId) {
    return this.remaining[minionId] || 0;
  }

  /**
   * 获取某星级卡池总剩余份数。
   * @returns {number}
   */
  getTierRemaining(tier) {
    var total = 0;
    for (var i = 0; i < this.availableMinions.length; i++) {
      var id = this.availableMinions[i];
      if (this.minionTiers[id] === tier) {
        total += this.remaining[id] || 0;
      }
    }
    return total;
  }

  /**
   * 重置对局状态。
   */
  reset() {
    this.remaining = Object.create(null);
    this.selectedRaces = [];
    this.availableMinions = [];
    this.minionTiers = Object.create(null);
    this.playersAlive = 8;
    this.playerEliminated = false;
    this._initialized = false;
  }

  // ── 调试/诊断 ──

  /**
   * 获取卡池摘要，供 UI 展示。
   * @returns {object}
   */
  getSummary(tavernTier) {
    var accessible = this.getAccessible(tavernTier || 6);
    var totalCopies = 0;
    var byTier = {};
    for (var i = 0; i < accessible.length; i++) {
      var id = accessible[i];
      var t = this.minionTiers[id] || 0;
      var copies = this.remaining[id] || 0;
      totalCopies += copies;
      byTier[t] = (byTier[t] || 0) + copies;
    }

    return {
      initialized: this._initialized,
      selectedRaces: this.selectedRaces,
      totalAccessibleIds: accessible.length,
      totalCopies: totalCopies,
      copiesByTier: byTier,
      playersAlive: this.playersAlive,
    };
  }
};
