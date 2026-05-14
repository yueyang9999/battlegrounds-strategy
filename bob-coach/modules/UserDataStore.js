"use strict";

// ═══════════════════════════════════════════════════════════
// UserDataStore — 本地用户数据库 + 云端 API 预留接口
// ═══════════════════════════════════════════════════════════
//
// 设计原则:
//   1. 本地优先 — 核心功能离线可用，云端为可选增强
//   2. 三级隐私 — L0纯本地 / L1匿名统计 / L2完整同步
//   3. 用户数据主权 — 可导出、可删除、可切换模式
//
// 云端 API (预留，当前返回 501):
//   POST   /api/auth/register     注册账号
//   POST   /api/auth/login        登录获取 JWT
//   POST   /api/auth/refresh      刷新 token
//   GET    /api/user/profile      获取用户档案
//   PUT    /api/user/profile      更新用户档案
//   POST   /api/user/games        上传游戏记录
//   GET    /api/user/games        下载游戏记录
//   DELETE /api/user/games/:id    删除游戏记录
//   GET    /api/user/stats        获取聚合统计
//   POST   /api/user/sync         全量同步（推/拉）

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// ── 常量 ──
const CLOUD_API_BASE = "https://api.bob-coach.example.com/v1"; // 预留，待后端部署后替换
const TOKEN_REFRESH_MARGIN = 300; // token 过期前5分钟刷新

// ── 数据库路径 (由 main.js 注入) ──
let _dbPath = null;
let _cache = null; // 内存缓存

/**
 * 初始化数据存储，传入用户数据目录路径
 */
function init(userDataPath) {
  _dbPath = path.join(userDataPath, "user_data.json");
  _cache = _loadFromDisk();
  return _cache;
}

/**
 * 获取当前用户档案
 */
function getProfile() {
  return _ensureCache().user_profile;
}

/**
 * 更新用户档案
 */
function updateProfile(partial) {
  var db = _ensureCache();
  Object.assign(db.user_profile, partial);
  db.user_profile.updatedAt = new Date().toISOString();
  _saveToDisk(db);
  return db.user_profile;
}

/**
 * 注册/创建本地账号
 * @param {string} username
 * @param {string} password - 明文密码，本地 SHA-256 哈希后存储
 * @param {string} [email]
 */
function registerLocal(username, password, email) {
  var db = _ensureCache();
  if (db.user_profile.accountType === "registered") {
    return { error: "账号已存在，请登录或先注销当前账号" };
  }

  var salt = crypto.randomBytes(16).toString("hex");
  var hash = _hashPassword(password, salt);
  var userId = "u_" + crypto.randomBytes(12).toString("hex");

  db.user_profile = {
    userId: userId,
    username: username,
    email: email || "",
    accountType: "registered",
    privacyLevel: "anonymous_stats",
    passwordHash: hash,
    passwordSalt: salt,
    token: null,
    tokenExpiresAt: null,
    refreshToken: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    stats: db.user_profile.stats || _emptyStats(),
  };

  _saveToDisk(db);
  return { userId: userId, username: username, accountType: "registered" };
}

/**
 * 本地登录验证
 * @returns {object} { userId, username, token } 或 { error }
 */
function loginLocal(username, password) {
  var db = _ensureCache();
  var profile = db.user_profile;

  if (profile.accountType !== "registered") {
    return { error: "未注册账号，请先注册" };
  }
  if (profile.username !== username) {
    return { error: "用户名不存在" };
  }
  var hash = _hashPassword(password, profile.passwordSalt);
  if (hash !== profile.passwordHash) {
    return { error: "密码错误" };
  }

  profile.lastLoginAt = new Date().toISOString();
  // 生成本地 session token (JWT 格式的简化版，实际 JWT 由服务端签发)
  profile.localToken = "local_" + crypto.randomBytes(24).toString("hex");
  _saveToDisk(db);

  return {
    userId: profile.userId,
    username: profile.username,
    token: profile.localToken,
    accountType: "registered",
  };
}

/**
 * 匿名模式 — 无需注册即可使用本地功能
 */
