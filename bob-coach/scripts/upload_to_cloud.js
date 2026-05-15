"use strict";

// ═══════════════════════════════════════════════════════════
// 云端数据上传管道
// ═══════════════════════════════════════════════════════════
//
// 将本地数据产出推送到 yueyang9999/bob-coach-data.
// 使用 GitHub Contents API，需要 Personal Access Token (repo scope).
//
// Token 来源（优先级）:
//   1. --token <token> 命令行参数
//   2. GITHUB_TOKEN 环境变量
//   3. data/github_token.txt (本地文件, .gitignored)
//
// 用法:
//   node scripts/upload_to_cloud.js --token <ghp_xxx>
//   node scripts/upload_to_cloud.js --all              # 上传所有数据
//   node scripts/upload_to_cloud.js --playstyle        # 仅上传玩法画像
//   node scripts/upload_to_cloud.js --universal        # 仅上传通用特征

var fs = require("fs");
var path = require("path");

var base = path.join(__dirname, "..");

// ═══════════════════════════════════════════════════════════
// Token 获取
// ═══════════════════════════════════════════════════════════

function getToken(args) {
  var tokenIdx = args.indexOf("--token");
  if (tokenIdx !== -1 && tokenIdx + 1 < args.length) {
    return args[tokenIdx + 1];
  }
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    var tokenFile = path.join(base, "data", "github_token.txt");
    if (fs.existsSync(tokenFile)) {
      return fs.readFileSync(tokenFile, "utf-8").trim();
    }
  } catch (e) {}
  return null;
}

function parseArgs() {
  var args = process.argv.slice(2);
  var config = {
    all: false,
    playstyle: false,
    universal: false,
    trinketComparison: false,
    meta: false,
    token: getToken(args),
    repo: "yueyang9999/bob-coach-data",
    branch: "main",
  };
  for (var i = 0; i < args.length; i++) {
    if (args[i] === "--all") config.all = true;
    else if (args[i] === "--playstyle") config.playstyle = true;
    else if (args[i] === "--universal") config.universal = true;
    else if (args[i] === "--trinket") config.trinketComparison = true;
    else if (args[i] === "--meta") config.meta = true;
    else if (args[i] === "--token" && i + 1 < args.length) i++;
    else if (args[i] === "--repo" && i + 1 < args.length) config.repo = args[++i];
  }
  if (!config.all && !config.playstyle && !config.universal && !config.trinketComparison && !config.meta) {
    config.all = true;
  }
  return config;
}

// ═══════════════════════════════════════════════════════════
// Upload logic (GitHub Contents API via Node.js https)
// ═══════════════════════════════════════════════════════════

function uploadFile(owner, repo, filePath, content, message, token, branch) {
  return new Promise(function(resolve, reject) {
    var https = require("https");
    var urlMod = require("url");

    var apiUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + filePath;
    var encoded = Buffer.from(content, "utf-8").toString("base64");

    // 先检查文件是否存在（获取 sha）
    var parsed = urlMod.parse(apiUrl);
    var getOpts = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: "GET",
      headers: {
        "Authorization": "token " + token,
        "User-Agent": "BobCoach/1.0",
      },
    };

    var getReq = https.request(getOpts, function(resp) {
      var data = "";
      resp.on("data", function(chunk) { data += chunk; });
      resp.on("end", function() {
        var sha = null;
        if (resp.statusCode === 200) {
          try { sha = JSON.parse(data).sha; } catch (e) {}
        }

        // PUT 请求
        var body = {
          message: message,
          content: encoded,
          branch: branch,
        };
        if (sha) body.sha = sha;

        var payload = JSON.stringify(body);
        var putOpts = {
          hostname: parsed.hostname,
          path: parsed.path,
          method: "PUT",
          headers: {
            "Authorization": "token " + token,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "User-Agent": "BobCoach/1.0",
          },
        };

        var putReq = https.request(putOpts, function(putResp) {
          var putData = "";
          putResp.on("data", function(chunk) { putData += chunk; });
          putResp.on("end", function() {
            if (putResp.statusCode >= 200 && putResp.statusCode < 300) {
              console.log("  [OK] " + filePath + (sha ? " (更新)" : " (新建)"));
              resolve(true);
            } else {
              console.error("  [FAIL] " + filePath + " HTTP " + putResp.statusCode + ": " + putData.substring(0, 200));
              resolve(false);
            }
          });
        });
        putReq.on("error", function(e) {
          console.error("  [FAIL] " + filePath + ": " + e.message);
          resolve(false);
        });
        putReq.write(payload);
        putReq.end();
      });
    });
    getReq.on("error", function(e) {
      console.error("  [FAIL] GET " + filePath + ": " + e.message);
      resolve(false);
    });
    getReq.end();
  });
}

