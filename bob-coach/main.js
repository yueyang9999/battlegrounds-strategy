"use strict";

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  globalShortcut,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { execSync, exec } = require("child_process");
const syncData = require("./sync-data");
const { GameStateTracker } = require("./log-parser");
const UserDataStore = require("./modules/UserDataStore");

// ── 路径常量 ──
const USER_DATA = app.getPath("userData");
const SETTINGS_PATH = path.join(USER_DATA, "settings.json");
const DATA_DIR = path.join(__dirname, "data");
const LOG_DIR = path.join(USER_DATA, "logs");
const SESSIONS_DIR = path.join(USER_DATA, "sessions");

// ── 全局状态 ──
let displayWin = null;   // 全屏展示窗口（永远穿透鼠标）
let controlWin = null;   // 右侧控制面板（捕获自身区域鼠标）
let tray = null;
let settings = {};
let gameWindowRect = null;
let disconnectTimer = null;
let firewallBlocked = false;
let trackingInterval = null;
let logWatcher = null;
let windowHiddenByUser = false;
let gameTracker = null;

// ═══════════════════════════════════════════════════════════
// 双窗口 IPC 广播
// ═══════════════════════════════════════════════════════════

function sendToBoth(channel, data) {
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.webContents.send(channel, data);
  }
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send(channel, data);
  }
}

// ═══════════════════════════════════════════════════════════
// 系统托盘
// ═══════════════════════════════════════════════════════════

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: windowHiddenByUser ? "显示面板" : "隐藏面板",
      click: toggleControlWindow,
    },
    {
      label: "教练面板",
      click: () => {
        if (controlWin && !controlWin.isDestroyed()) {
          controlWin.webContents.send("toggle-panel");
        }
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
        if (controlWin && !controlWin.isDestroyed()) {
          controlWin.webContents.send("open-settings");
        }
      },
    },
    { type: "separator" },
    {
      label: "关于 Bob教练",
      click: () => {
        if (controlWin && !controlWin.isDestroyed()) {
          controlWin.webContents.send("open-about");
        }
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

function toggleControlWindow() {
  if (!controlWin || controlWin.isDestroyed()) return;
  if (windowHiddenByUser) {
    windowHiddenByUser = false;
    controlWin.show();
  } else {
    windowHiddenByUser = true;
    controlWin.hide();
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
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

  tray.on("double-click", () => {
    if (windowHiddenByUser) {
      toggleControlWindow();
    }
    if (controlWin && !controlWin.isDestroyed() && controlWin.isVisible()) {
      controlWin.webContents.send("toggle-panel");
    }
  });
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

function getDpiScaleFactor(gameRect) {
  const allDisplays = screen.getAllDisplays();
  const cx = gameRect.x + gameRect.width / 2;
  const cy = gameRect.y + gameRect.height / 2;

  let matched = null;
  for (const d of allDisplays) {
    const sf = d.scaleFactor || 1;
    const physX = Math.round(d.bounds.x * sf);
    const physY = Math.round(d.bounds.y * sf);
    const physW = Math.round(d.bounds.width * sf);
    const physH = Math.round(d.bounds.height * sf);
    if (cx >= physX && cx < physX + physW && cy >= physY && cy < physY + physH) {
      matched = d;
      break;
    }
  }
  if (!matched) matched = screen.getPrimaryDisplay();

  const sf = matched.scaleFactor;
  if (sf <= 1) return 1;

  if (gameRect.width > matched.bounds.width * 1.1) {
    return sf;
  }
  return 1;
}

function getHearthstoneWindowRectAsync() {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });

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
        "            $null = [BCW32]::GetWindowRect($p.MainWindowHandle, [ref]$r)",
        '            Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"',
        "            exit 0",
        "        }",
        "    }",
        "}",
        'Write-Output "NOT_VISIBLE"',
        "exit 1",
      ].join("\n");

      fs.writeFileSync(tmpFile, psScript, "utf-8");

      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
        { timeout: 3000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            log("debug", "HS window detect failed: " + err.message);
            resolve(null);
            return;
          }

          const out = (stdout || "").trim();
          const lines = out.split(/\r?\n/);
          const dataLine = lines.find(l => /^-?\d+,-?\d+,-?\d+,-?\d+$/.test(l));
          if (dataLine) {
            const parts = dataLine.split(",").map(Number);
            if (parts.length === 4 && !parts.some(isNaN)) {
              let result = {
                x: parts[0],
                y: parts[1],
                width: parts[2] - parts[0],
                height: parts[3] - parts[1],
              };

              const dpiScale = getDpiScaleFactor(result);
              if (dpiScale > 1) {
                result.x = Math.round(result.x / dpiScale);
                result.y = Math.round(result.y / dpiScale);
                result.width = Math.round(result.width / dpiScale);
                result.height = Math.round(result.height / dpiScale);
              }

              log("debug", `HS window: ${result.x},${result.y} ${result.width}x${result.height}`);
              resolve(result);
              return;
            }
          }

          if (out && !out.includes("NOT_FOUND") && !out.includes("NOT_VISIBLE")) {
            log("debug", "HS window detect: unexpected output: " + out.substring(0, 100));
          }
          resolve(null);
        }
      );
    } catch (e) {
      log("debug", "HS window detect failed: " + e.message);
      resolve(null);
    }
  });
}