function initAnonymous() {
  var db = _ensureCache();
  if (db.user_profile.accountType !== "anonymous") {
    db.user_profile = {
      userId: "anon_" + crypto.randomBytes(10).toString("hex"),
      username: "匿名玩家",
      email: "",
      accountType: "anonymous",
      privacyLevel: "local",
      localToken: "anon_" + crypto.randomBytes(18).toString("hex"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      stats: _emptyStats(),
    };
    _saveToDisk(db);
  }
  return db.user_profile;
}

/**
 * 注销账号 — 清除本地账号信息，恢复到匿名状态
 */
function logout() {
  var db = _ensureCache();
  // 保留游戏记录但移除账号绑定
  db.user_profile = {
    userId: "anon_" + crypto.randomBytes(10).toString("hex"),
    username: "匿名玩家",
    email: "",
    accountType: "anonymous",
    privacyLevel: "local",
    localToken: "anon_" + crypto.randomBytes(18).toString("hex"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    stats: db.user_profile.stats || _emptyStats(),
  };
  db.sync_queue = [];
  _saveToDisk(db);
  return db.user_profile;
}

/**
 * 设置隐私级别
 * @param {"local"|"anonymous_stats"|"full_sync"} level
 */
function setPrivacyLevel(level) {
  var valid = ["local", "anonymous_stats", "full_sync"];
  if (valid.indexOf(level) === -1) return { error: "无效的隐私级别: " + level };
  return updateProfile({ privacyLevel: level });
}

// ── 游戏记录 ──

/**
 * 保存一条游戏记录
 */
function saveGameRecord(record) {
  var db = _ensureCache();
  var entry = {
    id: "gr_" + crypto.randomBytes(8).toString("hex"),
    timestamp: new Date().toISOString(),
    heroCardId: record.heroCardId || "",
    heroName: record.heroName || "",
    finalPlacement: record.finalPlacement || 0,
    turns: record.turns || 0,
    tavernTier: record.tavernTier || 1,
    compId: record.compId || "",
    compName: record.compName || "",
    decisions: record.decisions || [],
    tags: record.tags || [],
    gameVersion: record.gameVersion || "",
  };
  db.game_records.push(entry);

  // 更新统计
  _updateStats(db, entry);

  // 加入同步队列（如果非纯本地模式）
  if (db.user_profile.privacyLevel !== "local") {
    db.sync_queue.push({
      id: "sq_" + crypto.randomBytes(6).toString("hex"),
      type: "game_record",
      data: db.user_profile.privacyLevel === "anonymous_stats"
        ? _anonymizeRecord(entry) // 匿名模式：剥离个人标识
        : entry,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  }

  _saveToDisk(db);
  return entry;
}

/**
 * 获取游戏记录列表
 */
function getGameRecords(opts) {
  var db = _ensureCache();
  opts = opts || {};
  var limit = opts.limit || 50;
  var offset = opts.offset || 0;
  var records = db.game_records.slice().reverse(); // 最新在前
  if (opts.heroCardId) {
    records = records.filter(function(r) { return r.heroCardId === opts.heroCardId; });
  }
  return records.slice(offset, offset + limit);
}

/**
 * 获取用户统计数据
 */
function getStats() {
  var db = _ensureCache();
  return db.user_profile.stats || _emptyStats();
}

/**
 * 导出全部本地数据 (JSON)
 */
function exportAllData() {
  var db = _ensureCache();
  // 不导出密码哈希
  var exportData = JSON.parse(JSON.stringify(db));
  delete exportData.user_profile.passwordHash;
  delete exportData.user_profile.passwordSalt;
  delete exportData.user_profile.token;
  delete exportData.user_profile.refreshToken;
  delete exportData.user_profile.localToken;
  return exportData;
}

/**
 * 导入数据（合并游戏记录）
 */
function importData(jsonData) {
  var db = _ensureCache();
  if (!jsonData || !jsonData.game_records) {
    return { error: "无效的导入数据" };
  }
  var existingIds = {};
  for (var i = 0; i < db.game_records.length; i++) {
    existingIds[db.game_records[i].id] = true;
  }
  var imported = 0;
  for (var j = 0; j < jsonData.game_records.length; j++) {
    var rec = jsonData.game_records[j];
    if (!existingIds[rec.id]) {
      db.game_records.push(rec);
      _updateStats(db, rec);
      imported++;
    }
  }
  _saveToDisk(db);
  return { importedCount: imported };
}

/**
 * 删除所有本地数据（危险操作）
 */
function deleteAllData() {
  var db = _ensureCache();
  var stats = db.user_profile.stats || _emptyStats();
  db.game_records = [];
  db.sync_queue = [];
  db.user_profile.stats = _emptyStats();
  _saveToDisk(db);
  return true;
}

// ── 云端 API 预留接口 ──

/**
 * 云端注册 — 预留接口
 * 当前返回 501 (未实现)，后端就绪后对接
 */
async function cloudRegister(username, password, email) {
  return _cloudNotImplemented("POST /api/auth/register");
}

async function cloudLogin(username, password) {
  return _cloudNotImplemented("POST /api/auth/login");
}

async function cloudRefreshToken(refreshToken) {
  return _cloudNotImplemented("POST /api/auth/refresh");
}

async function cloudUploadGames(games) {
  return _cloudNotImplemented("POST /api/user/games");
}

async function cloudDownloadGames(since) {
  return _cloudNotImplemented("GET /api/user/games");
}

async function cloudSync() {
  return _cloudNotImplemented("POST /api/user/sync");
}

async function cloudGetProfile() {
  return _cloudNotImplemented("GET /api/user/profile");
}

async function cloudUpdateProfile(partial) {
  return _cloudNotImplemented("PUT /api/user/profile");
}

async function cloudGetStats() {
  return _cloudNotImplemented("GET /api/user/stats");
}

/**
 * 返回云端 API 端点列表（供设置面板展示）
 */
function getApiEndpoints() {
  return [
    { method: "POST", path: "/api/auth/register", desc: "注册账号", status: "reserved" },
    { method: "POST", path: "/api/auth/login", desc: "登录获取JWT", status: "reserved" },
    { method: "POST", path: "/api/auth/refresh", desc: "刷新Token", status: "reserved" },
    { method: "GET", path: "/api/user/profile", desc: "获取用户档案", status: "reserved" },
    { method: "PUT", path: "/api/user/profile", desc: "更新用户档案", status: "reserved" },
    { method: "POST", path: "/api/user/games", desc: "上传游戏记录", status: "reserved" },
    { method: "GET", path: "/api/user/games", desc: "下载游戏记录", status: "reserved" },
    { method: "DELETE", path: "/api/user/games/:id", desc: "删除游戏记录", status: "reserved" },
    { method: "GET", path: "/api/user/stats", desc: "获取聚合统计", status: "reserved" },
    { method: "POST", path: "/api/user/sync", desc: "全量数据同步", status: "reserved" },
  ];
}

/**
 * 获取同步队列状态
 */
function getSyncQueueStatus() {
  var db = _ensureCache();
  var queue = db.sync_queue || [];
  var pending = 0, synced = 0, failed = 0;
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].status === "pending") pending++;
    else if (queue[i].status === "synced") synced++;
    else if (queue[i].status === "failed") failed++;
  }
  return {
    total: queue.length,
    pending: pending,
    synced: synced,
    failed: failed,
    privacyLevel: db.user_profile.privacyLevel,
  };
}

// ═══════════════════════════════════════════
// 内部辅助函数
// ═══════════════════════════════════════════

function _ensureCache() {
  if (!_cache) {
    _cache = _loadFromDisk();
  }
  return _cache;
}

function _loadFromDisk() {
  if (!_dbPath) {
    // 未初始化时的兜底
    return _emptyDB();
  }
  try {
    if (fs.existsSync(_dbPath)) {
      var raw = fs.readFileSync(_dbPath, "utf-8");
      var data = JSON.parse(raw);
      return _validateAndRepair(data);
    }
  } catch (e) {
    // 文件损坏时创建新库
  }
  return _emptyDB();
}

function _saveToDisk(db) {
  _cache = db;
  if (!_dbPath) return;
  try {
    var dir = path.dirname(_dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 原子写入：先写临时文件，再重命名
    var tmpPath = _dbPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf-8");
    fs.renameSync(tmpPath, _dbPath);
  } catch (e) {
    // 静默失败，数据不丢失（内存中仍有 _cache）
  }
}

function _emptyDB() {
  return {
    user_profile: {
      userId: "",
      username: "匿名玩家",
      email: "",
      accountType: "anonymous",
      privacyLevel: "local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      stats: _emptyStats(),
    },
    game_records: [],
    sync_queue: [],
  };
}

function _emptyStats() {
  return {
    totalGames: 0,
    top4Count: 0,
    firstPlaceCount: 0,
    avgPlacement: 0,
    avgTurns: 0,
    favoriteHeroes: {}, // { heroCardId: count }
  };
}

function _validateAndRepair(data) {
  if (!data.user_profile) data.user_profile = _emptyDB().user_profile;
  if (!Array.isArray(data.game_records)) data.game_records = [];
  if (!Array.isArray(data.sync_queue)) data.sync_queue = [];
  if (!data.user_profile.stats) data.user_profile.stats = _emptyStats();
  if (!data.user_profile.privacyLevel) data.user_profile.privacyLevel = "local";
  if (!data.user_profile.accountType) data.user_profile.accountType = "anonymous";
  return data;
}

function _hashPassword(password, salt) {
  return crypto.createHash("sha256").update(salt + password + salt).digest("hex");
}

function _updateStats(db, record) {
  var stats = db.user_profile.stats;
  stats.totalGames = (stats.totalGames || 0) + 1;
  if (record.finalPlacement <= 4 && record.finalPlacement > 0) {
    stats.top4Count = (stats.top4Count || 0) + 1;
  }
  if (record.finalPlacement === 1) {
    stats.firstPlaceCount = (stats.firstPlaceCount || 0) + 1;
  }
  if (record.finalPlacement > 0) {
    var prevTotal = stats.totalGames - 1;
    var prevSum = (stats.avgPlacement || 0) * prevTotal;
    stats.avgPlacement = Math.round(((prevSum + record.finalPlacement) / stats.totalGames) * 100) / 100;
  }
  if (record.turns > 0) {
    var prevT = stats.totalGames - 1;
    var prevTSum = (stats.avgTurns || 0) * prevT;
    stats.avgTurns = Math.round(((prevTSum + record.turns) / stats.totalGames) * 10) / 10;
  }
  if (record.heroCardId) {
    stats.favoriteHeroes = stats.favoriteHeroes || {};
    stats.favoriteHeroes[record.heroCardId] = (stats.favoriteHeroes[record.heroCardId] || 0) + 1;
  }
}

function _anonymizeRecord(record) {
  // 剥离个人标识，仅保留游戏特征数据
  return {
    heroCardId: record.heroCardId,
    finalPlacement: record.finalPlacement,
    turns: record.turns,
    tavernTier: record.tavernTier,
    compId: record.compId,
    gameVersion: record.gameVersion,
    // 不含 userId、timestamp 等个人标识
  };
}

function _cloudNotImplemented(endpoint) {
  return {
    error: "CLOUD_NOT_AVAILABLE",
    message: "云端服务暂未部署。端点 " + endpoint + " 已预留，后端就绪后将自动启用。",
    endpoint: endpoint,
    status: 501,
  };
}

// ── 导出 ──
module.exports = {
  init: init,
  // 账号管理
  getProfile: getProfile,
  updateProfile: updateProfile,
  registerLocal: registerLocal,
  loginLocal: loginLocal,
  initAnonymous: initAnonymous,
  logout: logout,
  setPrivacyLevel: setPrivacyLevel,
  // 游戏记录
  saveGameRecord: saveGameRecord,
  getGameRecords: getGameRecords,
  getStats: getStats,
  // 数据导入导出
  exportAllData: exportAllData,
  importData: importData,
  deleteAllData: deleteAllData,
  // 云端 API (预留)
  cloudRegister: cloudRegister,
  cloudLogin: cloudLogin,
  cloudRefreshToken: cloudRefreshToken,
  cloudUploadGames: cloudUploadGames,
  cloudDownloadGames: cloudDownloadGames,
  cloudSync: cloudSync,
  cloudGetProfile: cloudGetProfile,
  cloudUpdateProfile: cloudUpdateProfile,
  cloudGetStats: cloudGetStats,
  getApiEndpoints: getApiEndpoints,
  getSyncQueueStatus: getSyncQueueStatus,
  // 常量
  CLOUD_API_BASE: CLOUD_API_BASE,
};
