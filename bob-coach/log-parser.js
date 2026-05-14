"use strict";

// ═══════════════════════════════════════════════════════════
// HDT 日志解析器 — 从 Power.log 事件追踪酒馆战棋对局状态
// ═══════════════════════════════════════════════════════════

/**
 * 追踪单局游戏状态。
 *
 * 输入：逐行的 HDT/Power.log 文本（TAG_CHANGE / CHOICES / FULL_ENTITY）
 * 输出：调用 onStateUpdate 回调，传递当前 overlay 需要的状态快照
 */

const BATTLEGROUNDS_STEP = {
  0: "begin",
  1: "begin_mulligan",
  2: "mulligan",
  4: "main_ready",
  5: "main_action",
  6: "main_action",  // 酒馆阶段
  7: "main_end",
  10: "combat",
};

class GameStateTracker {
  constructor(onStateUpdate) {
    this._onUpdate = onStateUpdate;
    this.reset();
  }

  reset() {
    this.playerId = null;
    this.playerEntityId = null;
    this.heroCardId = null;
    this.heroName = "";
    this.gold = 3;
    this.maxGold = 3;
    this.health = 30;
    this.maxHealth = 30;
    this.tavernTier = 1;
    this.turn = 1;
    this.step = 0;
    this.gamePhase = "shop";
    this.friendlyGame = false;
    this.entities = Object.create(null);
    this._shopEntityIds = [];
    this._lastStateHash = "";
    this._opponents = Object.create(null);  // { controllerId → { heroCardId, health, tavernTier, boardMinions[] } }
    this._lastCombatOpponents = [];          // snapshot from most recent combat
    this._heroCandidates = Object.create(null); // { entityId → { cardId, entityId, position } } 英雄选择阶段候选英雄
    this._isHeroSelection = false;
    this._trinketOffer = [];                     // [{ cardId, entityId }] 当前可选饰品
    this._trinketEntities = Object.create(null); // { entityId → { cardId, entityId } } 饰品实体缓存
    this.frozenShop = false;
    this.freeRefreshCount = 0;
    this.hpRefreshRemaining = 0;
    this._lastShopTurn = 0;
    this._lastShopKey = "";
  }

  // ── 公开 API ──

  /** 处理单行日志，返回 true 表示状态发生了有意义的变化 */
  processLine(rawLine) {
    if (!rawLine) return false;

    // 尝试 JSON
    if (typeof rawLine === "object") {
      return this._processJsonEvent(rawLine);
    }

    const line = rawLine.trim();
    if (!line) return false;

    // JSON 行
    if (line.startsWith("{")) {
      try {
        return this._processJsonEvent(JSON.parse(line));
      } catch (_) {
        return false;
      }
    }

    // HDT 文本格式
    const msg = this._extractMessage(line);
    if (!msg) return false;

    if (msg.startsWith("TAG_CHANGE")) {
      return this._processTagChange(msg);
    }
    if (msg.startsWith("CHOICES")) {
      return this._processChoices(msg);
    }
    if (msg.startsWith("FULL_ENTITY")) {
      return this._processFullEntity(msg);
    }
    if (msg.startsWith("CREATE_GAME")) {
      this.reset();
      return false;
    }
    if (msg.startsWith("GameEntity")) {
      // Game entity created — BG game starting
      return false;
    }

    return false;
  }

  /** 获取当前状态快照（供 overlay 使用） */
  getOverlayState() {
    return {
      heroCardId: this.heroCardId,
      heroName: this.heroName,
      gold: this.gold,
      maxGold: this.maxGold,
      tavernTier: this.tavernTier,
      health: this.health,
      maxHealth: this.maxHealth,
      turn: this.turn,
      gamePhase: this.gamePhase,
      gameActive: this.heroCardId !== null,
      isHeroSelection: this._isHeroSelection,
      heroOptions: this._isHeroSelection ? Object.values(this._heroCandidates) : [],
      heroSlotCount: this._computeHeroSlotCount(),
      boardMinions: this._getZoneEntities("PLAY", 7),
      handMinions: this._getZoneEntities("HAND", 10),
      shopMinions: this._getShopEntities(),
      opponents: this._getOpponentStates(),
      trinketOffer: this._trinketOffer.slice(),
      frozenShop: this.frozenShop,
      freeRefreshCount: this.freeRefreshCount,
      hpRefreshRemaining: this.hpRefreshRemaining,
    };
  }

