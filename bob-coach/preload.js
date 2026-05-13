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
