"""Markdown generator for strategy guides."""
import os
from .models import Card, Minion, Hero, Tavern, Trinket


def _safe(v, default="-"):
    return v if v else default


def format_card(card: Card) -> str:
    lines = [f"### {card.name_cn} ({card.name})", ""]
    lines.append(f"- **ID**: `{card.str_id}`")
    lines.append(f"- **类型**: {card.card_type}")

    if isinstance(card, Minion):
        lines.append(f"- **星级**: {card.tier} | **攻击**: {card.attack} | **生命**: {card.health}")
        if card.minion_types_cn:
            lines.append(f"- **种族**: {'/'.join(card.minion_types_cn)}")
    elif isinstance(card, Hero):
        lines.append(f"- **生命**: {card.health} | **护甲**: {card.armor}")
    elif isinstance(card, Tavern):
        lines.append(f"- **星级**: {card.tier} | **费用**: {card.mana_cost}")

    if card.text_cn:
        lines.append(f"- **效果**: {card.text_cn}")
    if card.mechanics:
        lines.append(f"- **机制**: {', '.join(card.mechanics)}")

    lines.append("")
    return "\n".join(lines)


def format_synergy_report(report: dict) -> str:
    lines = [
        f"# {report['minion_type_cn']} 流跨系统协同分析",
        "",
        f"## 随从核心 ({len(report.get('minions', []))} 张)",
        "",
    ]

    # Minions by tier
    tiers = report.get("by_tier", {})
    for tier in sorted(tiers.keys()):
        lines.append(f"### {tier} 星")
        for m in tiers[tier]:
            lines.append(f"- **{m.name_cn}** {m.attack}/{m.health} — {m.text_cn[:80]}")
        lines.append("")

    # Related trinkets
    trinkets = report.get("trinkets", [])
    if trinkets:
        lines.append(f"## 饰品搭配 ({len(trinkets)} 个)")
        lines.append("")
        for t in trinkets:
            lines.append(f"- **{t.get('name_cn', t.get('name', ''))}** — {t.get('text_cn', '')[:120]}")
        lines.append("")

    # Companions
    companions = report.get("companions", [])
    if companions:
        lines.append(f"## 伙伴联动 ({len(companions)} 个)")
        lines.append("")
        for c in companions:
            lines.append(f"- **{c.get('name_cn', '')}** — {c.get('text_cn', '')[:120]}")
        lines.append("")

    # Timewarps
    timewarps = report.get("timewarps", [])
    if timewarps:
        lines.append(f"## 时空扭曲 ({len(timewarps)} 个)")
        lines.append("")
        for tw in timewarps:
            lines.append(f"- **{tw.get('name_cn', '')}** — {tw.get('text_cn', '')[:120]}")
        lines.append("")

    # Synergy summary
    lines.append("## 协同链路总结")
    lines.append("")
    for link in report.get("synergy_links", []):
        lines.append(f"- **{link['source']}** → **{link['target']}**: {link['reason']}")

    return "\n".join(lines)


def format_hero_guide(report: dict) -> str:
    h = report["hero"]
    lines = [
        f"# {h.name_cn} 酒馆战棋攻略",
        "",
        "## 英雄概览",
        "",
        f"- **护甲值**: {h.armor}",
    ]

    # Hero powers
    hp_list = report.get("hero_powers", [])
    if hp_list:
        hp_names = " / ".join(hp.get("name_cn", "") for hp in hp_list)
        costs = " / ".join(str(hp.get("mana_cost", "?")) for hp in hp_list)
        lines.append(f"- **英雄技能**: {hp_names} (费用: {costs})")
        lines.append("")
        lines.append("### 技能分析")
        for hp in hp_list:
            lines.append(f"- {hp.get('name_cn')}: {hp.get('text_cn', '')}")

    # Buddy
    buddy = report.get("buddy")
    if buddy:
        lines.append("")
        lines.append(f"## 伙伴: {buddy.get('name_cn', '')}")
        lines.append(f"- {buddy.get('text_cn', '')}")

    # Meta stats
    meta = report.get("meta_stats", {})
    if meta:
        lines.append("")
        lines.append("## 环境数据")
        lines.append(f"- **平均排名**: {meta.get('avg_position', '-')} ({meta.get('data_points', 0):,} 场)")
        lines.append("- **排名分布**:")
        for p in meta.get("placements", []):
            bar = "█" * int(p["percentage"] / 2)
            lines.append(f"  - 第{p['rank']}名: {p['percentage']:.1f}% {bar}")

    # Pro tips
    tips_data = report.get("pro_tips", [])
    if tips_data:
        lines.append("")
        lines.append("## 选手策略建议")
        for tip in tips_data:
            lines.append(f"- {tip.get('summary', '')}")
            lines.append(f"  *— {tip.get('author', '')}*")
            lines.append("")

    # Recommended comps
    comps = report.get("recommended_comps", [])
    if comps:
        lines.append("")
        lines.append("## 推荐阵容")
        for comp in comps:
            lines.append(f"### {comp.get('name', '')}")
            lines.append(f"- 强度: {comp.get('power_level', '?')} | 难度: {comp.get('difficulty', '?')}")
            if comp.get("cards"):
                lines.append("- 核心卡牌:")
                for c in comp["cards"]:
                    name = c.get('name_cn') or c.get('card_id', '?')
                    lines.append(f"  - **{name}**")
            if comp.get("tips"):
                lines.append("- 策略提示:")
                for t in comp["tips"]:
                    tip_text = t.get("tip") or t.get("summary", str(t))
                    lines.append(f"  - {tip_text}")
                    if t.get("whenToCommit"):
                        lines.append(f"    *发力时机: {t['whenToCommit']}*")
                    if t.get("author"):
                        lines.append(f"    *— {t['author']}*")
            lines.append("")

    # Curves
    curves = report.get("curves", [])
    if curves:
        lines.append("## 升本节奏参考")
        for curve in curves[:2]:
            lines.append(f"### {curve.get('name', '')}")
            lines.append(f"- {curve.get('notes', '')}")
            for step in curve.get("steps", []):
                actions = []
                for a in step.get("actions", []):
                    if isinstance(a, str):
                        actions.append(a)
                    elif isinstance(a, dict):
                        if a.get("type") == "level":
                            actions.append(f"升{a['param']}星")
                        else:
                            actions.append(a.get("type", ""))
                lines.append(f"  - 回合{step['turn']}: {' → '.join(actions)}")
            lines.append("")

    return "\n".join(lines)


def format_tier_list(tier_list: list) -> str:
    lines = ["# 随从梯队排行", ""]
    for tier_data in tier_list:
        lines.append(f"## {tier_data.get('name', '')}")
        for card in tier_data.get("cards", []):
            lines.append(f"- **{card.get('name_cn', '')}** — {card.get('reason', '')}")
        lines.append("")
    return "\n".join(lines)


def format_comparison(comp: dict) -> str:
    lines = [
        f"# 卡牌对比: {comp['card1'].name_cn} vs {comp['card2'].name_cn}",
        "",
        "## 相同点",
    ]
    for f in comp["same_fields"]:
        lines.append(f"- {f}")
    lines.append("")
    lines.append("## 不同点")
    for f, v1, v2 in comp["diff_fields"]:
        lines.append(f"- **{f}**: {v1} → {v2}")
    return "\n".join(lines)


def save_guide(content: str, filename: str):
    """Save guide to output/ directory."""
    os.makedirs("output", exist_ok=True)
    path = os.path.join("output", filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"攻略已保存: {path}")