function isHearthstoneForegroundAsync() {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });
      const tmpFile = path.join(USER_DATA, "_hs_fg.ps1");
      const psScript = [
        "$code = @'",
        "using System;",
        "using System.Runtime.InteropServices;",
        "public class BCFG {",
        "    [DllImport(\"user32.dll\")]",
        "    public static extern IntPtr GetForegroundWindow();",
        "    [DllImport(\"user32.dll\")]",
        "    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);",
        "}",
        "'@",
        "Add-Type -TypeDefinition $code -ErrorAction Stop",
        "$fw = [BCFG]::GetForegroundWindow()",
        "if ($fw -eq [IntPtr]::Zero) { Write-Output 'false'; exit 0 }",
        "$pid = 0",
        "$null = [BCFG]::GetWindowThreadProcessId($fw, [ref]$pid)",
        '$hs = Get-Process -Name "Hearthstone" -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $pid }',
        "if ($hs) { Write-Output 'true' } else { Write-Output 'false' }",
      ].join("\n");

      fs.writeFileSync(tmpFile, psScript, "utf-8");

      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
        { timeout: 2000, windowsHide: true },
        (err, stdout) => {
          if (err) { resolve(false); return; }
          resolve((stdout || "").trim().toLowerCase() === "true");
        }
      );
    } catch (_) {
      resolve(false);
    }
  });
}

function startWindowTracking() {
  const POLL_MS = 2000;
  let running = true;

  async function poll() {
    if (!running) return;
    if (!displayWin || displayWin.isDestroyed()) return;

    try {
      const rect = await getHearthstoneWindowRectAsync();

      if (!running) return;
      if (!displayWin || displayWin.isDestroyed()) return;

      if (rect) {
        if (
          !gameWindowRect ||
          Math.abs(rect.x - gameWindowRect.x) > 5 ||
          Math.abs(rect.y - gameWindowRect.y) > 5 ||
          Math.abs(rect.width - gameWindowRect.width) > 5 ||
          Math.abs(rect.height - gameWindowRect.height) > 5
        ) {
          gameWindowRect = rect;
          displayWin.setBounds(rect);
          displayWin.webContents.send("window-moved", rect);

          // Control 窗口跟随游戏窗口右侧
          if (controlWin && !controlWin.isDestroyed()) {
            const cw = Math.min(320, Math.floor(rect.width * 0.25));
            controlWin.setBounds({
              x: rect.x + rect.width - cw, y: rect.y,
              width: cw, height: rect.height,
            });
            controlWin.moveTop();
          }
        }

        // 游戏检测到 → Control 窗口可交互且可见
        if (controlWin && !controlWin.isDestroyed()) {
          controlWin.setIgnoreMouseEvents(false);
          controlWin.setOpacity(settings.transparency || 0.7);
          controlWin.moveTop();
        }

        if (!windowHiddenByUser && !displayWin.isVisible()) displayWin.show();
        sendToBoth("game-running", true);
      } else {
        if (gameWindowRect) {
          gameWindowRect = null;
        }
        // 游戏未运行 → Control 窗口透明且穿透鼠标，不遮挡其他应用
        if (controlWin && !controlWin.isDestroyed()) {
          controlWin.setIgnoreMouseEvents(true, { forward: true });
        }
        if (!windowHiddenByUser && !displayWin.isVisible()) displayWin.show();
        sendToBoth("game-running", false);
      }
    } catch (_) {
      // 静默处理轮询异常
    }

    if (running) {
      trackingInterval = setTimeout(poll, POLL_MS);
    }
  }

  poll();

  return () => { running = false; };
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
  try {
    const psOut = execSync(
      'powershell -NoProfile -Command "(Get-Process -Name Hearthstone -ErrorAction Stop).Path"',
      { timeout: 3000, windowsHide: true }
    )
      .toString()
      .trim();
    if (psOut && fs.existsSync(psOut)) return psOut;
  } catch (_) {}
  return "Hearthstone.exe";
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

  // 清理之前的定时器
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  unblockHearthstone();

  // 通知前端开始拔线（视觉反馈立即生效）
  sendToBoth("disconnect:state-changed", "disconnecting");

  // 尝试 netsh 防火墙（需管理员权限）
  const blocked = blockHearthstone();

  disconnectTimer = setTimeout(() => {
    if (blocked) unblockHearthstone();
    disconnectTimer = null;
    sendToBoth("disconnect:state-changed", "online");
  }, 3000);

  return { status: "disconnecting", blocked };
}

