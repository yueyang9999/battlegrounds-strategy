# 酒馆战棋攻略分析系统

## 项目概述

两个子系统：
- **Bob教练** (`bob-coach/`) — Electron 覆盖层教学插件（实测目标）
- **Python 分析管线** (`src/`) — 数据获取 + 攻略生成

GitHub: https://github.com/yueyang9999/battlegrounds-strategy

---

## 实测入口（Bob教练 Electron 插件）

```bash
cd bob-coach
npm start                    # 启动覆盖层插件
node simulate_games.js       # 8人模拟对局（200局批量）
node test_combat.js          # 战斗引擎测试（54项）
node test_simulation_e2e.js  # 模拟对局E2E测试（32项）
node scripts/full_test_suite.js  # 完整功能测试套件
```

### bob-coach/ 文件结构

| 目录/文件 | 用途 |
|-----------|------|
| `main.js` | Electron 主进程入口 |
| `preload.js` | 预加载脚本（IPC 桥接） |
| `log-parser.js` | Power.log 解析器 |
| `overlay.html` / `overlay.css` / `overlay.js` | 覆盖层前端 UI |
| `modules/` | **21个决策模块**（选牌/升本/卖怪/法术/冻结/刷新/饰品/英雄技能等） |
| `simulation/` | **18个模拟引擎文件**（战斗结算/共享卡池/匹配系统/伤害/护甲/AI/饰品等） |
| `scripts/` | 数据管道脚本（特征提取/云端同步/日志解析等） |
| `test_*.js` | 10个测试文件 |
| `sync-data.js` | 卡牌/英雄/流派外部数据同步 |
| `SAFETY_SPEC.md` + `SAFETY_CHECKLIST.md` | 安全规范与审查清单 |

---

## Python 分析管线

```
python -m src.cli sync          # 同步数据
python -m src.cli search <关键词> # 搜索卡牌
python -m src.cli hero <英雄名>   # 生成英雄攻略
python -m src.cli synergy <种族>  # 种族协同分析
python -m src.cli comps           # 热门流派
python -m src.cli meta            # 版本环境
python -m src.server              # 启动面板服务 (http://localhost:8765)
```

### src/ 关键文件

- `src/database.py` — SQLite schema (bg_cards.db / bg_meta.db / bg_player.db)
- `src/sync.py` — Gamerhub 卡牌同步
- `src/sync_meta.py` — Firestone 环境数据同步
- `src/registry.py` — 内存卡牌索引
- `src/meta_registry.py` — 环境数据访问
- `src/analyze.py` — 策略分析引擎
- `src/output.py` — Markdown 攻略生成
- `src/cli.py` — 命令行入口
- `src/server.py` — 面板 API 服务 + 页面路由
- `src/panel.html` — 前端分析面板
- `src/team-builder.html` — 阵容编辑器

---

## 文档索引

| 目录 | 内容 |
|------|------|
| `docs/design/` | 11份产品/架构/规则设计文档 |
| `sessions/` | 开发会话记录（10次） |
| `output/` | 生成的攻略 Markdown |

---

## 编码与安全规范

- Python 3 stdlib only（零外部依赖）
- 代码/变量名英文，输出/注释中文
- UTF-8 编码，SQLite 存储

### 安全约束（最高优先级）

Bob教练插件的所有代码生成须通过 `SAFETY_SPEC.md` 审查：

**绝对禁止：** 内存操作 API / 模拟输入 / 游戏文件修改 / 进程注入 / "自动/托管/挂机"功能
**唯一允许的数据获取：** 读取 Power.log 日志文件
**唯一允许的覆盖层：** Electron 独立透明窗口