// ═══════════════════════════════════════════════════════════
// 上传任务
// ═══════════════════════════════════════════════════════════

async function uploadPlaystyleProfile(config) {
  var profilePath = path.join(base, "data", "playstyle_profile.json");
  if (!fs.existsSync(profilePath)) {
    console.log("[跳过] playstyle_profile.json 不存在");
    return;
  }
  var profile = fs.readFileSync(profilePath, "utf-8");
  var repoParts = config.repo.split("/");
  console.log("\n── 上传玩法特征画像 ──");
  await uploadFile(
    repoParts[0], repoParts[1],
    "playstyle_profiles/yueyang.json",
    profile,
    "update: playstyle profile (" + new Date().toISOString().substring(0, 10) + ")",
    config.token, config.branch
  );
}

async function uploadUniversalFeatures(config) {
  var ufPath = path.join(base, "data", "universal_features.json");
  if (!fs.existsSync(ufPath)) {
    console.log("[跳过] universal_features.json 不存在");
    return;
  }
  var content = fs.readFileSync(ufPath, "utf-8");
  var repoParts = config.repo.split("/");
  console.log("\n── 上传通用上分特征 ──");
  await uploadFile(
    repoParts[0], repoParts[1],
    "universal_features/ranking_features.json",
    content,
    "update: universal ranking features (" + new Date().toISOString().substring(0, 10) + ")",
    config.token, config.branch
  );
}

async function uploadTrinketComparison(config) {
  var tcPath = path.join(base, "data", "trinket_comparison.json");
  if (!fs.existsSync(tcPath)) {
    console.log("[跳过] trinket_comparison.json 不存在");
    return;
  }
  var content = fs.readFileSync(tcPath, "utf-8");
  var repoParts = config.repo.split("/");
  console.log("\n── 上传饰品对比报告 ──");
  await uploadFile(
    repoParts[0], repoParts[1],
    "universal_features/trinket_comparison.json",
    content,
    "update: trinket comparison (" + new Date().toISOString().substring(0, 10) + ")",
    config.token, config.branch
  );
}

async function uploadMeta(config) {
  var meta = {
    version: Date.now(),
    generatedAt: new Date().toISOString(),
    dataFiles: {},
  };

  // 扫描已存在的数据文件
  var fileMap = {
    "playstyle_profile.json": "playstyle_profiles/yueyang.json",
    "universal_features.json": "universal_features/ranking_features.json",
    "trinket_comparison.json": "universal_features/trinket_comparison.json",
  };

  for (var localFile in fileMap) {
    var p = path.join(base, "data", localFile);
    if (fs.existsSync(p)) {
      var stat = fs.statSync(p);
      meta.dataFiles[fileMap[localFile]] = {
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    }
  }

  var repoParts = config.repo.split("/");
  console.log("\n── 上传 meta.json ──");
  await uploadFile(
    repoParts[0], repoParts[1],
    "meta.json",
    JSON.stringify(meta, null, 2),
    "update: meta.json (" + new Date().toISOString().substring(0, 10) + ")",
    config.token, config.branch
  );
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

async function main() {
  var config = parseArgs();

  if (!config.token || config.token.length < 10) {
    console.error("错误: 需要 GitHub Personal Access Token (repo scope)");
    console.error("");
    console.error("获取方式:");
    console.error("  1. 命令行: --token ghp_xxxxxxxxxxxx");
    console.error("  2. 环境变量: set GITHUB_TOKEN=ghp_xxxxxxxxxxxx");
    console.error("  3. 本地文件: data/github_token.txt (首行为 token)");
    console.error("");
    process.exit(1);
  }

  var repoParts = config.repo.split("/");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  云端数据上传管道                         ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");
  console.log("目标: " + config.repo + " (分支: " + config.branch + ")");
  console.log("");

  var uploads = [];

  if (config.all || config.meta) {
    uploads.push(uploadMeta(config));
  }

  if (config.all || config.playstyle) {
    uploads.push(uploadPlaystyleProfile(config));
  }

  if (config.all || config.universal) {
    uploads.push(uploadUniversalFeatures(config));
  }

  if (config.all || config.trinketComparison) {
    uploads.push(uploadTrinketComparison(config));
  }

  if (uploads.length === 0) {
    console.log("没有需要上传的文件");
    return;
  }

  await Promise.all(uploads);

  console.log("");
  console.log("上传完成! 查看: https://github.com/" + config.repo);
}

main().catch(function(e) {
  console.error("上传失败:", e.message);
  process.exit(1);
});
