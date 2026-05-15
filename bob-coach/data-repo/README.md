# Bob Coach Data Repository

酒馆战棋 Bob教练云端共享数据。

## 目录结构

```
data-repo/
  meta.json                           # 数据版本与索引
  playstyle_profiles/
    yueyang.json                      # 玩家玩法特征画像
  universal_features/
    ranking_features.json             # MMR分段通用上分特征
    trinket_comparison.json           # 饰品赛季对比测试报告
  segment_data/
    tier_0_6000.json                  # 低分段聚合数据
    tier_6001_8999.json               # 中分段聚合数据
    tier_9000_plus.json               # 高分段聚合数据
```

## 数据更新

通过 `scripts/upload_to_cloud.js` 自动推送到此仓库。

```bash
node scripts/upload_to_cloud.js --token <ghp_xxx> --all
```

## 下游使用

- Bob教练 Electron 端通过 `modules/DataSyncer.js` 拉取分段数据
- 分析面板展示通用上分特征对比
