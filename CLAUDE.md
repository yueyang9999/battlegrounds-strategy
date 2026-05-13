# 酒馆战棋攻略分析系统

## 项目概述

从 Gamerhub (卡牌图鉴) + Firestone (环境数据) 获取数据，分析酒馆战棋卡牌协同与版本环境，产出中文攻略 Markdown。

GitHub: https://github.com/yueyang9999/battlegrounds-strategy

## 验证命令

```
python -m src.cli sync          # 同步数据
python -m src.cli search <关键词> # 搜索卡牌
python -m src.cli hero <英雄名>   # 生成英雄攻略
python -m src.cli synergy <种族>  # 种族协同分析
python -m src.cli comps           # 热门流派
python -m src.cli meta            # 版本环境
python -m src.server              # 启动面板服务 (http://localhost:8765)
```

## 关键文件

- `src/database.py` — SQLite schema (bg_cards.db / bg_meta.db)
- `src/sync.py` — Gamerhub 卡牌同步
- `src/sync_meta.py` — Firestone 环境数据同步
- `src/registry.py` — 内存卡牌索引
- `src/meta_registry.py` — 环境数据访问
- `src/analyze.py` — 策略分析引擎
- `src/output.py` — Markdown 攻略生成
- `src/cli.py` — 命令行入口
- `src/server.py` — 面板 API 服务 + 页面路由 (/panel, /team-builder)
- `src/panel.html` — 前端分析面板 (英雄排行/随从图鉴/流派攻略)
- `src/team-builder.html` — 阵容编辑器 (自由组合英雄/技能/饰品/随从)
- `output/` — 生成的攻略文件

## 编码规范

- Python 3 stdlib only (零外部依赖)
- 代码/变量名英文，输出/注释中文
- UTF-8 编码，SQLite 存储
