"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bobCoach", {
  // ── 设置 ──
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),

  // ── 拔线 ──
  triggerDisconnect: () => ipcRenderer.invoke("disconnect:trigger"),
  manualReconnect: () => ipcRenderer.invoke("disconnect:manual-reconnect"),

  // ── 数据加载 ──
  loadData: (name) => ipcRenderer.invoke("data:load", name),

  // ── 数据同步 ──
  checkSyncUpdates: () => ipcRenderer.invoke("sync:check"),
  applySyncUpdates: (sources) => ipcRenderer.invoke("sync:apply", sources),
  getSyncStatus: () => ipcRenderer.invoke("sync:status"),

  // ── 快捷键 ──
  registerShortcut: (key) => ipcRenderer.invoke("register-shortcut", key),
  unregisterShortcut: (key) => ipcRenderer.invoke("unregister-shortcut", key),

  // ── 交互区域 ──
  setInteractive: (enable) => ipcRenderer.invoke("set-interactive", enable),

  // ── 应用控制 ──
  quitApp: () => ipcRenderer.invoke("app:quit"),
  hideWindow: () => ipcRenderer.invoke("app:hide-window"),

  // ── 游戏状态 ──
  getGameState: () => ipcRenderer.invoke("game-state:get"),
  resetGameState: () => ipcRenderer.invoke("game-state:reset"),

  // ── 决策记录（反馈闭环） ──
  logDecision: (entry) => ipcRenderer.invoke("recording:log-decision", entry),

  // ── 用户数据 ──
  getUserProfile: () => ipcRenderer.invoke("user:get-profile"),
  updateUserProfile: (partial) => ipcRenderer.invoke("user:update-profile", partial),
  userRegister: (username, password, email) => ipcRenderer.invoke("user:register", username, password, email),
  userLogin: (username, password) => ipcRenderer.invoke("user:login", username, password),
  initAnonymous: () => ipcRenderer.invoke("user:init-anonymous"),
  userLogout: () => ipcRenderer.invoke("user:logout"),
  setPrivacyLevel: (level) => ipcRenderer.invoke("user:set-privacy", level),
  saveGameRecord: (record) => ipcRenderer.invoke("user:save-game-record", record),
  getGameRecords: (opts) => ipcRenderer.invoke("user:get-game-records", opts),
  getUserStats: () => ipcRenderer.invoke("user:get-stats"),
  exportUserData: () => ipcRenderer.invoke("user:export-data"),
  importUserData: (data) => ipcRenderer.invoke("user:import-data", data),
  deleteAllUserData: () => ipcRenderer.invoke("user:delete-all-data"),
  cloudRegister: (username, password, email) => ipcRenderer.invoke("user:cloud-register", username, password, email),
  cloudLogin: (username, password) => ipcRenderer.invoke("user:cloud-login", username, password),
  cloudSync: () => ipcRenderer.invoke("user:cloud-sync"),
  getApiEndpoints: () => ipcRenderer.invoke("user:api-endpoints"),
  getSyncQueueStatus: () => ipcRenderer.invoke("user:sync-queue-status"),

  // ── 日志 ──
  log: (level, msg) => ipcRenderer.invoke("log", level, msg),

  // ── 主进程事件监听 ──
  on: (channel, callback) => {
    const validChannels = [
      "window-moved",
      "disconnect:state-changed",
      "log-line",
      "toggle-panel",
      "open-settings",
      "open-about",
      "game-running",
      "game-state-update",
      "sync:update-available",
      "sync:applied",
    ];
    if (validChannels.includes(channel)) {
      const handler = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
    return () => {};
  },
});
