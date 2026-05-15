"use strict";

// ═══════════════════════════════════════════════════════
// TrinketOfferSystem — 模拟中的饰品选择系统
// ═══════════════════════════════════════════════════════
//
// 回合 6 提供次级饰品 (lesser=true)，回合 9 提供高级饰品 (lesser=false)
// 每次 4 选 1，随机从不含 tribe 限制的饰品池中抽取
//
// 饰品数据来自 data/cards.json (card_type="trinket") + data/trinket_tips.json

var TrinketOfferSystem = {
  TRINKET_TURNS: [6, 9],

  _lesserTrinkets: null,
  _greaterTrinkets: null,
  _allTrinkets: null,
  _trinketTips: null,

  /**
   * 初始化饰品池。
   * @param {object[]} allCards — cards.json 全量数组
   * @param {object} trinketTips — trinket_tips.json
   */
  init: function(allCards, trinketTips) {
    this._allTrinkets = [];
    this._lesserTrinkets = [];
    this._greaterTrinkets = [];
    this._trinketTips = trinketTips || {};

    for (var i = 0; i < allCards.length; i++) {
      var c = allCards[i];
      if (c.card_type !== "trinket") continue;
      this._allTrinkets.push(c);
      if (c.lesser) {
        this._lesserTrinkets.push(c);
      } else {
        this._greaterTrinkets.push(c);
      }
    }
  },

  /**
   * 为指定回合生成饰品选择。
   * @param {number} turn — 当前回合
   * @param {object} rng — SeededRNG 实例
   * @returns {object[]} 饰品对象数组 (4个)
   */
  generateOffers: function(turn, rng) {
    if (this.TRINKET_TURNS.indexOf(turn) === -1) return [];

    var pool = turn === 6 ? this._lesserTrinkets : this._greaterTrinkets;
    if (!pool || pool.length === 0) return [];

    var shuffled = pool.slice();
    rng.shuffle(shuffled);

    var offers = [];
    var count = Math.min(4, shuffled.length);
    for (var i = 0; i < count; i++) {
      var tc = shuffled[i];
      var tips = this._trinketTips[tc.str_id];
      offers.push({
        cardId: tc.str_id,
        name_cn: tc.name_cn || tc.str_id,
        text_cn: tc.text_cn || "",
        mechanics: tc.mechanics || [],
        tier: tc.tier || 3,
        lesser: !!tc.lesser,
        tips: tips ? tips.tips || [] : [],
      });
    }
    return offers;
  },

  /**
   * 检查当前回合是否应该触发饰品选择。
   */
  isTrinketTurn: function(turn) {
    return this.TRINKET_TURNS.indexOf(turn) !== -1;
  },
};
