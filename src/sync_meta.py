"""Sync: fetch meta data from Firestone/Zerotoheroes API and import to SQLite."""
import json
import urllib.request
from .database import get_meta_conn, create_meta_tables

HERO_STATS_URL = "https://static.zerotoheroes.com/api/bgs/hero-stats/mmr-{mmr}/{period}/overview-from-hourly.gz.json"
HERO_STRAT_URL = "https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-hero-strategies.gz.json"
COMP_STRAT_URL = "https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-comps-strategies.gz.json"
TRINKET_STRAT_URL = "https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-trinket-strategies.gz.json"


def _fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "bg-strategy-tool/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sync_hero_stats(conn, mmr: int = 100, period: str = "last-patch"):
    url = HERO_STATS_URL.format(mmr=mmr, period=period)
    print(f"[meta] 获取英雄环境数据... (MMR={mmr}, {period})")
    data = _fetch_json(url)

    hero_stats = data.get("heroStats", [])
    conn.execute("DELETE FROM hero_stats WHERE mmr_percentile=? AND time_period=?", (mmr, period))

    for h in hero_stats:
        conn.execute(
            """INSERT OR REPLACE INTO hero_stats VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                h["heroCardId"],
                h.get("dataPoints", 0),
                h.get("totalOffered", 0),
                h.get("totalPicked", 0),
                h.get("averagePosition", 0),
                h.get("standardDeviation", 0),
                json.dumps(h.get("placementDistribution", []), ensure_ascii=False),
                json.dumps(h.get("tribeStats", []), ensure_ascii=False),
                mmr,
                period,
                data.get("lastUpdateDate", ""),
            ),
        )

    conn.execute(
        "INSERT OR REPLACE INTO meta_info VALUES(?,?)",
        ("hero_stats_updated", data.get("lastUpdateDate", "")),
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta_info VALUES(?,?)",
        ("hero_stats_points", str(data.get("dataPoints", 0))),
    )
    conn.commit()
    print(f"[meta] 英雄数据: {len(hero_stats)} 个英雄, {data.get('dataPoints', 0)} 场对局")


def sync_hero_strategies(conn):
    print("[meta] 获取英雄策略数据...")
    data = _fetch_json(HERO_STRAT_URL)

    heroes = data.get("heroes", [])
    curves = data.get("curves", [])

    conn.execute("DELETE FROM hero_strategies")
    for h in heroes:
        conn.execute(
            "INSERT OR REPLACE INTO hero_strategies VALUES (?,?,?,?)",
            (
                h["cardId"],
                h.get("name", ""),
                json.dumps(h.get("tips", []), ensure_ascii=False),
                json.dumps(curves, ensure_ascii=False),
            ),
        )
    conn.commit()
    print(f"[meta] 英雄策略: {len(heroes)} 条, 曲线: {len(curves)} 种")


def sync_comp_strategies(conn):
    print("[meta] 获取阵容流派数据...")
    data = _fetch_json(COMP_STRAT_URL)

    conn.execute("DELETE FROM comp_strategies")
    for c in data:
        if not c.get("compId") or not c.get("cards"):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO comp_strategies VALUES (?,?,?,?,?,?,?,?)",
            (
                c.get("compId", ""),
                c.get("name", ""),
                str(c.get("patchNumber", "")),
                c.get("difficulty", ""),
                c.get("powerLevel", ""),
                json.dumps(c.get("forcedTribes", []), ensure_ascii=False),
                json.dumps(c.get("cards", []), ensure_ascii=False),
                json.dumps(c.get("tips", []), ensure_ascii=False),
            ),
        )
    conn.commit()
    print(f"[meta] 阵容流派: {len(data)} 套")


def sync_trinket_tips(conn):
    print("[meta] 获取饰品策略数据...")
    data = _fetch_json(TRINKET_STRAT_URL)

    conn.execute("DELETE FROM trinket_tips")
    for t in data:
        conn.execute(
            "INSERT OR REPLACE INTO trinket_tips VALUES (?,?,?)",
            (
                t["cardId"],
                t.get("name", ""),
                json.dumps(t.get("tips", []), ensure_ascii=False),
            ),
        )
    conn.commit()
    print(f"[meta] 饰品策略: {len(data)} 条")


def sync_meta(force: bool = False):
    conn = get_meta_conn()
    create_meta_tables(conn)

    sync_hero_stats(conn, mmr=100, period="last-patch")
    sync_hero_strategies(conn)
    sync_comp_strategies(conn)
    sync_trinket_tips(conn)

    conn.close()
    print("[meta] 全部环境数据同步完成")


if __name__ == "__main__":
    sync_meta()
