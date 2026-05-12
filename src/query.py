"""Card filtering, searching, and comparison."""
from .registry import CardRegistry, get_registry
from .models import Card, Minion


def filter_cards(reg: CardRegistry, **kwargs) -> list[Card]:
    results = list(reg.cards.values())

    if "card_type" in kwargs:
        results = [c for c in results if c.card_type == kwargs["card_type"]]

    if "tier" in kwargs:
        t = kwargs["tier"]
        results = [c for c in results if getattr(c, "tier", None) == t]

    if "minion_type" in kwargs:
        mt = kwargs["minion_type"].lower()
        results = [c for c in results
                   if isinstance(c, Minion) and mt in [m.lower() for m in c.minion_types]]

    if "mechanic" in kwargs:
        m = kwargs["mechanic"].upper()
        results = [c for c in results if m in [x.upper() for x in c.mechanics]]

    if "keyword" in kwargs:
        kw = kwargs["keyword"]
        results = [c for c in results if kw in c.name_cn or kw in c.text_cn or kw in c.name]

    if "attack_min" in kwargs:
        atk = kwargs["attack_min"]
        results = [c for c in results if isinstance(c, Minion) and c.attack >= atk]

    if "health_min" in kwargs:
        hp = kwargs["health_min"]
        results = [c for c in results if isinstance(c, Minion) and c.health >= hp]

    return results


def search_cards(reg: CardRegistry, query: str) -> list[Card]:
    return reg.search_fts(query)


def compare_cards(reg: CardRegistry, id1: str, id2: str) -> dict | None:
    c1 = reg.get(id1) or reg.get_by_name(id1)
    c2 = reg.get(id2) or reg.get_by_name(id2)
    if not c1 or not c2:
        return None

    fields = ["name_cn", "card_type", "tier", "attack", "health", "mana_cost", "text_cn", "mechanics", "minion_types_cn"]
    same = []
    diff = []
    for f in fields:
        v1 = getattr(c1, f, None)
        v2 = getattr(c2, f, None)
        if v1 == v2:
            same.append(f)
        else:
            diff.append((f, v1, v2))

    return {
        "card1": c1,
        "card2": c2,
        "same_fields": same,
        "diff_fields": diff,
    }


def get_cards_by_mechanic(reg: CardRegistry, mechanic: str) -> list[Card]:
    m = mechanic.upper()
    return [c for c in reg.cards.values() if m in [x.upper() for x in c.mechanics]]