  _getOpponentStates() {
    var result = [];
    var oppKeys = Object.keys(this._opponents);
    for (var i = 0; i < oppKeys.length; i++) {
      var key = oppKeys[i];
      var opp = this._opponents[key];
      if (!opp || !opp.heroCardId) continue;
      result.push({
        controller: opp.controller,
        heroCardId: opp.heroCardId,
        health: opp.health,
        tavernTier: opp.tavernTier,
        boardMinions: opp.boardMinions.slice(0, 7),
        alive: opp.alive,
      });
    }
    return result;
  }

  // ── 内部 ──

  _clearHeroSelection() {
    this._heroCandidates = Object.create(null);
    this._isHeroSelection = false;
  }

  _parseChoiceEntities(msg) {
    var entsMatch = msg.match(/\bentities=\[([^\]]*)\]/);
    if (!entsMatch) return [];
    return entsMatch[1]
      .split(",")
      .map(function(s) { return parseInt(s.trim(), 10); })
      .filter(function(n) { return !isNaN(n); });
  }

  _computeHeroSlotCount() {
    var cands = Object.values(this._heroCandidates);
    if (cands.length === 0) return 0;
    // 查找 positions 0 和 3: 如果都有候选 → 4选1, 否则 → 2选1
    var hasLeft = false, hasRight = false;
    for (var i = 0; i < cands.length; i++) {
      if (cands[i].position === 0) hasLeft = true;
      if (cands[i].position === 3) hasRight = true;
    }
    if (hasLeft && hasRight) return 4;
    return cands.length >= 3 ? 4 : 2;
  }

  _extractMessage(line) {
    // 去掉时间戳前缀 "D 00:00:00.0000000 " 或 "[Power] " 等
    const m = line.match(
      /(?:^[DIW]\s+[\d:.]+(?:\s+)?)?(?:\[Power\]\s*)?(.*)$/
    );
    return m ? m[1].trim() : line;
  }

  _extractEntityFields(msg) {
    // 从 "Entity=[...]" 块中提取 key=value 对
    const blockMatch = msg.match(/Entity=\[([^\]]*(?:\[[^\]]*\][^\]]*)*)\]/);
    const block = blockMatch ? blockMatch[1] : "";

    // 也从 Entity=NAME entity=[...] 变体中提取
    // 尝试直接从整行提取关键字段
    const extract = (re) => {
      const m = (block || msg).match(re);
      return m ? m[1] : null;
    };

    return {
      id: parseInt(extract(/\bid=(\d+)/)) || 0,
      cardId: extract(/\bcardId=([^\s\]]+)/),
      zone: extract(/\bzone=(\w+)/),
      zonePos: parseInt(extract(/\bzonePos=(\d+)/)) || 0,
      player: parseInt(extract(/\bplayer=(\d+)/)) || 0,
      cardType: extract(/\bcardType=(\w+)/),
    };
  }

  _processTagChange(msg) {
    const ef = this._extractEntityFields(msg);
    const tag = (msg.match(/\btag=(\w+)\b/) || [])[1];
    const rawVal = (msg.match(/\bvalue=([^\s\]]+)/) || [])[1];

    if (!ef.id || !tag) return false;

    const value = rawVal ? (isNaN(rawVal) ? rawVal : parseInt(rawVal, 10)) : null;
    if (value === null) return false;

    // 确保实体记录存在
    if (!this.entities[ef.id]) {
      this.entities[ef.id] = { id: ef.id, tags: Object.create(null) };
    }
    const ent = this.entities[ef.id];

    // 补充 cardId
    if (ef.cardId && !ent.cardId) {
      ent.cardId = ef.cardId;
      // 检测玩家英雄
      if (ef.cardId.startsWith("TB_BaconShop_HERO") && ef.player === 1) {
        this.playerId = ef.player;
        this.playerEntityId = ef.id;
        this.heroCardId = ef.cardId;
      }
    }
    if (ef.zone) ent.zone = ef.zone;
    if (ef.zonePos !== undefined && ef.zonePos > 0) ent.zonePos = ef.zonePos;
    if (ef.player) ent.controller = ef.player;

    // 记录 tag 值
    ent.tags[tag] = value;

    let changed = false;

    // ── 全局标签（针对玩家实体或游戏实体） ──
    // 假设 playerEntityId 对应的实体上的标签是我们的英雄状态
    // 有些标签可能在 gameEntity 上

    switch (tag) {
      // Player tags (may be on player entity or game entity)
      case "RESOURCES":
      case "NUM_RESOURCES": {
        // value is used + available, for BG it reflects current gold
        // Actually RESOURCES in BG = current gold
        const g = parseInt(value) || 0;
        if (g !== this.gold && g >= 0 && g <= 20) {
          this.gold = g;
          changed = true;
        }
        break;
      }
      case "RESOURCES_USED":
        // gold spent
        break;
      case "MAX_RESOURCES": {
        const mg = parseInt(value) || 0;
        if (mg !== this.maxGold && mg >= 3 && mg <= 20) {
          this.maxGold = mg;
          changed = true;
        }
        break;
      }

      // Tavern Tier (BG specific tag; map various names)
      case "TECH_LEVEL":
      case "PLAYER_TECH_LEVEL": {
        if (ef.player === 1 || ef.controller === 1) {
          const tier = parseInt(value) || 1;
          if (tier !== this.tavernTier && tier >= 1 && tier <= 7) {
            this.tavernTier = tier;
            changed = true;
          }
        }
        break;
      }

      // Health/Damage on hero entity
      case "HEALTH": {
        if (ef.id === this.playerEntityId) {
          const h = parseInt(value) || 0;
          if (h > 0 && h <= 200) {
            // HEALTH tag on hero = current health (or max health, depends on context)
            // In BG, HEALTH on player entity is max health, DAMAGE tracks damage taken
            // But DAMAGE uses different tag interpretation
            // We'll track both and health = maxHealth - damage
            this.maxHealth = h;
          }
        }
        break;
      }
      case "DAMAGE": {
        if (ef.id === this.playerEntityId) {
          const d = parseInt(value) || 0;
          const h = this.maxHealth - d;
          if (h !== this.health && h >= 0 && h <= 200) {
            this.health = h;
            changed = true;
          }
        }
        break;
      }

      // Step (game phase)
      case "STEP": {
        const step = parseInt(value) || 0;
        if (step !== this.step) {
          this.step = step;
          const phase = BATTLEGROUNDS_STEP[step];
          if (phase) {
            let newPhase = this.gamePhase;
            if (phase === "combat") newPhase = "combat";
            else if (step >= 4 && step <= 6) newPhase = "shop";
            else if (step === 7) newPhase = "recruit";
            if (newPhase !== this.gamePhase) {
              this.gamePhase = newPhase;
              changed = true;
            }
          }
        }
        break;
      }

      // Turn
      case "TURN":
      case "NUM_TURNS_IN_PLAY": {
        const t = parseInt(value) || 0;
        if (t !== this.turn && t >= 1 && t <= 30) {
          this.turn = t;
          changed = true;
        }
        break;
      }

      // Zone changes for minions
      case "ZONE": {
        ent.zone = value;
        // 英雄选择阶段: 候选英雄进入 PLAY → 玩家选择了该英雄
        if (value === "PLAY" && this._isHeroSelection && this._heroCandidates[ef.id]) {
          var chosen = this._heroCandidates[ef.id];
          this.playerEntityId = ef.id;
          this.heroCardId = chosen.cardId;
          this.playerId = 1;
          this._clearHeroSelection();
          changed = true;
        }
        // 免费刷新追踪: BGS_116 刷新畸体 进入我方场地
        if (value === "PLAY" && (ef.player === 1 || ef.controller === 1)) {
          if (ent.cardId === "BGS_116") {
            this.freeRefreshCount += 2;
          }
          if (ent.cardId === "BG26_524") {
            this.hpRefreshRemaining = 2;
          }
        }
        if (ef.player === 1 || ef.controller === 1) {
          changed = true;
        }
        // Track opponent board minions during combat
        if ((ef.player !== 1 || ef.controller !== 1) && value === "PLAY") {
          var oppCtrl = ef.player || ef.controller || 0;
          if (oppCtrl > 1) {
            this._trackOpponentMinion(oppCtrl, ef.id, ent);
          }
        }
        break;
      }
      case "ZONE_POSITION": {
        ent.zonePos = parseInt(value) || 0;
        // 更新英雄候选位置
        if (this._heroCandidates[ef.id]) {
          this._heroCandidates[ef.id].position = ent.zonePos;
        }
        if (ef.player === 1 || ef.controller === 1) {
          changed = true;
        }
        break;
      }

      // CARDTYPE detection for hero
      case "CARDTYPE": {
        if (value === "HERO" && ef.cardId && ef.cardId.startsWith("TB_BaconShop_HERO")) {
          var ctrl = ef.player || ef.controller || 0;
          if (ctrl === 1) {
            // 英雄选择阶段 (step ≤ 2): 追踪候选，不立即设置 heroCardId
            if (this.step <= 2 && !this.heroCardId) {
              this._heroCandidates[ef.id] = { cardId: ef.cardId, entityId: ef.id, position: ef.zonePos || 0 };
              if (Object.keys(this._heroCandidates).length >= 2) {
                this._isHeroSelection = true;
              }
              changed = true;
            } else {
              this.playerId = 1;
              this.playerEntityId = ef.id;
              this.heroCardId = ef.cardId;
              this._clearHeroSelection();
              changed = true;
            }
          } else if (ctrl > 1) {
            this._detectOpponentHero(ctrl, ef.cardId, ef.id);
            changed = true;
          }
        }
        break;
      }
    }

    // Debounce: only emit if state actually changed meaningfully
    if (changed) {
      return this._emitIfChanged();
    }
    return false;
  }

  _processFullEntity(msg) {
    // FULL_ENTITY - Creating ID=N CardID=XXX
    const idMatch = msg.match(/\bID=(\d+)/);
    const cardMatch = msg.match(/\bCardID=([^\s]+)/);
    if (!idMatch || !cardMatch) return false;

    const id = parseInt(idMatch[1], 10);
    const cardId = cardMatch[1];

    if (!this.entities[id]) {
      this.entities[id] = { id, tags: Object.create(null) };
    }
    this.entities[id].cardId = cardId;

    // 检测玩家英雄
    if (cardId.startsWith("TB_BaconShop_HERO")) {
      // 英雄选择阶段 (step ≤ 2): 追踪候选，不立即设置 heroCardId
      if (this.step <= 2 && !this.heroCardId) {
        this._heroCandidates[id] = { cardId: cardId, entityId: id, position: 0 };
        if (Object.keys(this._heroCandidates).length >= 2) {
          this._isHeroSelection = true;
        }
        return this._emitIfChanged();
      }
      this.playerEntityId = id;
      this.heroCardId = cardId;
      this.playerId = 1;
      this._clearHeroSelection();
      return this._emitIfChanged();
    }

    // 检测饰品实体 (MagicItem)
    if (cardId.indexOf("_MagicItem_") !== -1) {
      this._trinketEntities[id] = { cardId: cardId, entityId: id };
      return this._emitIfChanged();
    }

    return false;
  }

  // ── 对手追踪 ──

  _trackOpponentMinion(controller, entityId, ent) {
    if (!this._opponents[controller]) {
      this._opponents[controller] = {
        controller: controller,
        heroCardId: "",
        health: 30,
        tavernTier: 1,
        boardMinions: [],
        alive: true,
      };
    }
    var opp = this._opponents[controller];
    // Add/update minion in board snapshot
    var existingIdx = -1;
    for (var i = 0; i < opp.boardMinions.length; i++) {
      if (opp.boardMinions[i].entityId === entityId) {
        existingIdx = i;
        break;
      }
    }
    var minionData = {
      entityId: entityId,
      cardId: ent.cardId || "",
      attack: (ent.tags && ent.tags.ATK) || 0,
      health: (ent.tags && ent.tags.HEALTH) || 0,
      tier: (ent.tags && (ent.tags.CARDTECH_LEVEL || ent.tags.TECH_LEVEL)) || 1,
      position: ent.zonePos || 0,
    };
    if (existingIdx >= 0) {
      opp.boardMinions[existingIdx] = minionData;
    } else {
      opp.boardMinions.push(minionData);
    }
  }

  _detectOpponentHero(controller, cardId, entityId) {
    if (!cardId || !cardId.startsWith("TB_BaconShop_HERO")) return;
    if (controller <= 1) return;
    if (!this._opponents[controller]) {
      this._opponents[controller] = {
        controller: controller,
        heroCardId: "",
        health: 30,
        tavernTier: 1,
        boardMinions: [],
        alive: true,
      };
    }
    this._opponents[controller].heroCardId = cardId;
    this._opponents[controller].heroEntityId = entityId;
  }

  _processChoices(msg) {
    // CHOICES Entity=[...] id=1 PlayerId=1 TaskList=N CHOICE_TYPE=SHOP entities=[58,59,60,61]
    const choiceType = (msg.match(/\bCHOICE_TYPE=(\w+)/) || [])[1];

    // 饰品选择
    if (choiceType === "TRINKET" || choiceType === "TREASURE" || choiceType === "MAGIC_ITEM") {
      var trinketIds = this._parseChoiceEntities(msg);
      if (trinketIds.length >= 2) {
        this._trinketOffer = [];
        for (var ti = 0; ti < trinketIds.length; ti++) {
          var teid = trinketIds[ti];
          var tent = this.entities[teid];
          if (tent && tent.cardId && tent.cardId.indexOf("_MagicItem_") !== -1) {
            this._trinketOffer.push({ cardId: tent.cardId, entityId: teid });
          } else if (this._trinketEntities[teid]) {
            this._trinketOffer.push(this._trinketEntities[teid]);
          }
        }
        return this._emitIfChanged();
      }
    }

    // 英雄选择
    if (choiceType === "HERO") {
      var heroIds = this._parseChoiceEntities(msg);
      if (heroIds.length >= 2) {
        for (var i = 0; i < heroIds.length; i++) {
          var eid = heroIds[i];
          var ent = this.entities[eid];
          if (ent && ent.cardId && ent.cardId.startsWith("TB_BaconShop_HERO")) {
            this._heroCandidates[eid] = { cardId: ent.cardId, entityId: eid, position: ent.zonePos || 0 };
          }
        }
        if (Object.keys(this._heroCandidates).length >= 2) {
          this._isHeroSelection = true;
        }
        return this._emitIfChanged();
      }
    }

    if (choiceType !== "SHOP") return false;

    var ids = this._parseChoiceEntities(msg);
    if (ids.length === 0) return false;

    // 获取每个 shop entity 的 cardId
    var newShop = ids.map(function(eid) {
      const ent = this.entities[eid];
      return {
        cardId: ent ? ent.cardId || "" : "",
        entityId: eid,
        position: 0,
      };
    });

    // 过滤和去重
    const validShop = newShop.filter((s) => s.cardId);

    // 判断是否和上次相同
    const newShopKey = validShop.map((s) => s.entityId).join(",");

    // 冻结检测: 进入新回合但酒馆实体未变 → 玩家冻结了酒馆
    if (newShopKey === this._lastShopKey && this.turn > this._lastShopTurn) {
      this.frozenShop = true;
    } else {
      this.frozenShop = false;
    }

    if (newShopKey !== this._lastShopKey) {
      this._lastShopKey = newShopKey;
      this._lastShopTurn = this.turn;
      this._shopEntityIds = ids;
      // Store shop info on entities
      validShop.forEach((s, i) => {
        if (this.entities[s.entityId]) {
          this.entities[s.entityId].zone = "SHOP";
          this.entities[s.entityId].zonePos = i;
        }
      });
      return this._emitIfChanged();
    }

    return false;
  }

  _processJsonEvent(evt) {
    // Firestone JSON format: { type, entity, tag, value, ... }
    const type = evt.type || evt.event || "";
    switch (type) {
      case "TAG_CHANGE":
      case "tag_change":
        return this._processJsonTagChange(evt);
      case "CHOICES":
      case "choices":
        return this._processJsonChoices(evt);
      case "FULL_ENTITY":
      case "full_entity":
        return this._processJsonFullEntity(evt);
      default:
        return false;
    }
  }

  _processJsonTagChange(evt) {
    const eid = evt.entityId || evt.entity || 0;
    const tag = evt.tag || "";
    const value = evt.value;

    if (!eid || !tag) return false;

    if (!this.entities[eid]) {
      this.entities[eid] = { id: eid, tags: Object.create(null) };
    }
    const ent = this.entities[eid];

    if (evt.cardId && !ent.cardId) {
      ent.cardId = evt.cardId;
      if (evt.cardId.startsWith("TB_BaconShop_HERO") && evt.controller === 1) {
        this.playerEntityId = eid;
        this.heroCardId = evt.cardId;
      }
    }

    ent.tags[tag] = value;

    // 简化：直接触发标记
    return this._markDirty();
  }

  _processJsonChoices(evt) {
    if (evt.choiceType === "HERO") {
      var heroIds = evt.entities || evt.entityIds || [];
      if (Array.isArray(heroIds) && heroIds.length >= 2) {
        for (var i = 0; i < heroIds.length; i++) {
          var eid = heroIds[i];
          var ent = this.entities[eid];
          if (ent && ent.cardId && ent.cardId.startsWith("TB_BaconShop_HERO")) {
            this._heroCandidates[eid] = { cardId: ent.cardId, entityId: eid, position: ent.zonePos || 0 };
          }
        }
        if (Object.keys(this._heroCandidates).length >= 2) {
          this._isHeroSelection = true;
        }
        return this._emitIfChanged();
      }
    }
    if (evt.choiceType === "TRINKET" || evt.choiceType === "TREASURE" || evt.choiceType === "MAGIC_ITEM") {
      var tIds = evt.entities || evt.entityIds || [];
      if (Array.isArray(tIds) && tIds.length >= 2) {
        this._trinketOffer = [];
        for (var ti = 0; ti < tIds.length; ti++) {
          var tid = tIds[ti];
          var tent = this.entities[tid];
          if (tent && tent.cardId && tent.cardId.indexOf("_MagicItem_") !== -1) {
            this._trinketOffer.push({ cardId: tent.cardId, entityId: tid });
          } else if (this._trinketEntities[tid]) {
            this._trinketOffer.push(this._trinketEntities[tid]);
          }
        }
        return this._emitIfChanged();
      }
    }
    if (evt.choiceType !== "SHOP") return false;
    var ids = evt.entities || evt.entityIds || [];
    if (!Array.isArray(ids) || ids.length === 0) return false;
    this._shopEntityIds = ids;
    return this._emitIfChanged();
  }

  _processJsonFullEntity(evt) {
    const id = evt.entityId || evt.id || 0;
    const cardId = evt.cardId || "";
    if (!id || !cardId) return false;

    if (!this.entities[id]) {
      this.entities[id] = { id, tags: Object.create(null) };
    }
    this.entities[id].cardId = cardId;

    if (cardId.startsWith("TB_BaconShop_HERO")) {
      if (this.step <= 2 && !this.heroCardId) {
        this._heroCandidates[id] = { cardId: cardId, entityId: id, position: 0 };
        if (Object.keys(this._heroCandidates).length >= 2) {
          this._isHeroSelection = true;
        }
        return this._emitIfChanged();
      }
      this.playerEntityId = id;
      this.heroCardId = cardId;
      this._clearHeroSelection();
      return this._emitIfChanged();
    }

    // 检测饰品实体
    if (cardId.indexOf("_MagicItem_") !== -1) {
      this._trinketEntities[id] = { cardId: cardId, entityId: id };
      return this._emitIfChanged();
    }

    return false;
  }

  _markDirty() {
    // Simple dirty check
    this._dirty = true;
    return true;
  }

  // ── 状态提取 ──

  _getZoneEntities(zone, maxCount) {
    const result = [];
    const found = Object.create(null);

    for (const [id, ent] of Object.entries(this.entities)) {
      if (ent.zone !== zone) continue;
      if (ent.controller !== 1 && ent.controller !== undefined) continue;
      if (!ent.cardId) continue;
      // 排除非随从
      if (ent.tags && (ent.tags.CARDTYPE === "HERO" || ent.tags.CARDTYPE === "HERO_POWER" || ent.tags.CARDTYPE === "ENCHANTMENT")) continue;

      const pos = ent.zonePos || 0;
      const existing = found[pos];
      if (existing) {
        // Prefer entity with more info
        if (Object.keys(ent.tags || {}).length > Object.keys(existing.tags || {}).length) {
          found[pos] = ent;
        }
      } else {
        found[pos] = ent;
      }
    }

    // Also check tags for zone
    for (const [id, ent] of Object.entries(this.entities)) {
      if (!ent.tags) continue;
      const tagZone = ent.tags.ZONE;
      if (tagZone !== zone) continue;
      if (ent.controller !== 1 && ent.tags.CONTROLLER !== 1) continue;
      if (!ent.cardId) continue;
      if (ent.tags.CARDTYPE === "HERO" || ent.tags.CARDTYPE === "HERO_POWER") continue;

      const pos = ent.tags.ZONE_POSITION || ent.zonePos || 0;
      if (!found[pos] || !found[pos].cardId) {
        found[pos] = ent;
      }
    }

    for (let i = 0; i < maxCount; i++) {
      const ent = found[i];
      if (ent && ent.cardId) {
        result.push({
          cardId: ent.cardId,
          entityId: ent.id,
          position: i,
          attack: ent.tags ? ent.tags.ATK || 0 : 0,
          health: ent.tags ? ent.tags.HEALTH || 0 : 0,
          tier: ent.tags ? ent.tags.CARDTECH_LEVEL || ent.tags.TECH_LEVEL || 1 : 1,
          golden: ent.tags ? (ent.tags.PREMIUM || 0) >= 2 : false,
          tribes: ent.tags && ent.tags.CARDRACE ? [String(ent.tags.CARDRACE)] : [],
        });
      }
    }

    return result;
  }

  _getShopEntities() {
    const shop = [];
    for (let i = 0; i < this._shopEntityIds.length; i++) {
      const eid = this._shopEntityIds[i];
      const ent = this.entities[eid];
      if (ent && ent.cardId) {
        shop.push({
          cardId: ent.cardId,
          entityId: eid,
          position: i,
          tier: ent.tags ? ent.tags.CARDTECH_LEVEL || ent.tags.TECH_LEVEL || 1 : 1,
        });
      }
    }
    return shop;
  }

  _emitIfChanged() {
    const raw = JSON.stringify(this.getOverlayState());
    if (raw === this._lastStateHash) return false;
    this._lastStateHash = raw;
    if (this._onUpdate) {
      this._onUpdate(this.getOverlayState());
    }
    return true;
  }
}

module.exports = { GameStateTracker };