function manualReconnect() {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  unblockHearthstone();
  sendToBoth("disconnect:state-changed", "online");
  return { status: "online" };
}

function cleanupFirewall() {
  if (disconnectTimer) clearTimeout(disconnectTimer);
  unblockHearthstone();
}

// ═══════════════════════════════════════════════════════════
// 双窗口创建
// ═══════════════════════════════════════════════════════════

function createWindows() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;
  const controlWidth = Math.min(320, Math.floor(width * 0.25));

  const sharedWebPrefs = {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };

  // ── Display Window：全屏，永久穿透鼠标 ──
  displayWin = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: { ...sharedWebPrefs, additionalArguments: ["--bob-mode=display"] },
  });
  displayWin.loadFile("overlay.html", { hash: "mode=display" });
  displayWin.setIgnoreMouseEvents(true, { forward: true });

  displayWin.on("closed", () => {
    displayWin = null;
  });

  // ── Control Panel Window：右侧固定，可交互 ──
  controlWin = new BrowserWindow({
    x: x + width - controlWidth,
    y,
    width: controlWidth,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: { ...sharedWebPrefs, additionalArguments: ["--bob-mode=control"] },
  });
  controlWin.loadFile("overlay.html", { hash: "mode=control" });
  controlWin.setIgnoreMouseEvents(false);

  // 初始定位在屏幕右侧（独立窗口，非父子关系避免透明窗口兼容问题）
  controlWin.setBounds({
    x: x + width - controlWidth, y,
    width: controlWidth, height,
  });
  controlWin.moveTop();

  controlWin.on("closed", () => {
    controlWin = null;
  });

  log("info", `Windows created: display ${width}x${height}, control ${controlWidth}x${height}`);
}

// ═══════════════════════════════════════════════════════════
// 游戏日志解析器（HDT / Hearthstone Power.log）
// ═══════════════════════════════════════════════════════════

let logWatchFile = null;
let logLastSize = 0;
let logWatchRetryTimer = null;

function findGameLogPaths() {
  const paths = [];

  // 优先：Hearthstone 原生 Power.log（由 log.config 开启）
  const hsLogDirs = [
    path.join(app.getPath("appData"), "..", "Local", "Blizzard", "Hearthstone", "Logs"),
    path.join(app.getPath("home"), "AppData", "Local", "Blizzard", "Hearthstone", "Logs"),
  ];
  // 也检查炉石安装目录下的 Logs
  const hsExe = getHSExePath();
  if (hsExe && hsExe !== "Hearthstone.exe") {
    const installLogsDir = path.join(path.dirname(hsExe), "Logs");
    if (!hsLogDirs.includes(installLogsDir)) hsLogDirs.push(installLogsDir);
  }

  for (const p of hsLogDirs) {
    try {
      if (fs.existsSync(p)) {
        const powerLog = path.join(p, "Power.log");
        if (fs.existsSync(powerLog)) {
          paths.push({ path: powerLog, source: "hs" });
        }
      }
    } catch (_) {}
  }

  // 兜底：HDT 目录下的 Power.log（HDT 可能会同步一份）
  const hdtDirs = [
    path.join(app.getPath("appData"), "HearthstoneDeckTracker", "Logs"),
    path.join(app.getPath("home"), "AppData", "Local", "HearthstoneDeckTracker", "Logs"),
  ];
  for (const p of hdtDirs) {
    try {
      if (fs.existsSync(p)) {
        const powerLog = path.join(p, "Power.log");
        if (fs.existsSync(powerLog)) {
          paths.push({ path: powerLog, source: "hdt" });
        }
        // 也检查 hdt_log.txt 中包含 "Power" 的区块（HDT 可能会内嵌）
        const hdtLog = path.join(p, "hdt_log.txt");
        if (fs.existsSync(hdtLog)) {
          // 快速检查是否含游戏数据（GameState 或 PowerTaskList 关键词）
          const sample = fs.readFileSync(hdtLog, "utf-8").substring(0, 5000);
          if (/PowerTaskList|GameState|TAG_CHANGE|FULL_ENTITY/i.test(sample)) {
            paths.push({ path: hdtLog, source: "hdt" });
          }
        }
      }
    } catch (_) {}
  }

  return paths;
}

