"use strict";

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  globalShortcut,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { execSync, exec } = require("child_process");
const syncData = require("./sync-data");
const { GameStateTracker } = require("./log-parser");

// ── 路径常量 ──
const USER_DATA = app.getPath("userData");
const SETTINGS_PATH = path.join(USER_DATA, "settings.json");
const DATA_DIR = path.join(__dirname, "data");
const LOG_DIR = path.join(USER_DATA, "logs");
const SESSIONS_DIR = path.join(USER_DATA, "sessions");

// ── 全局状态 ──
let overlayWin = null;
let tray = null;
let settings = {};
let gameWindowRect = null;
let disconnectTimer = null;
let firewallBlocked = false;
let trackingInterval = null;
let logWatcher = null;
let windowHiddenByUser = false;
let gameTracker = null;

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: windowHiddenByUser ? "显示面板" : "隐藏面板",
      click: toggleWindowVisibility,
    },
    {
      label: "教练面板",
      click: () => {
        if (overlayWin) overlayWin.webContents.send("toggle-panel");
      },
    },
    {
      label: "拔线 (跳过动画)",
      click: () => triggerDisconnect(),
    },
    { type: "separator" },
    {
      label: "设置",
      click: () => {
        if (overlayWin) overlayWin.webContents.send("open-settings");
      },
    },
    { type: "separator" },
    {
      label: "关于 Bob教练",
      click: () => {
        if (overlayWin) overlayWin.webContents.send("open-about");
      },
    },
    {
      label: "退出",
      click: () => {
        cleanupFirewall();
        app.quit();
      },
    },
  ]);
}

function toggleWindowVisibility() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (windowHiddenByUser) {
    windowHiddenByUser = false;
    overlayWin.show();
    overlayWin.focus();
  } else {
    windowHiddenByUser = true;
    overlayWin.hide();
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function log(level, msg) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    fs.appendFileSync(path.join(LOG_DIR, "bob-coach.log"), line, "utf-8");
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// 设置管理
// ═══════════════════════════════════════════════════════════

function loadSettings() {
  const defaults = {
    agreementAccepted: false,
    mode: "",
    transparency: 0.85,
    tipOpacity: 0.3,
    disconnectShortcut: "F5",
    showDcBtn: true,
    dcShortcutScope: "always",
    cloudEnabled: false,
    language: "zh-CN",
    fontFamily: "default",
    fontSize: 13,
    firstRun: true,
  };
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      settings = { ...defaults, ...JSON.parse(raw) };
    } else {
      settings = { ...defaults };
    }
  } catch (e) {
    settings = { ...defaults };
    log("error", "Failed to load settings: " + e.message);
  }
}

