"use strict";

// ═══════════════════════════════════════════════════════════
// 上分特征同步管线
// ═══════════════════════════════════════════════════════════
//
// 双向数据流:
//   PUSH: 本地 CompactRecords → GitHub (yueyang9999/bob-coach-data)
//         - 按 MMR 分段写入 segment_data/tier_9000_plus.json 等
//         - 仅用户同意上传时执行
//
//   PULL: GitHub → 本地 data/playstyle/remote/
//         - 拉取高分段(9000+)聚合特征
//         - 拉取 meta.json 检查版本
//
//   BUILD: 用户特征 + 云端高分段特征 → 融合 → 上分策略
//
// 用法:
//   node scripts/sync_ranked_features.js --push --token <ghp_xxx>
//   node scripts/sync_ranked_features.js --pull
//   node scripts/sync_ranked_features.js --build           # 融合生成本地策略
//   node scripts/sync_ranked_features.js --full --token <ghp_xxx>  # 全流程

var fs = require("fs");
var path = require("path");

var base = path.join(__dirname, "..");

// ── 加载必要模块 ──
var vm = require("vm");
function loadModule(filename) {
  var code = fs.readFileSync(path.join(base, filename), "utf-8");
  code = code.replace(/"use strict";/g, "// strict off");
  vm.runInThisContext(code, { filename: filename });
}
loadModule("modules/PlaystyleFeatures.js");
loadModule("modules/FeatureStore.js");
loadModule("modules/FeatureFusion.js");
loadModule("modules/StrategyVersionManager.js");

// 注入 fs/path 到 FeatureStore（vm.runInThisContext 内无法直接访问 require）
FeatureStore.injectFS(require("fs"), require("path"));

// ═══════════════════════════════════════════════════════════
// Parse args
// ═══════════════════════════════════════════════════════════

function parseArgs() {
  var args = process.argv.slice(2);
  var config = {
    push: false, pull: false, build: false,
    token: null,
    repo: "yueyang9999/bob-coach-data",
    branch: "main",
    mmr: 9000,
    recordDir: path.join(base, "data", "game_records"),
  };
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--push") config.push = true;
    else if (args[i] === "--pull") config.pull = true;
    else if (args[i] === "--build") config.build = true;
    else if (args[i] === "--full") { config.push = true; config.pull = true; config.build = true; }
    else if (args[i] === "--token" && i + 1 < args.length) config.token = args[++i];
    else if (args[i] === "--mmr" && i + 1 < args.length) config.mmr = parseInt(args[++i], 10);
    else if (args[i] === "--repo" && i + 1 < args.length) config.repo = args[++i];
  }

  // 从环境变量/文件获取token
  if (!config.token) {
    config.token = process.env.GITHUB_TOKEN;
  }
  if (!config.token) {
    try {
      var tf = path.join(base, "data", "github_token.txt");
      if (fs.existsSync(tf)) config.token = fs.readFileSync(tf, "utf-8").trim();
    } catch(e) {}
  }
  return config;
}

// ═══════════════════════════════════════════════════════════
// PUSH: 上传本地 CompactRecords 到 GitHub
// ═══════════════════════════════════════════════════════════

function getMMRSegment(mmr) {
  if (mmr <= 6000) return "tier_0_6000";
  if (mmr <= 8999) return "tier_6001_8999";
  return "tier_9000_plus";
}

function pushRecords(config) {
  console.log("\n── PUSH: 上传本地对局记录 ──");

  var recordDir = config.recordDir;
  if (!fs.existsSync(recordDir)) {
    console.log("  无本地记录目录: " + recordDir);
    return;
  }

  var files = fs.readdirSync(recordDir).filter(function(f) { return f.endsWith(".json"); });
  if (files.length === 0) {
    console.log("  无待上传记录");
    return;
  }

  console.log("  找到 " + files.length + " 条本地记录");

  // 按 MMR 分段分组
  var segmented = {};
  for (var i = 0; i < files.length; i++) {
    var record = JSON.parse(fs.readFileSync(path.join(recordDir, files[i]), "utf-8"));
    var seg = record.seg_bucket || getMMRSegment(record.seg || 6000);
    if (!segmented[seg]) segmented[seg] = [];
    segmented[seg].push(record);
  }

  // 上传每个分段
  var token = config.token;
  var repoParts = config.repo.split("/");
  var owner = repoParts[0], repo = repoParts[1];

  for (var segKey in segmented) {
    var records = segmented[segKey];
    // 先尝试获取已有的分段数据
    var existing = fetchFromGitHub(owner, repo, "segment_data/" + segKey + ".json", token);
    var merged = existing ? existing : [];
    if (!Array.isArray(merged)) merged = [];

    // 合并新记录（去重 by ts+hero）
    var existingKeys = {};
    for (var e = 0; e < merged.length; e++) {
      var er = merged[e];
      existingKeys[(er.ts||"") + "_" + (er.hero||"")] = true;
    }
    var newCount = 0;
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      var key = (rec.ts || "") + "_" + (rec.hero || "");
      if (!existingKeys[key]) {
        merged.push(rec);
        newCount++;
      }
    }

    console.log("  [" + segKey + "] 新增 " + newCount + " 条 (总计 " + merged.length + " 条)");

    // 通过 GitHub API 上传
    var content = JSON.stringify(merged, null, 2);
    var apiUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/segment_data/" + segKey + ".json";
    uploadFile(apiUrl, content, "update: segment " + segKey + " (+" + newCount + " records)", token, config.branch);
  }
}

