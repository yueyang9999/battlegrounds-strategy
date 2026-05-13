#!/usr/bin/env python3
"""Export card/comp/hero data from Python SQLite DBs to JSON for Electron plugin."""

import json
import os
import sys

# Add parent project to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.registry import get_registry
from src.meta_registry import get_meta_registry

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def export_cards():
    """Export all cards to cards.json (filtered fields)."""
    reg = get_registry()
    cards = []
    for c in reg.cards.values():
        card = {
            "str_id": c.str_id,
            "name": c.name,
            "name_cn": c.name_cn,
            "card_type": c.card_type,
            "text_cn": c.text_cn,
            "mechanics": getattr(c, "mechanics", []),
            "img": getattr(c, "img", ""),
        }
        # Type-specific fields
        if c.card_type in ("minion", "companion"):
            card["tier"] = getattr(c, "tier", 0)
            card["attack"] = getattr(c, "attack", 0)
            card["health"] = getattr(c, "health", 0)
            card["minion_types_cn"] = getattr(c, "minion_types_cn", [])
            card["upgrade_id"] = getattr(c, "upgrade_id", "")
        elif c.card_type == "hero":
            card["armor"] = getattr(c, "armor", 0)
            card["health"] = getattr(c, "health", 30)
            card["hp_ids"] = getattr(c, "hp_ids", [])
            card["buddy_id"] = getattr(c, "buddy_id", "")
        elif c.card_type == "hero_power":
            card["mana_cost"] = getattr(c, "mana_cost", 0)
        elif c.card_type in ("trinket", "timewarp"):
            card["mana_cost"] = getattr(c, "mana_cost", 0)
            card["lesser"] = getattr(c, "lesser", False)
            card["extra"] = getattr(c, "extra", [])
            if c.card_type == "timewarp":
                card["tier"] = getattr(c, "tier", 0)
        cards.append(card)

    out_path = os.path.join(OUT_DIR, "cards.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False)
    print(f"[export] cards.json: {len(cards)} cards")
    return len(cards)


def export_comp_strategies():
    """Export comp strategies."""
    meta = get_meta_registry()
    comps = meta.comp_strategies
    out_path = os.path.join(OUT_DIR, "comp_strategies.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(comps, f, ensure_ascii=False, indent=2)
    print(f"[export] comp_strategies.json: {len(comps)} comps")
    return len(comps)


def export_hero_stats():
    """Export hero stats with Chinese names."""
    meta = get_meta_registry()
    reg = get_registry()
    result = []
    for hid, hs in meta.hero_stats.items():
        card = reg.get(hid)
        result.append({
            "hero_card_id": hid,
            "name_cn": card.name_cn if card else hid,
            "avg_position": hs["avg_position"],
            "data_points": hs["data_points"],
            "placements": hs.get("placement_dist", []),
            "tribe_stats": hs.get("tribe_stats", []),
        })
    result.sort(key=lambda x: x["avg_position"])
    out_path = os.path.join(OUT_DIR, "hero_stats.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"[export] hero_stats.json: {len(result)} heroes")
    return len(result)


def export_hero_tips():
    """Export hero tips and curves."""
    meta = get_meta_registry()
    out_path = os.path.join(OUT_DIR, "hero_tips.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "tips": meta.hero_tips,
            "curves": meta.curves,
        }, f, ensure_ascii=False, indent=2)
    print(f"[export] hero_tips.json: {len(meta.hero_tips)} tips, {len(meta.curves)} curves")


def export_trinket_tips():
    """Export trinket tips."""
    meta = get_meta_registry()
    out_path = os.path.join(OUT_DIR, "trinket_tips.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(meta.trinket_tips, f, ensure_ascii=False, indent=2)
    print(f"[export] trinket_tips.json: {len(meta.trinket_tips)} tips")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("=" * 50)
    print("Exporting data for Bob Coach Electron plugin...")
    print("=" * 50)
    export_cards()
    export_comp_strategies()
    export_hero_stats()
    export_hero_tips()
    export_trinket_tips()
    print("=" * 50)
    print("Export complete!")
    print(f"Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
