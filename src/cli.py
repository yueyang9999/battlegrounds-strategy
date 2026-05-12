"""CLI entry point for BG strategy tool."""
import argparse
import os
import sys

# Ensure UTF-8 output on Windows
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def cmd_sync(args):
    from .sync import sync
    from .sync_meta import sync_meta
    print("=" * 50)
    print("同步卡牌数据...")
    print("=" * 50)
    result = sync(force=args.force)
    print()
    print("=" * 50)
    print("同步环境数据...")
    print("=" * 50)
    sync_meta(force=args.force)
    print()
    print("同步完成!")


def cmd_search(args):
    from .registry import get_registry
    reg = get_registry()
    results = reg.search_fts(args.query)
    print(f"\n搜索 '{args.query}': 找到 {len(results)} 张卡牌\n")
    for c in results[:20]:
        tier = getattr(c, "tier", None)
        tier_str = f" {tier}星" if tier else ""
        atk_hp = f" {getattr(c, 'attack', '')}/{getattr(c, 'health', '')}" if hasattr(c, "attack") else ""
        print(f"  [{c.card_type}{tier_str}] {c.name_cn} ({c.name}){atk_hp}")
        if c.text_cn:
            print(f"    {c.text_cn[:100]}")
    print()


def cmd_card(args):
    from .registry import get_registry
    from .output import format_card
    reg = get_registry()
    card = reg.get_by_name(args.name)
    if not card:
        print(f"未找到卡牌: {args.name}")
        return
    print(format_card(card))


def cmd_compare(args):
    from .registry import get_registry
    from .output import format_comparison, save_guide
    reg = get_registry()
    result = __import__("src.query", fromlist=["compare_cards"]).compare_cards(reg, args.card1, args.card2)
    if not result:
        print("未找到其中一张或两张卡牌")
        return
    md = format_comparison(result)
    print(md)
    if args.output:
        save_guide(md, args.output)


def cmd_synergy(args):
    from .registry import get_registry
    from .meta_registry import get_meta_registry
    from .analyze import analyze_minion_synergy
    from .output import format_synergy_report, save_guide

    reg = get_registry()
    meta = get_meta_registry()
    report = analyze_minion_synergy(reg, meta, args.race)
    md = format_synergy_report(report)
    print(md)
    filename = args.output or f"synergy_{args.race}.md"
    save_guide(md, filename)


def cmd_hero(args):
    from .registry import get_registry
    from .meta_registry import get_meta_registry
    from .analyze import analyze_hero
    from .output import format_hero_guide, save_guide

    reg = get_registry()
    meta = get_meta_registry()
    report = analyze_hero(reg, meta, args.name)
    if "error" in report:
        print(report["error"])
        return
    md = format_hero_guide(report)
    print(md)
    filename = args.output or f"hero_{report['hero'].name_cn}.md"
    save_guide(md, filename)


def cmd_comps(args):
    from .registry import get_registry
    from .meta_registry import get_meta_registry
    from .analyze import analyze_comps

    reg = get_registry()
    meta = get_meta_registry()
    comps = analyze_comps(reg, meta)

    print(f"\n当前热门流派 ({len(comps)} 套)\n")
    for i, c in enumerate(comps, 1):
        print(f"{i}. {c['name']}")
        print(f"   强度: {c['power_level']} | 难度: {c['difficulty']}")
        if c.get("forced_tribes"):
            print(f"   种族: {', '.join(c['forced_tribes'])}")
        if c["cards"]:
            names = [card["name_cn"] or card["card_id"] for card in c["cards"][:6]]
            print(f"   核心卡: {' → '.join(names)}")
        if c["tips"]:
            print(f"   策略: {c['tips'][0][:120]}")
        print()


def cmd_meta_view(args):
    from .registry import get_registry
    from .meta_registry import get_meta_registry
    from .analyze import analyze_meta_overview

    reg = get_registry()
    meta = get_meta_registry()
    overview = analyze_meta_overview(reg, meta)

    print("\n===== 版本环境总览 =====\n")
    print("🏆 英雄 TOP5 (按平均排名):")
    for i, h in enumerate(overview["top_heroes"], 1):
        print(f"  {i}. {h['name_cn']} — 均排 {h['avg_position']:.2f} ({h['data_points']:,} 场)")

    print(f"\n📊 热门流派 TOP5:")
    for i, name in enumerate(overview.get("top_comps", []), 1):
        print(f"  {i}. {name}")

    print()


def main():
    parser = argparse.ArgumentParser(
        prog="bg-strategy",
        description="酒馆战棋攻略分析工具",
    )
    sub = parser.add_subparsers(dest="command")

    p_sync = sub.add_parser("sync", help="同步全部数据")
    p_sync.add_argument("--force", action="store_true", help="强制重新同步")
    p_sync.set_defaults(func=cmd_sync)

    p_search = sub.add_parser("search", help="搜索卡牌")
    p_search.add_argument("query", help="搜索关键词")
    p_search.set_defaults(func=cmd_search)

    p_card = sub.add_parser("card", help="查看卡牌详情")
    p_card.add_argument("name", help="卡牌名称(中文或英文)")
    p_card.set_defaults(func=cmd_card)

    p_comp = sub.add_parser("compare", help="对比两张卡牌")
    p_comp.add_argument("card1", help="卡牌1")
    p_comp.add_argument("card2", help="卡牌2")
    p_comp.add_argument("--output", "-o", help="输出 .md 文件")
    p_comp.set_defaults(func=cmd_compare)

    p_syn = sub.add_parser("synergy", help="种族协同分析")
    p_syn.add_argument("race", help="种族名称(中文或英文)")
    p_syn.add_argument("--output", "-o", help="输出 .md 文件")
    p_syn.set_defaults(func=cmd_synergy)

    p_hero = sub.add_parser("hero", help="英雄攻略分析")
    p_hero.add_argument("name", help="英雄名称")
    p_hero.add_argument("--output", "-o", help="输出 .md 文件")
    p_hero.set_defaults(func=cmd_hero)

    p_cmps = sub.add_parser("comps", help="热门流派一览")
    p_cmps.set_defaults(func=cmd_comps)

    p_meta = sub.add_parser("meta", help="版本环境总览")
    p_meta.set_defaults(func=cmd_meta_view)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return
    args.func(args)


if __name__ == "__main__":
    main()