function ensureHearthstoneLogging() {
  const logConfigDirs = [
    path.join(app.getPath("appData"), "..", "Local", "Blizzard", "Hearthstone"),
    path.join(app.getPath("home"), "AppData", "Local", "Blizzard", "Hearthstone"),
  ];
  for (const dir of logConfigDirs) {
    try {
      if (fs.existsSync(dir)) {
        const configPath = path.join(dir, "log.config");
        // 标准化 log.config：统一小写、移除 Verbose 等多余字段
        const correctContent = [
          "[Log]",
          "FileSizeLimit.MB=10",
          "",
          "[Power]",
          "LogLevel=1",
          "FilePrinting=true",
          "ConsolePrinting=false",
          "ScreenPrinting=false",
        ].join("\n");
        const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
        // 检查 [Power] 段是否已正确配置
        const hasPower = /\[Power\]/.test(existing);
        const hasFilePrinting = /\[Power\][\s\S]*?FilePrinting\s*=\s*true/i.test(existing);
        if (!hasPower || !hasFilePrinting) {
          fs.writeFileSync(configPath, correctContent, "utf-8");
          log("info", "Updated log.config at " + configPath);
        }
        // 确保 Logs 目录存在
        const logsDir = path.join(dir, "Logs");
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
          log("info", "Created Logs directory: " + logsDir);
        }
        return;
      }
    } catch (_) {}
  }
}

function startLogWatching() {
  if (!gameTracker) {
    gameTracker = new GameStateTracker((state) => {
      sendToBoth("game-state-update", state);
      if (state.gameActive) {
        log("debug", `Game state: T${state.turn} P${state.gamePhase} G${state.gold}/${state.maxGold} T${state.tavernTier} H${state.health} board=${state.boardMinions.length} shop=${state.shopMinions.length}`);
      }
    });
  }

  const logPaths = findGameLogPaths();
  if (logPaths.length === 0) {
    log("info", "No game log found, will rely on demo mode");
    logWatchRetryTimer = setTimeout(() => startLogWatching(), 30000);
    return false;
  }

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
    if (key === "transparency") {
      if (displayWin && !displayWin.isDestroyed()) displayWin.setOpacity(value);
      if (controlWin && !controlWin.isDestroyed()) controlWin.setOpacity(value);
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
    if (controlWin && !controlWin.isDestroyed() && !windowHiddenByUser) {
      windowHiddenByUser = true;
      controlWin.hide();
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
    if (!app.isReady()) return false;
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
    if (!app.isReady()) return;
    try {
      globalShortcut.unregister(key);
    } catch (_) {}
  });

  // Data sync
  ipcMain.handle("sync:check", async () => {
    const result = await syncData.checkForUpdates();
    return result;
  });

  ipcMain.handle("sync:apply", async (_event, sources) => {
    const result = await syncData.applyUpdates(sources);
    sendToBoth("sync:applied", result);
    return result;
  });

  ipcMain.handle("sync:status", () => {
    return syncData.getSyncStatus();
  });

  // ── 用户数据存储 ──
  ipcMain.handle("user:get-profile", () => UserDataStore.getProfile());
  ipcMain.handle("user:update-profile", (_event, partial) => UserDataStore.updateProfile(partial));
  ipcMain.handle("user:register", (_event, username, password, email) =>
    UserDataStore.registerLocal(username, password, email)
  );
  ipcMain.handle("user:login", (_event, username, password) =>
    UserDataStore.loginLocal(username, password)
  );
  ipcMain.handle("user:init-anonymous", () => UserDataStore.initAnonymous());
  ipcMain.handle("user:logout", () => UserDataStore.logout());
  ipcMain.handle("user:set-privacy", (_event, level) => UserDataStore.setPrivacyLevel(level));

  // 游戏记录
  ipcMain.handle("user:save-game-record", (_event, record) => UserDataStore.saveGameRecord(record));
  ipcMain.handle("user:get-game-records", (_event, opts) => UserDataStore.getGameRecords(opts));
  ipcMain.handle("user:get-stats", () => UserDataStore.getStats());

  // 数据导入导出
  ipcMain.handle("user:export-data", () => UserDataStore.exportAllData());
  ipcMain.handle("user:import-data", (_event, data) => UserDataStore.importData(data));
  ipcMain.handle("user:delete-all-data", () => UserDataStore.deleteAllData());

  // 云端 API (预留)
  ipcMain.handle("user:cloud-register", (_event, username, password, email) =>
    UserDataStore.cloudRegister(username, password, email)
  );
  ipcMain.handle("user:cloud-login", (_event, username, password) =>
    UserDataStore.cloudLogin(username, password)
  );
  ipcMain.handle("user:cloud-sync", () => UserDataStore.cloudSync());
  ipcMain.handle("user:api-endpoints", () => UserDataStore.getApiEndpoints());
  ipcMain.handle("user:sync-queue-status", () => UserDataStore.getSyncQueueStatus());
}

