"""Meta data registry: hero win rates, comp strategies, trinket tips."""
import json
from .database import get_meta_conn


class MetaRegistry:
    def __init__(self, db_path: str = "bg_meta.db"):
        self.hero_stats: dict[str, dict] = {}
        self.hero_tips: dict[str, dict] = {}
        self.curves: list[dict] = []
        self.comp_strategies: list[dict] = []
        self.trinket_tips: dict[str, dict] = {}
        self._db_path = db_path

    def load(self):
        conn = get_meta_conn()

        for row in conn.execute("SELECT * FROM hero_stats"):
            h = dict(row)
            h["placement_dist"] = json.loads(h["placement_dist"])
            h["tribe_stats"] = json.loads(h["tribe_stats"])
            self.hero_stats[h["hero_card_id"]] = h

        for row in conn.execute("SELECT * FROM hero_strategies"):
            self.hero_tips[row["hero_card_id"]] = {
                "name": row["name"],
                "tips": json.loads(row["tips"]),
            }
            if not self.curves and row["curves"]:
                self.curves = json.loads(row["curves"])

        for row in conn.execute("SELECT * FROM comp_strategies"):
            c = dict(row)
            c["cards"] = json.loads(c["cards"])
            c["tips"] = json.loads(c["tips"])
            c["forced_tribes"] = json.loads(c["forced_tribes"])
            self.comp_strategies.append(c)

        for row in conn.execute("SELECT * FROM trinket_tips"):
            self.trinket_tips[row["trinket_card_id"]] = {
                "name": row["name"],
                "tips": json.loads(row["tips"]),
            }

        conn.close()
        return self

    def get_hero_stat(self, hero_card_id: str) -> dict | None:
        return self.hero_stats.get(hero_card_id)

    def get_hero_tips(self, hero_card_id: str) -> dict | None:
        return self.hero_tips.get(hero_card_id)

    def get_top_heroes(self, n: int = 10) -> list[dict]:
        scored = [(h["hero_card_id"], h["avg_position"], h["data_points"])
                  for h in self.hero_stats.values()
                  if h["data_points"] > 500]
        scored.sort(key=lambda x: x[1])
        return [{"hero_card_id": s[0], "avg_position": s[1], "data_points": s[2]} for s in scored[:n]]

    def get_placements(self, hero_card_id: str) -> list[dict]:
        stat = self.hero_stats.get(hero_card_id)
        if not stat:
            return []
        return stat["placement_dist"]

    def get_comp_strategies(self) -> list[dict]:
        return self.comp_strategies

    def get_comp_by_name(self, name: str) -> dict | None:
        for c in self.comp_strategies:
            if name in c.get("name", ""):
                return c
        return None

    def get_trinket_tips(self, trinket_card_id: str) -> dict | None:
        return self.trinket_tips.get(trinket_card_id)

    @property
    def hero_count(self) -> int:
        return len(self.hero_stats)

    @property
    def comp_count(self) -> int:
        return len(self.comp_strategies)


_meta_registry: MetaRegistry | None = None


def get_meta_registry(db_path: str = "bg_meta.db") -> MetaRegistry:
    global _meta_registry
    if _meta_registry is None:
        _meta_registry = MetaRegistry(db_path).load()
    return _meta_registry
