"""Dataclass models for all 10 card types."""
from dataclasses import dataclass, field


@dataclass
class Card:
    id: int
    str_id: str
    card_type: str
    name: str
    name_cn: str
    text_cn: str
    mechanics: list[str] = field(default_factory=list)
    ref_tags: list[str] = field(default_factory=list)
    img: str = ""
    art: str = ""


@dataclass
class Minion(Card):
    tier: int = 0
    attack: int = 0
    health: int = 0
    minion_types: list[str] = field(default_factory=list)
    minion_types_cn: list[str] = field(default_factory=list)
    upgrade_id: str = ""


@dataclass
class Hero(Card):
    health: int = 30
    armor: int = 0
    hp_ids: list[str] = field(default_factory=list)
    buddy_id: str = ""


@dataclass
class HeroPower(Card):
    mana_cost: int = 0


@dataclass
class Companion(Minion):
    buddy_hero_id: str = ""
    buddy_hp_id: str = ""


@dataclass
class Tavern(Card):
    tier: int = 0
    mana_cost: int = 0


@dataclass
class Quest(Card):
    pass


@dataclass
class QuestReward(Card):
    pass


@dataclass
class Anomaly(Card):
    pass


@dataclass
class Trinket(Card):
    lesser: bool = False
    mana_cost: int = 0
    extra: list[str] = field(default_factory=list)


@dataclass
class Timewarp(Card):
    lesser: bool = False
    mana_cost: int = 0
    tier: int = 0
    extra: list[str] = field(default_factory=list)


TYPE_MAP = {
    "minion": Minion,
    "hero": Hero,
    "hero_power": HeroPower,
    "companion": Companion,
    "tavern": Tavern,
    "quest": Quest,
    "quest_reward": QuestReward,
    "anomaly": Anomaly,
    "trinket": Trinket,
    "timewarp": Timewarp,
}


def card_from_row(row) -> Card:
    import json

    def j(v):
        return json.loads(v) if isinstance(v, str) and v else []

    ct = row["card_type"]
    base = dict(
        id=row["id"],
        str_id=row["str_id"],
        card_type=ct,
        name=row["name"] or "",
        name_cn=row["name_cn"] or "",
        text_cn=row["text_cn"] or "",
        mechanics=j(row["mechanics"]),
        ref_tags=j(row["ref_tags"]),
        img=row["img"] or "",
        art=row["art"] or "",
    )

    if ct == "minion":
        return Minion(
            **base,
            tier=row["tier"] or 0,
            attack=row["attack"] or 0,
            health=row["health"] or 0,
            minion_types=j(row["minion_types"]),
            minion_types_cn=j(row["minion_types_cn"]),
            upgrade_id=row["upgrade_id"] or "",
        )
    elif ct == "hero":
        return Hero(
            **base,
            health=row["health"] or 30,
            armor=row["armor"] or 0,
            hp_ids=j(row["hp_ids"]),
            buddy_id=row["buddy_id"] or "",
        )
    elif ct == "hero_power":
        return HeroPower(**base, mana_cost=row["mana_cost"] or 0)
    elif ct == "companion":
        return Companion(
            **base,
            tier=row["tier"] or 0,
            attack=row["attack"] or 0,
            health=row["health"] or 0,
            minion_types=j(row["minion_types"]),
            minion_types_cn=j(row["minion_types_cn"]),
            upgrade_id=row["upgrade_id"] or "",
            buddy_hero_id=row["buddy_hero_id"] or "",
            buddy_hp_id=row["buddy_hp_id"] or "",
        )
    elif ct == "tavern":
        return Tavern(**base, tier=row["tier"] or 0, mana_cost=row["mana_cost"] or 0)
    elif ct == "quest":
        return Quest(**base)
    elif ct == "reward":
        return QuestReward(**base)
    elif ct == "anomaly":
        return Anomaly(**base)
    elif ct == "trinket":
        return Trinket(
            **base,
            lesser=bool(row["lesser"]),
            mana_cost=row["mana_cost"] or 0,
            extra=j(row["extra"]),
        )
    elif ct == "timewarp":
        return Timewarp(
            **base,
            lesser=bool(row["lesser"]),
            mana_cost=row["mana_cost"] or 0,
            tier=row["tier"] or 0,
            extra=j(row["extra"]),
        )
    return Card(**base)
