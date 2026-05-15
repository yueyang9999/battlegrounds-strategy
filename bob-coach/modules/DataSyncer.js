"use strict";

// ═══════════════════════════════════════════════════════════
// DataSyncer — GitHub Pages 数据同步客户端
// ═══════════════════════════════════════════════════════════
//
// 从 GitHub Pages 拉取聚合分段数据，缓存到 localStorage。
// 零服务器成本，利用 GitHub Actions 定时生成静态 JSON。
//
// 数据流:
//   GitHub Pages (bob-coach-data)
//     → meta.json (版本检查)
//     → segment_data/tier_0_6000.json
//     → segment_data/tier_6001_8999.json
//     → segment_data/tier_9000_plus.json
//     → rules.json (可选全局规则)
//
// 缓存策略:
//   - meta.json 每次启动检查 (HEAD 请求或带 ?t= 参数)
//   - segment_data 仅在版本变化时下载
//   - localStorage 持久化

var DATA_BASE_URL = "https://yueyang9999.github.io/bob-coach-data";

var SEGMENT_KEYS = ["tier_0_6000", "tier_6001_8999", "tier_9000_plus"];

var DataSyncer = class DataSyncer {

  constructor(baseUrl) {
    this.baseUrl = baseUrl || DATA_BASE_URL;
    this.localMeta = null;
    this._loadLocalMeta();
  }

  // ── 本地缓存 ──

  _loadLocalMeta() {
    try {
      if (typeof localStorage !== "undefined") {
        var raw = localStorage.getItem("bob_coach_meta");
        this.localMeta = raw ? JSON.parse(raw) : null;
      }
    } catch (e) {
      this.localMeta = null;
    }
  }

  _saveLocalMeta(meta) {
    this.localMeta = meta;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("bob_coach_meta", JSON.stringify(meta));
      }
    } catch (e) {
      console.warn("[DataSyncer] 无法保存 meta 到 localStorage");
    }
  }

  _saveSegmentData(segKey, data) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("bob_coach_seg_" + segKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn("[DataSyncer] 无法保存分段数据:", segKey);
    }
  }

  // ── 公共 API ──

  /**
   * 检查远程数据是否有更新，如有则下载。
   * @returns {Promise<boolean>} — true 表示有更新
   */
  async checkAndUpdate() {
    try {
      var remoteMeta = await this._fetchMeta();
      if (!remoteMeta) return false;

      if (this.localMeta && remoteMeta.version === this.localMeta.version) {
        console.log("[DataSyncer] 数据已是最新 (v" + remoteMeta.version + ")");
        return false;
      }

      console.log("[DataSyncer] 发现新版本:", remoteMeta.version, "开始下载...");

      // 下载 rules.json (存在即下载)
      await this._downloadRules();

      // 下载分段数据
      var segments = remoteMeta.segments_available || SEGMENT_KEYS;
      for (var i = 0; i < segments.length; i++) {
        await this._downloadSegment(segments[i]);
      }

      this._saveLocalMeta(remoteMeta);
      console.log("[DataSyncer] 数据同步完成");
      return true;

    } catch (e) {
      console.warn("[DataSyncer] 同步失败，使用本地缓存:", e.message);
      return false;
    }
  }

  /**
   * 获取分段聚合数据（从缓存）。
   * @param {string} segKey — "tier_0_6000" | "tier_6001_8999" | "tier_9000_plus"
   * @returns {object|null}
   */
  getSegmentData(segKey) {
    try {
      if (typeof localStorage !== "undefined") {
        var raw = localStorage.getItem("bob_coach_seg_" + segKey);
        return raw ? JSON.parse(raw) : null;
      }
    } catch (e) {}
    return null;
  }

  /**
   * 获取全局规则（从缓存）。
   * @returns {object|null}
   */
  getRules() {
    try {
      if (typeof localStorage !== "undefined") {
        var raw = localStorage.getItem("bob_coach_rules");
        return raw ? JSON.parse(raw) : null;
      }
    } catch (e) {}
    return null;
  }

  /**
   * 根据玩家 MMR 获取对应分段的聚合数据。
   * @param {number} mmr
   * @returns {object|null}
   */
  getSegmentForMMR(mmr) {
    var seg;
    if (mmr <= 6000) seg = "tier_0_6000";
    else if (mmr <= 8999) seg = "tier_6001_8999";
    else seg = "tier_9000_plus";
    return this.getSegmentData(seg);
  }

  /**
   * 获取所有分段的非空数据。
   * @returns {object} { segKey: data }
   */
  getAllSegments() {
    var all = {};
    for (var i = 0; i < SEGMENT_KEYS.length; i++) {
      var key = SEGMENT_KEYS[i];
      var data = this.getSegmentData(key);
      if (data) all[key] = data;
    }
    return all;
  }

  // ── HTTP 请求 ──

  async _fetchMeta() {
    var url = this.baseUrl + "/meta.json?t=" + Date.now();
    var resp = await this._fetch(url);
    if (!resp) return null;
    return resp;
  }

  async _downloadRules() {
    try {
      var url = this.baseUrl + "/rules.json?t=" + Date.now();
      var data = await this._fetch(url);
      if (data) {
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("bob_coach_rules", JSON.stringify(data));
          }
        } catch (e) {}
      }
    } catch (e) {
      // rules.json 是可选的
    }
  }

  async _downloadSegment(segKey) {
    var url = this.baseUrl + "/segment_data/" + segKey + ".json?t=" + Date.now();
    var data = await this._fetch(url);
    if (data) {
      this._saveSegmentData(segKey, data);
    }
  }

  /**
   * 兼容 Electron (Node.js http) 和浏览器 (fetch) 的通用请求。
   */
  async _fetch(url) {
    // 浏览器环境
    if (typeof fetch === "function") {
      try {
        var resp = await fetch(url, { cache: "no-cache" });
        if (!resp.ok) return null;
        return await resp.json();
      } catch (e) {
        return null;
      }
    }

    // Node.js / Electron 环境 (备选)
    if (typeof require !== "undefined") {
      return await this._fetchNode(url);
    }

    return null;
  }

  _fetchNode(url) {
    return new Promise(function(resolve) {
      try {
        var mod = url.startsWith("https") ? require("https") : require("http");
        mod.get(url, { headers: { "User-Agent": "BobCoach/1.0" } }, function(res) {
          if (res.statusCode !== 200) { resolve(null); return; }
          var data = "";
          res.on("data", function(chunk) { data += chunk; });
          res.on("end", function() {
            try { resolve(JSON.parse(data)); }
            catch (e) { resolve(null); }
          });
        }).on("error", function() { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  // ── 文件上传（写入 yueyang9999/bob-coach-data） ──

  /**
   * 通过 GitHub Contents API 创建/更新文件。
   */
  async uploadFile(owner, repo, filePath, content, message, token, branch, sha) {
    branch = branch || "main";
    var apiUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + filePath;
    var body = {
      message: message,
      content: this._base64Encode(content),
      branch: branch,
    };
    if (sha) body.sha = sha;
    try {
      if (typeof fetch === "function") {
        var resp = await fetch(apiUrl, {
          method: "PUT",
          headers: {
            "Authorization": "token " + token,
            "Content-Type": "application/json",
            "User-Agent": "BobCoach/1.0",
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          var errText = await resp.text();
          console.error("[DataSyncer] 上传失败 HTTP " + resp.status + ": " + errText);
          return null;
        }
        return await resp.json();
      }
      return await this._uploadFileNode(apiUrl, body, token);
    } catch (e) {
      console.error("[DataSyncer] 上传文件失败:", e.message);
      return null;
    }
  }

  _uploadFileNode(apiUrl, body, token) {
    return new Promise(function(resolve) {
      try {
        var https = require("https");
        var urlMod = require("url");
        var parsed = urlMod.parse(apiUrl);
        var payload = JSON.stringify(body);
        var req = https.request({
          hostname: parsed.hostname,
          path: parsed.path,
          method: "PUT",
          headers: {
            "Authorization": "token " + token,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "User-Agent": "BobCoach/1.0",
          },
        }, function(res) {
          var data = "";
          res.on("data", function(chunk) { data += chunk; });
          res.on("end", function() {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try { resolve(JSON.parse(data)); }
              catch (e) { resolve(null); }
            } else {
              console.error("[DataSyncer] 上传失败 HTTP " + res.statusCode + ": " + data);
              resolve(null);
            }
          });
        });
        req.on("error", function(e) { console.error("[DataSyncer] 上传请求失败:", e.message); resolve(null); });
        req.write(payload);
        req.end();
      } catch (e) { console.error("[DataSyncer] _uploadFileNode 失败:", e.message); resolve(null); }
    });
  }

  async uploadPlaystyleProfile(profile, filename, token, repo) {
    repo = repo || "yueyang9999/bob-coach-data";
    var parts = repo.split("/");
    var owner = parts[0];
    var repoName = parts[1];
    var filePath = "playstyle_profiles/" + filename;
    var sha = await this._getFileSha(owner, repoName, filePath, token);
    var content = JSON.stringify(profile, null, 2);
    var message = sha
      ? "update: playstyle profile " + filename + " (" + new Date().toISOString().substring(0, 10) + ")"
      : "add: playstyle profile " + filename;
    return await this.uploadFile(owner, repoName, filePath, content, message, token, "main", sha);
  }

  async _getFileSha(owner, repo, filePath, token) {
    var apiUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + filePath;
    try {
      if (typeof fetch === "function") {
        var resp = await fetch(apiUrl, {
          headers: { "Authorization": "token " + token, "User-Agent": "BobCoach/1.0" },
        });
        if (resp.ok) {
          var data = await resp.json();
          return data.sha;
        }
      }
    } catch (e) {}
    return null;
  }

  _base64Encode(str) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(str, "utf-8").toString("base64");
    }
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(str)));
    }
    return "";
  }

  // ── 手动上传入口（给设置面板调用） ──

  /**
   * 将 CompactRecord 作为 GitHub Issue 提交。
   * 利用 GitHub Issues API 作为轻量数据收集通道。
   * 需要用户提供 Personal Access Token (repo scope)。
   *
   * @param {object} record — Recorder.endGame() 的输出
   * @param {string} token — GitHub PAT
   * @param {string} [repo="yueyang9999/bob-coach-data"]
   * @returns {Promise<boolean>}
   */
  async uploadViaIssue(record, token, repo) {
    repo = repo || "yueyang9999/bob-coach-data";
    var apiUrl = "https://api.github.com/repos/" + repo + "/issues";

    var title = "[record] " + (record.ts || "?") + " hero=" + (record.hero || "?") + " rank=" + (record.rank || "?");
    var body = "```json\n" + JSON.stringify(record, null, 2) + "\n```";
    // 添加标签用于自动分类
    body += "\n\n<!-- label:data-upload," + (record.seg_bucket || "") + " -->";

    try {
      if (typeof fetch === "function") {
        var resp = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Authorization": "token " + token,
            "Content-Type": "application/json",
            "User-Agent": "BobCoach/1.0",
          },
          body: JSON.stringify({
            title: title,
            body: body,
            labels: ["data-upload", record.seg_bucket || "tier_0_6000"],
          }),
        });
        return resp.ok;
      }
    } catch (e) {
      console.error("[DataSyncer] 上传 Issue 失败:", e.message);
    }
    return false;
  }
};
