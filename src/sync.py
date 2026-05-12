"""Sync: fetch card data from Gamerhub API and import to SQLite."""
import json
import urllib.request
from .database import get_cards_conn, create_cards_table, import_cards

API_URL = "https://battlegrounds.gamerhub.cn/api/cards/get_full_cards"
CACHE_FILE = "bg_cards.json"


def fetch_cards() -> dict:
    req = urllib.request.Request(API_URL, headers={"User-Agent": "bg-strategy-tool/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sync(force: bool = False) -> dict:
    print("[sync] 获取卡牌数据...")
    data = fetch_cards()
    inner = data.get("data", data)

    version = inner.get("version", "unknown")
    categories = [k for k in inner if isinstance(inner[k], list) and len(inner[k]) > 0]

    print(f"[sync] 版本: {version}")
    print(f"[sync] 卡牌类别: {len(categories)}")
    for c in categories:
        print(f"  {c}: {len(inner[c])} 张")

    # Save cache
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[sync] 已缓存到 {CACHE_FILE}")

    # Import to DB
    conn = get_cards_conn()
    create_cards_table(conn)
    import_cards(conn, inner)
    conn.close()
    print("[sync] 已导入 SQLite")

    return {
        "version": version,
        "categories": {c: len(inner[c]) for c in categories},
    }


if __name__ == "__main__":
    sync()
