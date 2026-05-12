"""In-memory card registry with indexed lookups and relationship traversal."""
from .database import get_cards_conn
from .models import card_from_row, Card, Minion, Hero, HeroPower, Companion


class CardRegistry:
    def __init__(self, db_path: str = "bg_cards.db"):
        self._cards: dict[str, Card] = {}        # strId -> Card
        self._by_type: dict[str, list[Card]] = {} # card_type -> list
        self._by_tier: dict[int, list[Card]] = {} # tier -> list
        self._by_minion_type: dict[str, list[Minion]] = {}  # minionType -> list
        self._db_path = db_path

    def load(self):
        conn = get_cards_conn()
        rows = conn.execute("SELECT * FROM cards").fetchall()
        conn.close()

        self._cards.clear()
        self._by_type.clear()
        self._by_tier.clear()
        self._by_minion_type.clear()

        for row in rows:
            card = card_from_row(row)
            sid = card.str_id
            self._cards[sid] = card

            self._by_type.setdefault(card.card_type, []).append(card)

            tier = getattr(card, "tier", None) or 0
            if tier:
                self._by_tier.setdefault(tier, []).append(card)

            if isinstance(card, Minion):
                for mt in card.minion_types:
                    self._by_minion_type.setdefault(mt.lower(), []).append(card)

        return self

    @property
    def cards(self) -> dict[str, Card]:
        return self._cards

    def get(self, str_id: str) -> Card | None:
        return self._cards.get(str_id)

    def get_by_name(self, name: str) -> Card | None:
        """Fuzzy match by Chinese or English name."""
        for c in self._cards.values():
            if c.name_cn == name or c.name == name:
                return c
        for c in self._cards.values():
            if name in c.name_cn or name.lower() in c.name.lower():
                return c
        return None

    def by_type(self, card_type: str) -> list[Card]:
        return self._by_type.get(card_type, [])

    def by_tier(self, tier: int) -> list[Card]:
        return self._by_tier.get(tier, [])

    def by_minion_type(self, mtype: str) -> list[Minion]:
        return self._by_minion_type.get(mtype.lower(), [])

    def get_hero_powers(self, hero: Hero) -> list[HeroPower]:
        return [self.get(hpid) for hpid in hero.hp_ids if self.get(hpid)]

    def get_buddy(self, hero: Hero) -> Companion | None:
        if not hero.buddy_id:
            return None
        c = self.get(hero.buddy_id)
        return c if isinstance(c, Companion) else None

    def get_upgrade(self, minion: Minion) -> Minion | None:
        if not minion.upgrade_id:
            return None
        c = self.get(minion.upgrade_id)
        return c if isinstance(c, Minion) else None

    def search_fts(self, query: str) -> list[Card]:
        """Full-text search on Chinese name and text."""
        conn = get_cards_conn()
        try:
            rows = conn.execute(
                "SELECT str_id FROM cards_fts WHERE cards_fts MATCH ?",
                (query,),
            ).fetchall()
        except Exception:
            # FTS syntax error on special chars, fallback to LIKE
            rows = conn.execute(
                "SELECT str_id FROM cards WHERE name_cn LIKE ? OR text_cn LIKE ?",
                (f"%{query}%", f"%{query}%"),
            ).fetchall()
        conn.close()
        return [self._cards[r["str_id"]] for r in rows if r["str_id"] in self._cards]


_registry: CardRegistry | None = None


def get_registry(db_path: str = "bg_cards.db") -> CardRegistry:
    global _registry
    if _registry is None:
        _registry = CardRegistry(db_path).load()
    return _registry