// ═══════════════════════════════════════════════════════════
// 应用生命周期
// ═══════════════════════════════════════════════════════════

app.whenReady().then(() => {
  log("info", "Bob Coach starting...");
  loadSettings();
  UserDataStore.init(USER_DATA);

  // Clean up any leftover firewall rules from crash
  unblockHearthstone();

  registerIpcHandlers();
  createWindows();
  createTray();

  // Both windows need to finish loading before we start tracking.
  // Wait for both 'did-finish-load' events.
  let displayReady = false;
  let controlReady = false;

  function onBothReady() {
    if (!displayReady || !controlReady) return;

    // Apply saved transparency
    const opacity = settings.transparency || 0.7;
    if (displayWin && !displayWin.isDestroyed()) displayWin.setOpacity(opacity);
    if (controlWin && !controlWin.isDestroyed()) controlWin.setOpacity(opacity);

    // IPC 确认模式（兜底，确保各窗口知道自己是谁）
    if (displayWin && !displayWin.isDestroyed()) displayWin.webContents.send("set-mode", "display");
    if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send("set-mode", "control");

    // 确保 Control 窗口在 Display 上方（Windows z-order 有时不按创建顺序）
    if (controlWin && !controlWin.isDestroyed()) controlWin.moveTop();

    // Start window tracking for display window
    displayWin._stopTracking = startWindowTracking();

    // 确保炉石日志输出已开启
    ensureHearthstoneLogging();

    // Try HDT log parsing
    const logFound = startLogWatching();
    log("info", `HDT log ${logFound ? "found" : "not found"}`);

    // Register disconnect shortcut
    if (app.isReady() && settings.disconnectShortcut) {
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
            sendToBoth("sync:update-available", result.available);
          } else {
            log("info", "Data is up to date");
          }
        })
        .catch((e) => log("error", "Auto-check failed: " + e.message));
    }
  }

  displayWin.webContents.once("did-finish-load", () => {
    displayReady = true;
    onBothReady();
  });
  controlWin.webContents.once("did-finish-load", () => {
    controlReady = true;
    onBothReady();
  });
});

app.on("window-all-closed", () => {
  // Don't quit on window close — tray stays active
});

app.on("will-quit", () => {
  cleanupFirewall();
  if (app.isReady()) globalShortcut.unregisterAll();
  if (trackingInterval) clearTimeout(trackingInterval);
  if (displayWin && displayWin._stopTracking) displayWin._stopTracking();
  if (logWatchRetryTimer) clearTimeout(logWatchRetryTimer);
  log("info", "Bob Coach stopped");
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (displayWin) {
      if (displayWin.isMinimized()) displayWin.restore();
      displayWin.show();
    }
    if (controlWin) {
      if (controlWin.isMinimized()) controlWin.restore();
      controlWin.show();
      controlWin.focus();
    }
  });
}