// ═══════════════════════════════════════════════════════════
// PULL: 拉取云端高分段数据到本地缓存
// ═══════════════════════════════════════════════════════════

function pullRemote(config) {
  console.log("\n── PULL: 拉取云端高分段数据 ──");

  var store = new FeatureStore();
  var repoParts = config.repo.split("/");
  var owner = repoParts[0], repo = repoParts[1];

  // 拉取 meta.json
  var meta = fetchFromGitHub(owner, repo, "meta.json");
  if (meta) {
    store.saveRemoteMeta(meta);
    console.log("  meta.json: v" + (meta.version || "?"));
  }

  // 拉取 9000+ 分段数据（上分模式核心依赖）
  var highMmrData = fetchFromGitHub(owner, repo, "universal_features/ranking_features.json");
  if (highMmrData) {
    store.saveRemoteCache("tier_9000_plus", highMmrData);
    var highBracket = highMmrData.brackets && highMmrData.brackets.tier_9000_plus;
    if (highBracket) {
      console.log("  tier_9000_plus: " + (highBracket.totalGames || 0) + " 局, 均排 " + (highBracket.avgPlacement || 0).toFixed(2));
    }
  } else {
    console.log("  [警告] 未获取到高分段数据");
  }

  // 拉取各分段聚合数据（可选）
  var segKeys = ["tier_0_6000", "tier_6001_8999", "tier_9000_plus"];
  for (var i = 0; i < segKeys.length; i++) {
    var segData = fetchFromGitHub(owner, repo, "segment_data/" + segKeys[i] + ".json");
    if (segData) {
      store.saveRemoteCache(segKeys[i], segData);
      console.log("  " + segKeys[i] + ": " + (Array.isArray(segData) ? segData.length + " 条记录" : "ok"));
    }
  }

  console.log("  本地缓存已更新: data/playstyle/remote/");
}

// ═══════════════════════════════════════════════════════════
// BUILD: 融合用户特征 + 云端特征 → 上分策略
// ═══════════════════════════════════════════════════════════

function buildRankedFeature(config) {
  console.log("\n── BUILD: 构建上分策略特征 ──");

  var store = new FeatureStore();

  // 1. 获取用户特征（最近20局或长期画像）
  var userFeature = FeatureFusion.extractPersonal(store);
  console.log("  用户特征: " + (userFeature.meta ? userFeature.meta.gameCount : "?") + " 局");

  // 2. 获取云端高分段特征
  var highMmrFeature = store.loadRemoteCache("tier_9000_plus");

  // 3. 融合
  var rankedFeature = FeatureFusion.extractRanked(store, highMmrFeature);
  console.log("  融合权重: 用户 " + ((rankedFeature.meta.userWeight || 0) * 100).toFixed(0) + "% / 高分段 " + ((1 - (rankedFeature.meta.userWeight || 0)) * 100).toFixed(0) + "%");

  // 4. 保存基线（首次）
  store.saveRankedBaseline(rankedFeature);

  // 5. 版本管理：尝试升级
  var svm = new StrategyVersionManager(store);
  svm.initialize(rankedFeature);

  // 如果已有当前版本，检查是否需要升级
  var current = store.loadRankedCurrent();
  if (current) {
    // 无模拟验证时的简化对比（仅对比元数据）
    var curMeta = current.meta || {};
    var newMeta = rankedFeature.meta || {};
    var placementDelta = (curMeta.avgPlacement || 5) - (newMeta.avgPlacement || 5);
    if (placementDelta > 0.05) {
      var result = svm.tryUpgrade(rankedFeature); // validator = null (跳过模拟验证)
      if (result && result.accepted) {
        console.log("  策略已升级: " + result.version);
      }
    } else {
      store.saveRankedCurrent(rankedFeature);
      console.log("  策略已更新（无显著变化）");
    }
  }

  // 6. 保存
  store.saveRankedCurrent(rankedFeature);
  var history = svm.getHistory();
  console.log("  版本历史: " + history.totalVersions + " 个版本");
  console.log("  当前版本: " + (history.currentVersion || "无"));
}

// ═══════════════════════════════════════════════════════════
// GitHub API 工具函数（同步版本，适用于脚本）
// ═══════════════════════════════════════════════════════════