function saveSettings() {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    log("error", "Failed to save settings: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 游戏窗口跟踪
// ═══════════════════════════════════════════════════════════

function getHearthstoneWindowRect() {
  try {
    // Write PowerShell script to temp file to avoid escaping issues
    const tmpFile = path.join(USER_DATA, "_hs_track.ps1");
    const psScript = [
      "$code = @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public class BCW32 {",
      '    [DllImport("user32.dll")]',
      "    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);",
      '    [DllImport("user32.dll")]',
      "    public static extern bool IsWindowVisible(IntPtr hWnd);",
      "    public struct RECT { public int Left, Top, Right, Bottom; }",
      "}",
      "'@",
      "Add-Type -TypeDefinition $code -ErrorAction Stop",
      "",
      '$procs = Get-Process -Name "Hearthstone" -ErrorAction SilentlyContinue',
      'if (-not $procs) { Write-Output "NOT_FOUND"; exit 2 }',
      "foreach ($p in $procs) {",
      "    if ($p.MainWindowHandle -ne 0) {",
      "        if ([BCW32]::IsWindowVisible($p.MainWindowHandle)) {",
      "            $r = New-Object BCW32+RECT",
      "            [BCW32]::GetWindowRect($p.MainWindowHandle, [ref]$r)",
      '            Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"',
      "            exit 0",
      "        }",
      "    }",
      "}",
      'Write-Output "NOT_VISIBLE"',
      "exit 1",
    ].join("\n");
    fs.writeFileSync(tmpFile, psScript, "utf-8");
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { timeout: 3000, windowsHide: true }
    )
      .toString()
      .trim();
    if (!out || out.includes("NOT_FOUND") || out.includes("NOT_VISIBLE")) return null;
    const parts = out.split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    return {
      left: parts[0],
      top: parts[1],
      width: parts[2] - parts[0],
      height: parts[3] - parts[1],
    };
  } catch {
    return null;
  }
}

function startWindowTracking() {
  const POLL_MS = 2000; // slower poll to avoid input lag

  function tick() {
    const rect = getHearthstoneWindowRect();
    if (overlayWin && !overlayWin.isDestroyed()) {
      if (rect) {
        if (
          !gameWindowRect ||
          Math.abs(rect.left - gameWindowRect.left) > 5 ||
          Math.abs(rect.top - gameWindowRect.top) > 5 ||
          Math.abs(rect.width - gameWindowRect.width) > 5 ||
          Math.abs(rect.height - gameWindowRect.height) > 5
        ) {
          gameWindowRect = rect;
          overlayWin.setBounds(rect);
          overlayWin.setIgnoreMouseEvents(true, { forward: true });
          overlayWin.webContents.send("window-moved", rect);
        }
        if (!windowHiddenByUser && !overlayWin.isVisible()) overlayWin.show();
        overlayWin.webContents.send("game-running", true);
      } else {
        // No game: compact interactive mode
        if (gameWindowRect) {
          overlayWin.setBounds({ x: 100, y: 100, width: 800, height: 480 });
          overlayWin.setIgnoreMouseEvents(false);
          gameWindowRect = null;
        }
        if (!windowHiddenByUser && !overlayWin.isVisible()) overlayWin.show();
        overlayWin.webContents.send("game-running", false);
      }
    }
  }

  tick();
  trackingInterval = setInterval(tick, POLL_MS);
}

// ═══════════════════════════════════════════════════════════
// 拔线功能（防火墙规则）
// ═══════════════════════════════════════════════════════════

const FW_RULE_OUT = "BobCoach_HS_Block_Out";
const FW_RULE_IN = "BobCoach_HS_Block_In";

function getHSExePath() {
  const candidates = [
    "C:\\Program Files (x86)\\Hearthstone\\Hearthstone.exe",
    "C:\\Program Files\\Hearthstone\\Hearthstone.exe",
    "D:\\Program Files (x86)\\Hearthstone\\Hearthstone.exe",
    "D:\\Program Files\\Hearthstone\\Hearthstone.exe",
    "E:\\Program Files (x86)\\Hearthstone\\Hearthstone.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // fallback: try to find from process
  try {
    const psOut = execSync(
      'powershell -NoProfile -Command "(Get-Process -Name Hearthstone -ErrorAction Stop).Path"',
      { timeout: 3000, windowsHide: true }
    )
      .toString()
      .trim();
    if (psOut && fs.existsSync(psOut)) return psOut;
  } catch (_) {}
  return "Hearthstone.exe"; // fallback: use name, netsh may resolve
}

function blockHearthstone() {
  try {
    const exePath = getHSExePath();
    execSync(
      `netsh advfirewall firewall add rule name="${FW_RULE_OUT}" dir=out program="${exePath}" action=block enable=yes`,
      { timeout: 5000, windowsHide: true }
    );
    execSync(
      `netsh advfirewall firewall add rule name="${FW_RULE_IN}" dir=in program="${exePath}" action=block enable=yes`,
      { timeout: 5000, windowsHide: true }
    );
    firewallBlocked = true;
    log("info", "Firewall rules added, HS blocked");
    return true;
  } catch (e) {
    log("error", "Failed to add firewall rules: " + e.message);
    return false;
  }
}

function unblockHearthstone() {
  try {
    execSync(
      `netsh advfirewall firewall delete rule name="${FW_RULE_OUT}"`,
      { timeout: 5000, windowsHide: true }
    );
  } catch (_) {}
  try {
    execSync(
      `netsh advfirewall firewall delete rule name="${FW_RULE_IN}"`,
      { timeout: 5000, windowsHide: true }
    );
  } catch (_) {}
  firewallBlocked = false;
  log("info", "Firewall rules removed, HS unblocked");
}

function triggerDisconnect() {
  if (firewallBlocked) return { status: "already_blocked" };

  // clear any leftover rules from previous runs
  unblockHearthstone();

  // clear any existing timer
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  const blocked = blockHearthstone();
  if (!blocked) return { status: "failed" };

  overlayWin.webContents.send("disconnect:state-changed", "disconnecting");

  // Auto-reconnect after 3 seconds
  disconnectTimer = setTimeout(() => {
    unblockHearthstone();
    disconnectTimer = null;
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("disconnect:state-changed", "online");
    }
  }, 3000);

  return { status: "disconnecting" };
}

function manualReconnect() {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  unblockHearthstone();
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("disconnect:state-changed", "online");
  }
  return { status: "online" };
}

