"""Firestone local cache name lookup.

Reads the user's Firestone card cache to provide Chinese name
fallback for card IDs that are not in our gamerhub database.
"""

import json
import os

_FS_CACHE_DIR = os.path.join(
    os.environ["APPDATA"],
    "Overwolf",
    "lnknbakkpommmjjdnelmfbjjdbocfpnpbkijjnob",
)

_name_map: dict[str, str] | None = None


def _load():
    global _name_map
    if _name_map is not None:
        return
    _name_map = {}
    cards_path = os.path.join(_FS_CACHE_DIR, "cards_zhCN.gz.json")
    if not os.path.exists(cards_path):
        return
    try:
        with open(cards_path, "r", encoding="utf-8") as f:
            cards = json.load(f)
        if isinstance(cards, list):
            for c in cards:
                cid = c.get("id")
                name = c.get("name")
                if cid and name:
                    _name_map[cid] = name
    except (json.JSONDecodeError, OSError):
        pass


def get_name(card_id: str) -> str:
    """Return Firestone Chinese name for card_id, or '' if not found."""
    _load()
    return (_name_map or {}).get(card_id, "")
