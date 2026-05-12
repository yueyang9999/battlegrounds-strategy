"""SQLite schema for BG cards and meta data."""
import sqlite3

CARDS_DB = "bg_cards.db"
META_DB = "bg_meta.db"


def get_cards_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(CARDS_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA encoding='UTF-8'")
    return conn


def get_meta_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(META_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA encoding='UTF-8'")
    return conn


def create_cards_table(conn: sqlite3.Connection):
    conn.execute("DROP TABLE IF EXISTS cards")
    conn.execute("""
        CREATE TABLE cards (
            id         INTEGER NOT NULL,
            str_id     TEXT PRIMARY KEY,
            card_type  TEXT NOT NULL,
            name       TEXT,
            name_cn    TEXT,
            text_cn    TEXT,
            mechanics  TEXT,
            ref_tags   TEXT,
            img        TEXT,
            art        TEXT,

            -- minion / companion
            tier       INTEGER,
            attack     INTEGER,
            health     INTEGER,
            minion_types    TEXT,
            minion_types_cn TEXT,
            upgrade_id      TEXT,

            -- hero
            armor      INTEGER,
            hp_ids     TEXT,
            buddy_id   TEXT,

            -- heroPower
            mana_cost  INTEGER,

            -- companion specific
            buddy_hero_id TEXT,
            buddy_hp_id   TEXT,

            -- trinket / timewarp
            lesser     INTEGER,
            extra      TEXT,

            -- quest / reward / anomaly: only common fields
            card_type_group TEXT
        )
    """)

    # FTS5 for Chinese search
    conn.execute("DROP TABLE IF EXISTS cards_fts")
    conn.execute("CREATE VIRTUAL TABLE cards_fts USING fts5(name_cn, text_cn, content=cards, content_rowid=rowid)")

    # Meta info for version tracking
    conn.execute("DROP TABLE IF EXISTS meta_info")
    conn.execute("CREATE TABLE meta_info (key TEXT PRIMARY KEY, value TEXT)")

    conn.execute("""
        CREATE TRIGGER cards_ai AFTER INSERT ON cards BEGIN
            INSERT INTO cards_fts(rowid, name_cn, text_cn) VALUES (new.rowid, new.name_cn, new.text_cn);
        END
    """)
    conn.execute("""
        CREATE TRIGGER cards_ad AFTER DELETE ON cards BEGIN
            INSERT INTO cards_fts(cards_fts, rowid, name_cn, text_cn) VALUES ('delete', old.rowid, old.name_cn, old.text_cn);
        END
    """)
    conn.execute("""
        CREATE TRIGGER cards_au AFTER UPDATE ON cards BEGIN
            INSERT INTO cards_fts(cards_fts, rowid, name_cn, text_cn) VALUES ('delete', old.rowid, old.name_cn, old.text_cn);
            INSERT INTO cards_fts(rowid, name_cn, text_cn) VALUES (new.rowid, new.name_cn, new.text_cn);
        END
    """)


def create_meta_tables(conn: sqlite3.Connection):
    conn.executescript("""
        DROP TABLE IF EXISTS hero_stats;
        CREATE TABLE hero_stats (
            hero_card_id    TEXT PRIMARY KEY,
            data_points     INTEGER,
            total_offered   INTEGER,
            total_picked    INTEGER,
            avg_position    REAL,
            std_dev         REAL,
            placement_dist  TEXT,
            tribe_stats     TEXT,
            mmr_percentile  INTEGER,
            time_period     TEXT,
            updated_at      TEXT
        );

        DROP TABLE IF EXISTS comp_strategies;
        CREATE TABLE comp_strategies (
            comp_id      TEXT PRIMARY KEY,
            name         TEXT,
            patch        TEXT,
            difficulty   TEXT,
            power_level  TEXT,
            forced_tribes TEXT,
            cards        TEXT,
            tips         TEXT
        );

        DROP TABLE IF EXISTS hero_strategies;
        CREATE TABLE hero_strategies (
            hero_card_id TEXT PRIMARY KEY,
            name         TEXT,
            tips         TEXT,
            curves       TEXT
        );

        DROP TABLE IF EXISTS trinket_tips;
        CREATE TABLE trinket_tips (
            trinket_card_id TEXT PRIMARY KEY,
            name            TEXT,
            tips            TEXT
        );

        DROP TABLE IF EXISTS meta_info;
        CREATE TABLE meta_info (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    """)


def import_cards(conn: sqlite3.Connection, data: dict):
    """Import all 10 card categories from Gamerhub API response."""
    import json as _json

    category_map = {
        "minion": "minion",
        "hero": "hero",
        "heroPower": "hero_power",
        "companion": "companion",
        "tavern": "tavern",
        "quest": "quest",
        "baconquestreward": "reward",
        "anomaly": "anomaly",
        "trinket": "trinket",
        "timewarp": "timewarp",
    }

    api_cats = data.get("data", data)

    for api_key, group in category_map.items():
        items = api_cats.get(api_key, [])
        if not items:
            continue
        for card in items:
            conn.execute(
                """INSERT OR REPLACE INTO cards VALUES (
                    ?,?,?,?,?,?,?,?,?,?,
                    ?,?,?,?,?,?,
                    ?,?,?,
                    ?,?,?,?,?,
                    ?
                )""",
                _build_card_row(card, group),
            )

    conn.execute(
        "INSERT OR REPLACE INTO meta_info VALUES('version', ?)",
        (api_cats.get("version", ""),),
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta_info VALUES('last_update', ?)",
        (str(api_cats.get("lastUpdateTime", "")),),
    )

    conn.commit()


def _build_card_row(card: dict, group: str):
    import json as _json

    def js(v):
        return _json.dumps(v, ensure_ascii=False) if isinstance(v, list) else (v or "")

    return (
        card.get("id", 0),
        card.get("strId", ""),
        group,
        card.get("name", ""),
        card.get("nameCN", ""),
        card.get("text", ""),
        js(card.get("mechanics", [])),
        js(card.get("referencedTags", [])),
        card.get("img", ""),
        card.get("art", ""),
        card.get("tier"),
        card.get("attack"),
        card.get("health"),
        js(card.get("minionTypes", [])),
        js(card.get("minionTypesCN", [])),
        card.get("upgradeCard", {}).get("strId") if isinstance(card.get("upgradeCard"), dict) else card.get("upgradeCard"),
        card.get("armor"),
        js([hp.get("strId") for hp in card.get("heroPowerList", []) if isinstance(hp, dict)]),
        card.get("buddy", {}).get("strId") if isinstance(card.get("buddy"), dict) else card.get("buddy"),
        card.get("manaCost"),
        card.get("buddyHero", {}).get("strId") if isinstance(card.get("buddyHero"), dict) else card.get("buddyHero"),
        card.get("buddyHeroPower", {}).get("strId") if isinstance(card.get("buddyHeroPower"), dict) else card.get("buddyHeroPower"),
        1 if card.get("lesser") else (0 if card.get("lesser") is False else None),
        js(card.get("trinketTags") or card.get("timeWarpTags") or []),
        group,
    )
