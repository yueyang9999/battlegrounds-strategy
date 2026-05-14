"use strict";

// mulberry32 — deterministic 32-bit PRNG
// Each game gets a master seed, each player derives seed+playerIndex

var SeededRNG = class SeededRNG {
  constructor(seed) {
    this.state = seed | 0;
  }

  random() {
    this.state |= 0;
    this.state = this.state + 0x6D2B79F5 | 0;
    var t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  randInt(min, max) {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = this.randInt(0, i);
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  pick(arr) {
    return arr[this.randInt(0, arr.length - 1)];
  }

  weightedPick(candidates, weightFn) {
    var totalWeight = 0;
    for (var i = 0; i < candidates.length; i++) {
      totalWeight += weightFn(candidates[i]);
    }
    if (totalWeight <= 0) return this.pick(candidates);
    var roll = this.random() * totalWeight;
    var cumulative = 0;
    for (var i = 0; i < candidates.length; i++) {
      cumulative += weightFn(candidates[i]);
      if (roll <= cumulative) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }
};