function cleanupFirewall() {
  if (disconnectTimer) clearTimeout(disconnectTimer);
  unblockHearthstone();
}

// ═══════════════════════════════════════════════════════════
// 系统托盘
// ═══════════════════════════════════════════════════════════

function createTray() {
  // Create a simple 16x16 tray icon via data URL (green circle)
  const trayIcon = nativeImage.createFromDataURL(
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABhklEQVQ4y6WTzUrDQBSFv2T" +
    "SpGlJqzZu3Lhx48KNGzeC7+Ez+Ci+hC/hQ/gEPoJPIAiCgoiIP6U/Y9KMSe+9dyZjmqZWcb" +
    "EMJDOZ+ebcOXd+hMiiIn8QAJER+QyIGIAFwBuC4JkNQMYkIp8AEWxGEQUCGYh/AH8CF4Apv" +
    "osq8vQZQFqB0Doh6h1AEPQ/C24LQRAAUX8hCNCAJRkmDEe9RWZ7m1mcBUAwh1uB/tZmr/X+" +
    "eQBqMwKcCbAF1wNr2QDQ3m5tNmqrj4+7dVh3a3A8HqQGAQQLQV0EfLf8OLxzEFrn1BsBHIj" +
    "KbBhP+m5t77MYCOdgbGAMKAJ8n2Dxr3dBG+cSBMuAJ0C+OFwBSgCi2L3ZwDFvnQsRbAJLq" +
    "fhqG3hNnEUDSY7rMqCV8s8A8F+La7JIMpLk5A65p9H09QNA2h27HUGArQBdylEAaGUBmLB" +
    "gj3Ib2AIGKUC8FwRBO4BY5j4CloDpG2cygnF+SQrAnQAAAABJRU5ErkJggg=="
  );
  tray = new Tray(trayIcon);
  tray.setToolTip("Bob教练 - 酒馆战棋教学插件");

  tray.setContextMenu(buildTrayMenu());

  // double-click tray to toggle panel
  tray.on("double-click", () => {
    if (windowHiddenByUser) {
      toggleWindowVisibility(); // show first, then toggle panel
    }
    if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) {
      overlayWin.webContents.send("toggle-panel");
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 覆盖层窗口
// ═══════════════════════════════════════════════════════════

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    width: 800,
    height: 480,
    x: 100,
    y: 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlayWin.loadFile("overlay.html");

  // Default: interactive (compact mode). Only click-through when tracking game.
  overlayWin.setIgnoreMouseEvents(false);

  // Cleanup on close
  overlayWin.on("closed", () => {
    overlayWin = null;
  });

  log("info", "Overlay window created");
}

// ═══════════════════════════════════════════════════════════
// 游戏日志解析器（HDT / Hearthstone Power.log）
// ═══════════════════════════════════════════════════════════

let logWatchFile = null;
let logLastSize = 0;
let logWatchRetryTimer = null;

function findGameLogPaths() {
  const paths = [];

  // 1. Hearthstone Power.log (最可靠)
  const hsLogDirs = [
    path.join(app.getPath("appData"), "..", "Local", "Blizzard", "Hearthstone", "Logs"),
    path.join(app.getPath("home"), "AppData", "Local", "Blizzard", "Hearthstone", "Logs"),
    "C:\\Program Files (x86)\\Hearthstone\\Logs",
    "D:\\Program Files (x86)\\Hearthstone\\Logs",
  ];
  for (const p of hsLogDirs) {
    if (fs.existsSync(p)) {
      const powerLog = path.join(p, "Power.log");
      if (fs.existsSync(powerLog)) {
        paths.push({ path: powerLog, source: "hs" });
      }
    }
  }

  // 2. HDT 日志目录
  const hdtDirs = [
    path.join(app.getPath("appData"), "HearthstoneDeckTracker", "Logs"),
    path.join(app.getPath("appData"), "..", "Local", "HearthstoneDeckTracker", "Logs"),
    path.join(app.getPath("home"), "AppData", "Local", "HearthstoneDeckTracker", "Logs"),
  ];
  for (const p of hdtDirs) {
    if (fs.existsSync(p)) {
      const files = fs.readdirSync(p).filter((f) => f.endsWith(".log") || f.endsWith(".txt"));
      const sorted = files
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(p, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);
      const bgLog = sorted.find(
        (f) =>
          f.name.toLowerCase().includes("bg") ||
          f.name.toLowerCase().includes("battleground")
      );
      const powerLog = sorted.find((f) => f.name.toLowerCase().includes("power"));
      const target = bgLog || powerLog || sorted[0];
      if (target) {
        paths.push({ path: path.join(p, target.name), source: "hdt" });
      }
    }
  }

  return paths;
}

function startLogWatching() {
  // 初始化状态追踪器
  if (!gameTracker) {
    gameTracker = new GameStateTracker((state) => {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("game-state-update", state);
      }
      if (state.gameActive) {
        log("debug", `Game state: T${state.turn} P${state.gamePhase} G${state.gold}/${state.maxGold} T${state.tavernTier} H${state.health} board=${state.boardMinions.length} shop=${state.shopMinions.length}`);
      }
    });
  }

  const logPaths = findGameLogPaths();
  if (logPaths.length === 0) {
    log("info", "No game log found, will rely on demo mode");
    // 每 30 秒重试查找
    logWatchRetryTimer = setTimeout(() => startLogWatching(), 30000);
    return false;
  }

  // 优先 HS Power.log，其次 HDT
  const target = logPaths[0];
  log("info", `Watching log [${target.source}]: ${target.path}`);
  logWatchFile = target.path;

  try {
    logLastSize = fs.statSync(target.path).size;
  } catch (e) {
    log("error", "Cannot read log file size: " + e.message);
    logWatchRetryTimer = setTimeout(() => startLogWatching(), 30000);
    return false;
  }

  try {
    fs.watch(target.path, (eventType) => {
      if (eventType !== "change") return;
      try {
        const stats = fs.statSync(target.path);
        if (stats.size < logLastSize) {
          // 日志轮转（新对局）
          gameTracker.reset();
          logLastSize = 0;
        }
        if (stats.size <= logLastSize) return;

        const stream = fs.createReadStream(target.path, {
          start: logLastSize,
          end: stats.size,
          encoding: "utf-8",
        });
        let buffer = "";
        stream.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              gameTracker.processLine(line);
            } catch (e) {
              // 静默跳过解析错误
            }
          }
        });
        stream.on("end", () => {
          logLastSize = stats.size;
        });
        stream.on("error", (e) => {
          log("error", "Log stream error: " + e.message);
        });
      } catch (e) {
        // 文件可能被删除（对局结束），静默重试
      }
    });
  } catch (e) {
    log("error", "Failed to watch log file: " + e.message);
    logWatchRetryTimer = setTimeout(() => startLogWatching(), 30000);
    return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════
// IPC 处理器
// ═══════════════════════════════════════════════════════════

function registerIpcHandlers() {
  // Settings
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:set", (_event, key, value) => {
    settings[key] = value;
    saveSettings();
    if (key === "transparency" && overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setOpacity(value);
    }
    return settings;
  });

  // Disconnect
  ipcMain.handle("disconnect:trigger", () => triggerDisconnect());
  ipcMain.handle("disconnect:manual-reconnect", () => manualReconnect());

  // Data loading
  ipcMain.handle("data:load", (_event, name) => {
    try {
      const filePath = path.join(DATA_DIR, name + ".json");
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    } catch (e) {
      log("error", `Failed to load data ${name}: ${e.message}`);
      return null;
    }
  });

  // Decision recording (feedback loop)
  ipcMain.handle("recording:log-decision", (_event, entry) => {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      var line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(path.join(SESSIONS_DIR, "decisions.log"), line, "utf-8");
      return true;
    } catch (e) {
      log("error", "Failed to log decision: " + e.message);
      return false;
    }
  });

  // Game state (request current snapshot from renderer)
  ipcMain.handle("game-state:get", () => {
    if (!gameTracker) return null;
    return gameTracker.getOverlayState();
  });

  ipcMain.handle("game-state:reset", () => {
    if (gameTracker) {
      gameTracker.reset();
      return true;
    }
    return false;
  });

  // App control
  ipcMain.handle("app:quit", () => {
    cleanupFirewall();
    app.quit();
  });
  ipcMain.handle("app:hide-window", () => {
    if (overlayWin && !overlayWin.isDestroyed() && !windowHiddenByUser) {
      windowHiddenByUser = true;
      overlayWin.hide();
      if (tray) tray.setContextMenu(buildTrayMenu());
    }
    return { hidden: windowHiddenByUser };
  });

  // Log
  ipcMain.handle("log", (_event, level, msg) => {
    log(level, msg);
  });

  // keyboard shortcut
  ipcMain.handle("register-shortcut", (_event, key) => {
    try {
      globalShortcut.register(key, () => {
        triggerDisconnect();
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("unregister-shortcut", (_event, key) => {
    try {
      globalShortcut.unregister(key);
    } catch (_) {}
  });

  // interactive regions for click-through toggle
  ipcMain.handle("set-interactive", (_event, enable) => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setIgnoreMouseEvents(!enable, { forward: true });
    }
  });

  // Data sync
  ipcMain.handle("sync:check", async () => {
    const result = await syncData.checkForUpdates();
    return result;
  });

  ipcMain.handle("sync:apply", async (_event, sources) => {
    const result = await syncData.applyUpdates(sources);
    // Notify renderer to reload data
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("sync:applied", result);
    }
    return result;
  });

  ipcMain.handle("sync:status", () => {
    return syncData.getSyncStatus();
  });
}

// ═══════════════════════════════════════════════════════════
// 应用生命周期
// ═══════════════════════════════════════════════════════════

app.whenReady().then(() => {
  log("info", "Bob Coach starting...");
  loadSettings();

  // Clean up any leftover firewall rules from crash
  unblockHearthstone();

  registerIpcHandlers();
  createOverlayWindow();
  createTray();

  overlayWin.webContents.once("did-finish-load", () => {
    // Apply saved transparency
    overlayWin.setOpacity(settings.transparency || 0.7);

    // Start window tracking after renderer is ready
    startWindowTracking();

    // Try HDT log parsing
    const logFound = startLogWatching();
    log("info", `HDT log ${logFound ? "found" : "not found, demo mode available"}`);

    // Register disconnect shortcut
    if (settings.disconnectShortcut) {
      globalShortcut.register(settings.disconnectShortcut, () => {
        triggerDisconnect();
      });
    }

    // Auto-check data updates if last check was >= 7 days ago
    if (syncData.shouldAutoCheck()) {
      log("info", "Auto-checking data updates (7-day interval)...");
      syncData
        .checkForUpdates()
        .then((result) => {
          const keys = Object.keys(result.available);
          if (keys.length > 0) {
            log("info", `Updates available: ${keys.join(", ")}`);
            if (overlayWin && !overlayWin.isDestroyed()) {
              overlayWin.webContents.send("sync:update-available", result.available);
            }
          } else {
            log("info", "Data is up to date");
          }
        })
        .catch((e) => log("error", "Auto-check failed: " + e.message));
    }
  });
});

app.on("window-all-closed", () => {
  // Don't quit on window close — tray stays active
});

app.on("will-quit", () => {
  cleanupFirewall();
  globalShortcut.unregisterAll();
  if (trackingInterval) clearInterval(trackingInterval);
  if (logWatchRetryTimer) clearTimeout(logWatchRetryTimer);
  log("info", "Bob Coach stopped");
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (overlayWin) {
      if (overlayWin.isMinimized()) overlayWin.restore();
      overlayWin.show();
      overlayWin.focus();
    }
  });
}
