"""Strategy analysis engine: synergy, hero, comp, meta."""
from .registry import CardRegistry, get_registry
from .meta_registry import MetaRegistry, get_meta_registry
from .models import Minion, Hero, Companion, Trinket, Timewarp


def analyze_minion_synergy(reg: CardRegistry, meta: MetaRegistry, minion_type: str) -> dict:
    # Normalize: support both EN and CN type names
    mt_en = minion_type.lower()
    mt_cn_map = {
        "demon": "恶魔", "beast": "野兽", "mech": "机械", "dragon": "龙",
        "murloc": "鱼人", "pirate": "海盗", "elemental": "元素",
        "quilboar": "野猪人", "naga": "纳迦", "undead": "亡灵",
        "demon": "恶魔",
    }
    # Find matching minion type
    for mt, cn in mt_cn_map.items():
        if minion_type in (mt, cn):
            mt_en = mt
            break

    minions = reg.by_minion_type(mt_en)
    mt_cn = minions[0].minion_types_cn[0] if minions and minions[0].minion_types_cn else minion_type

    # Group by tier
    by_tier = {}
    for m in minions:
        by_tier.setdefault(m.tier, []).append(m)

    # Find related trinkets (search text for minion type keywords)
    trinkets = []
    for c in reg.cards.values():
        if isinstance(c, Trinket):
            if any(kw in c.text_cn for kw in [mt_cn, minion_type]):
                trinkets.append({
                    "name_cn": c.name_cn, "name": c.name,
                    "text_cn": c.text_cn, "lesser": c.lesser,
                })
        if isinstance(c, Timewarp):
            if any(kw in c.text_cn for kw in [mt_cn, minion_type]):
                trinkets.append({
                    "name_cn": c.name_cn, "name": c.name,
                    "text_cn": c.text_cn, "lesser": c.lesser,
                })

    # Synergy analysis: find cards that buff same type
    synergy_links = []
    for m in minions:
        for ref in m.ref_tags:
            synergy_links.append({
                "source": m.name_cn,
                "target": ref,
                "reason": f"具有 {ref} 机制",
            })

    return {
        "minion_type": mt_en,
        "minion_type_cn": mt_cn,
        "minions": [{"name_cn": m.name_cn, "tier": m.tier, "attack": m.attack,
                      "health": m.health, "text_cn": m.text_cn} for m in minions],
        "by_tier": {t: [m for m in minions if m.tier == t] for t in sorted(by_tier)},
        "trinkets": trinkets,
        "synergy_links": synergy_links,
    }


def analyze_hero(reg: CardRegistry, meta: MetaRegistry, hero_name: str) -> dict:
    hero = reg.get_by_name(hero_name)
    if not isinstance(hero, Hero):
        return {"error": f"未找到英雄: {hero_name}"}

    hero_powers = reg.get_hero_powers(hero)
    buddy = reg.get_buddy(hero)

    # Meta stats
    meta_stat = meta.get_hero_stat(hero.str_id)
    meta_data = {}
    if meta_stat:
        meta_data = {
            "avg_position": meta_stat["avg_position"],
            "data_points": meta_stat["data_points"],
            "placements": meta_stat["placement_dist"],
        }

    # Pro tips
    tips_data = meta.get_hero_tips(hero.str_id)
    pro_tips = tips_data.get("tips", []) if tips_data else []

    # Curves
    curves = meta.curves if meta.curves else []

    # Find matching comp strategies (by tribe in hero power text)
    recommended = []
    hp_text = " ".join(hp.text_cn for hp in hero_powers if hp).lower()
    buddy_text = buddy.text_cn.lower() if buddy else ""
    combined_text = hp_text + " " + buddy_text

    for comp in meta.comp_strategies[:8]:  # top 8 comps
        cards_info = []
        for card_entry in comp.get("cards", []):
            card_id = card_entry.get("cardId", "")
            card = reg.get(card_id)
            cards_info.append({
                "card_id": card_id,
                "name_cn": card.name_cn if card else card_id,
            })
        recommended.append({
            "name": comp.get("name", ""),
            "power_level": comp.get("power_level", "?"),
            "difficulty": comp.get("difficulty", "?"),
            "cards": cards_info,
            "tips": comp.get("tips", []),
        })

    return {
        "hero": hero,
        "hero_powers": [{"name_cn": hp.name_cn, "text_cn": hp.text_cn, "mana_cost": hp.mana_cost}
                        for hp in hero_powers if hp],
        "buddy": {"name_cn": buddy.name_cn, "text_cn": buddy.text_cn} if buddy else None,
        "meta_stats": meta_data,
        "pro_tips": pro_tips,
        "curves": curves,
        "recommended_comps": recommended,
    }


def analyze_comps(reg: CardRegistry, meta: MetaRegistry) -> list[dict]:
    comps = []
    for c in meta.comp_strategies:
        cards_detail = []
        for card_entry in c.get("cards", []):
            card_id = card_entry.get("cardId", "")
            card = reg.get(card_id)
            cards_detail.append({
                "card_id": card_id,
                "name_cn": card.name_cn if card else card_id,
                "text_cn": card.text_cn[:100] if card and card.text_cn else "",
            })

        comps.append({
            "name": c.get("name", "未知流派"),
            "difficulty": c.get("difficulty", "?"),
            "power_level": c.get("power_level", "?"),
            "forced_tribes": c.get("forced_tribes", []),
            "cards": cards_detail,
            "tips": [t.get("summary", str(t)) for t in c.get("tips", [])],
        })
    return comps


def analyze_meta_overview(reg: CardRegistry, meta: MetaRegistry) -> dict:
    top_heroes = meta.get_top_heroes(10)
    top_heroes_detail = []
    for h in top_heroes[:5]:
        card = reg.get(h["hero_card_id"])
        top_heroes_detail.append({
            "name_cn": card.name_cn if card else h["hero_card_id"],
            "avg_position": h["avg_position"],
            "data_points": h["data_points"],
        })

    return {
        "top_heroes": top_heroes_detail,
        "comp_count": meta.comp_count,
        "top_comps": [c.get("name", "") for c in meta.comp_strategies[:5]],
    }