function fetchFromGitHub(owner, repo, filePath) {
  var url = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/main/" + filePath;
  try {
    var https = require("https");
    var urlMod = require("url");
    var parsed = urlMod.parse(url);
    var result = null;
    var req = https.get({
      hostname: parsed.hostname,
      path: parsed.path,
      headers: { "User-Agent": "BobCoach/1.0" },
    }, function(resp) {
      if (resp.statusCode !== 200) return;
      var data = "";
      resp.on("data", function(chunk) { data += chunk; });
      resp.on("end", function() {
        try { result = JSON.parse(data); } catch(e) {}
      });
    });
    req.on("error", function() {});
    // 同步等待（简化处理）
    req.end();
    // 这里无法同步获取结果，用execSync curl
  } catch(e) {}
  return null;
}

// 实际使用 child_process 做同步HTTP请求
function fetchFromGitHubSync(owner, repo, filePath) {
  try {
    var cp = require("child_process");
    var url = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/main/" + filePath;
    var result = cp.execSync("curl -s \"" + url + "\"", { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
    if (!result) return null;
    try { return JSON.parse(result); } catch(e) { return null; }
  } catch(e) { return null; }
}

function uploadFile(apiUrl, content, message, token, branch) {
  try {
    var cp = require("child_process");
    var encoded = Buffer.from(content, "utf-8").toString("base64");

    // 先获取sha（如果文件存在）
    var sha = "";
    try {
      var getResult = cp.execSync(
        "curl -s -H \"Authorization: token " + token + "\" -H \"User-Agent: BobCoach/1.0\" \"" + apiUrl + "\"",
        { encoding: "utf-8", maxBuffer: 1024 * 1024 }
      );
      var getData = JSON.parse(getResult);
      sha = getData.sha || "";
    } catch(e) {}

    var body = JSON.stringify({
      message: message,
      content: encoded,
      branch: branch,
    });
    if (sha) {
      body = JSON.stringify({
        message: message,
        content: encoded,
        branch: branch,
        sha: sha,
      });
    }

    var cmd = "curl -s -X PUT -H \"Authorization: token " + token + "\" -H \"Content-Type: application/json\" -H \"User-Agent: BobCoach/1.0\" -d '" + body.replace(/'/g, "'\\''") + "' \"" + apiUrl + "\"";
    var result = cp.execSync(cmd, { encoding: "utf-8", maxBuffer: 1024 * 1024 });
    var resp = JSON.parse(result);
    if (resp.content) {
      console.log("    上传成功: " + (resp.content.path || "?"));
      return true;
    }
  } catch(e) {
    console.error("    上传失败: " + e.message);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

function main() {
  var config = parseArgs();

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  上分特征同步管线                         ║");
  console.log("╚══════════════════════════════════════════╝");

  if (config.push) {
    if (!config.token) {
      console.error("\n错误: PUSH需要GitHub Token (--token 或 GITHUB_TOKEN 环境变量)");
      console.error("跳过上传步骤");
    } else {
      pushRecords(config);
    }
  }

  if (config.pull) {
    // 用同步方法替代
    var store = new FeatureStore();
    var repoParts = config.repo.split("/");
    var owner = repoParts[0], repo = repoParts[1];

    console.log("\n── PULL: 拉取云端数据 ──");

    // meta
    var meta = fetchFromGitHubSync(owner, repo, "meta.json");
    if (meta) {
      store.saveRemoteMeta(meta);
      console.log("  meta.json: v" + (meta.version || "?"));
    } else {
      console.log("  meta.json: 未获取到（仓库可能为空）");
    }

    // universal features (包含MMR分段数据)
    var uf = fetchFromGitHubSync(owner, repo, "universal_features/ranking_features.json");
    if (uf) {
      store.saveRemoteCache("tier_9000_plus", uf);
      var hb = uf.brackets && uf.brackets.tier_9000_plus;
      if (hb) console.log("  高分段数据: " + (hb.totalGames || 0) + " 局");
    }

    // 各分段segment数据
    var segKeys = ["tier_0_6000", "tier_6001_8999", "tier_9000_plus"];
    for (var i = 0; i < segKeys.length; i++) {
      var sd = fetchFromGitHubSync(owner, repo, "segment_data/" + segKeys[i] + ".json");
      if (sd) {
        store.saveRemoteCache(segKeys[i], sd);
        console.log("  " + segKeys[i] + ": " + (Array.isArray(sd) ? sd.length + " 条记录" : "ok"));
      }
    }
  }

  if (config.build) {
    buildRankedFeature(config);
  }

  if (!config.push && !config.pull && !config.build) {
    console.log("\n用法:");
    console.log("  --push       上传本地记录到GitHub");
    console.log("  --pull       拉取云端数据到本地缓存");
    console.log("  --build      融合生成上分策略");
    console.log("  --full       完整管线 (push+pull+build)");
    console.log("  --token      指定GitHub Token");
    console.log("  --mmr N      指定玩家MMR (默认9000)");
  }
}

main();
