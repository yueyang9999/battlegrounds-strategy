"""玩家对战记录统计模块。

记录个人游戏数据，计算个人统计数据，支持两种推荐模式：
- 个人风格: 根据历史数据推荐玩家最擅长的打法
- 上分模式: 结合 Firestone 环境数据推荐上分最优解 (另由 meta 模块提供)
"""

import json
import os
import re

from .database import get_player_conn

_FS_CACHE_DIR = os.path.join(
    os.environ["APPDATA"],
    "Overwolf",
    "lnknbakkpommmjjdnelmfbjjdbocfpnpbkijjnob",
)


class PlayerStats:
    """玩家个人统计数据。"""

    def __init__(self, db_path: str = "bg_player.db"):
        self.db_path = db_path

    def _conn(self):
        """获取玩家数据库连接。"""
        return get_player_conn()

    def record_game(self, hero_card_id: str, placement: int,
                    starting_comp: str = "",
                    final_board: list | None = None,
                    turn_actions: dict | None = None,
                    mmr_change: int = 0) -> int:
        """记录一局游戏，返回新纪录的 id。"""
        conn = self._conn()
        try:
            fb = json.dumps(final_board, ensure_ascii=False) if final_board is not None else '[]'
            ta = json.dumps(turn_actions, ensure_ascii=False) if turn_actions is not None else '{}'
            cur = conn.execute(
                """INSERT INTO game_records (hero_card_id, placement, starting_comp, final_board, turn_actions, mmr_change)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (hero_card_id, placement, starting_comp, fb, ta, mmr_change),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_hero_stats(self) -> list[dict]:
        """按英雄聚合统计，返回列表按 avg_placement 升序排列。

        每项包含: hero_card_id, games_played, avg_placement, top4_count, top1_count
        """
        conn = self._conn()
        try:
            rows = conn.execute("""
                SELECT
                    hero_card_id,
                    COUNT(*) AS games_played,
                    ROUND(AVG(placement), 2) AS avg_placement,
                    SUM(CASE WHEN placement <= 4 THEN 1 ELSE 0 END) AS top4_count,
                    SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) AS top1_count
                FROM game_records
                GROUP BY hero_card_id
                ORDER BY avg_placement ASC
            """).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_summary(self) -> dict:
        """返回汇总统计。

        Keys: total_games, favorite_hero_id (最多场次), best_hero_id (场均排名最低且>=3场),
              best_hero_avg, top4_rate, top1_rate
        """
        conn = self._conn()
        try:
            total = conn.execute("SELECT COUNT(*) FROM game_records").fetchone()[0]

            if total == 0:
                return {
                    "total_games": 0,
                    "favorite_hero_id": None,
                    "best_hero_id": None,
                    "best_hero_avg": None,
                    "top4_rate": None,
                    "top1_rate": None,
                }

            # 最常用英雄
            fav = conn.execute("""
                SELECT hero_card_id, COUNT(*) AS cnt
                FROM game_records
                GROUP BY hero_card_id
                ORDER BY cnt DESC
                LIMIT 1
            """).fetchone()
            favorite_hero_id = fav["hero_card_id"] if fav else None

            # 最佳英雄 (场均排名最低，至少3场)
            best = conn.execute("""
                SELECT hero_card_id, ROUND(AVG(placement), 2) AS avg_p
                FROM game_records
                GROUP BY hero_card_id
                HAVING COUNT(*) >= 3
                ORDER BY avg_p ASC
                LIMIT 1
            """).fetchone()
            best_hero_id = best["hero_card_id"] if best else None
            best_hero_avg = best["avg_p"] if best else None

            top4 = conn.execute(
                "SELECT COUNT(*) FROM game_records WHERE placement <= 4"
            ).fetchone()[0]
            top1 = conn.execute(
                "SELECT COUNT(*) FROM game_records WHERE placement = 1"
            ).fetchone()[0]

            return {
                "total_games": total,
                "favorite_hero_id": favorite_hero_id,
                "best_hero_id": best_hero_id,
                "best_hero_avg": best_hero_avg,
                "top4_rate": round(top4 / total, 3),
                "top1_rate": round(top1 / total, 3),
            }
        finally:
            conn.close()

    def get_card_stats(self, limit: int = 50) -> list[dict]:
        """解析所有对局的 final_board JSON，统计卡牌出现次数。

        返回 [{card_id, count}] 按 count DESC 排列，最多 limit 条。
        """
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT final_board FROM game_records WHERE final_board != '[]'"
            ).fetchall()

            card_counts: dict[str, int] = {}
            for r in rows:
                try:
                    cards = json.loads(r["final_board"])
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(cards, list):
                    for cid in cards:
                        if isinstance(cid, str):
                            card_counts[cid] = card_counts.get(cid, 0) + 1

            sorted_stats = sorted(card_counts.items(), key=lambda x: x[1], reverse=True)
            return [{"card_id": cid, "count": cnt} for cid, cnt in sorted_stats[:limit]]
        finally:
            conn.close()

    def get_recent_games(self, limit: int = 20) -> list[dict]:
        """返回最近 N 场对局，按时间倒序。"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM game_records ORDER BY played_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def import_from_firestone(self) -> dict:
        """从 Firestone 本地缓存导入对局记录。

        返回 {"new": N, "skipped": M, "errors": E}。
        """
        import time
        history_path = os.path.join(_FS_CACHE_DIR, "user-match-history.json")
        if not os.path.exists(history_path):
            return {"new": 0, "skipped": 0, "errors": 0, "msg": "Firestone 数据文件不存在"}

        with open(history_path, "r", encoding="utf-8") as f:
            matches = json.load(f)

        conn = self._conn()
        new_count = 0
        skipped = 0
        errors = 0

        existing = set()
        for r in conn.execute("SELECT hero_card_id, placement, played_at FROM game_records").fetchall():
            existing.add((r["hero_card_id"], r["placement"], r["played_at"]))

        def norm_hero(hid: str) -> str:
            return re.sub(r"_SKIN_\w+", "", hid) if hid else ""

        inserts = []
        for m in matches:
            try:
                hero_id = norm_hero(m.get("playerCardId", ""))
                placement_str = m.get("additionalResult", "")
                if not hero_id or not placement_str:
                    continue
                placement = int(placement_str)

                ts = m.get("creationTimestamp", 0)
                if ts:
                    played_at = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts / 1000))
                else:
                    continue

                if (hero_id, placement, played_at) in existing:
                    skipped += 1
                    continue

                old_rank = m.get("playerRank", "0")
                new_rank = m.get("newPlayerRank", "0")
                try:
                    mmr_change = int(new_rank) - int(old_rank)
                except (ValueError, TypeError):
                    mmr_change = 0

                final_board = []
                pms = m.get("postMatchStats")
                if pms:
                    bh = pms.get("boardHistory", [])
                    if bh and isinstance(bh, list):
                        last_turn = bh[-1]
                        if isinstance(last_turn, dict):
                            board_list = last_turn.get("board", [])
                            if isinstance(board_list, list):
                                final_board = [b.get("cardID", "") for b in board_list if b.get("cardID")]

                inserts.append((
                    hero_id, placement, "",
                    json.dumps(final_board, ensure_ascii=False),
                    "{}", mmr_change, played_at,
                ))
                existing.add((hero_id, placement, played_at))
                new_count += 1
            except Exception:
                errors += 1

        if inserts:
            conn.executemany(
                """INSERT INTO game_records (hero_card_id, placement, starting_comp, final_board, turn_actions, mmr_change, played_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                inserts,
            )
            conn.commit()
        conn.close()
        return {"new": new_count, "skipped": skipped, "errors": errors}

    def get_comp_stats(self) -> list[dict]:
        """按流派 (starting_comp) 聚合统计。

        返回 [{comp_label, games, avg_placement, top4_count}] 按 games DESC 排列。
        """
        conn = self._conn()
        try:
            rows = conn.execute("""
                SELECT
                    starting_comp AS comp_label,
                    COUNT(*) AS games,
                    ROUND(AVG(placement), 2) AS avg_placement,
                    SUM(CASE WHEN placement <= 4 THEN 1 ELSE 0 END) AS top4_count
                FROM game_records
                WHERE starting_comp != ''
                GROUP BY starting_comp
                ORDER BY games DESC
            """).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_hero_comp_breakdown(self, hero_card_id: str) -> list[dict]:
        """分析某个英雄在各流派下的表现。

        通过 final_board 卡牌匹配已知流派，返回 [{comp_name, games, avg_placement, top4_rate}]
        按 games DESC 排序。
        """
        from .meta_registry import get_meta_registry

        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT final_board, placement FROM game_records
                   WHERE hero_card_id = ? AND final_board != '[]'""",
                (hero_card_id,),
            ).fetchall()
        finally:
            conn.close()

        if not rows:
            return []

        meta = get_meta_registry()
        comps = meta.comp_strategies
        if not comps:
            return []

        comp_sets = {}
        for c in comps:
            card_ids = {cc["cardId"] for cc in (c.get("cards") or []) if cc.get("cardId")}
            if card_ids:
                comp_sets[c["name"]] = card_ids

        if not comp_sets:
            return []

        comp_stats: dict[str, list[int]] = {}

        for row in rows:
            try:
                board = json.loads(row["final_board"])
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(board, list) or not board:
                continue
            board_set = set(board)

            best_comp = None
            best_score = 0
            for cname, ccards in comp_sets.items():
                overlap = len(board_set & ccards)
                if overlap > best_score:
                    best_score = overlap
                    best_comp = cname

            if best_comp and best_score >= 2:
                comp_stats.setdefault(best_comp, []).append(row["placement"])

        result = []
        for cname, placements in comp_stats.items():
            games = len(placements)
            avg = round(sum(placements) / games, 2)
            top4 = sum(1 for p in placements if p <= 4)
            result.append({
                "comp_name": cname,
                "games": games,
                "avg_placement": avg,
                "top4_rate": round(top4 / games * 100, 1),
            })

        result.sort(key=lambda x: x["games"], reverse=True)
        return result

    def get_prediction(self, hero_card_id: str, comp_name: str = "") -> dict:
        """预测某个英雄（可选指定流派）的排名分布。

        返回 {hero_card_id, games, avg_placement, top4_rate, top1_rate,
               placement_dist: [{rank, count, percentage}],
               best_comps: [{comp_name, games, avg_placement}]}
        """
        conn = self._conn()
        try:
            if comp_name:
                # Filter by comp matching via final_board
                from .meta_registry import get_meta_registry
                meta = get_meta_registry()
                comp = next((c for c in meta.comp_strategies if c["name"] == comp_name), None)
                if not comp:
                    return {"games": 0, "msg": f"未找到流派: {comp_name}"}
                comp_cards = {cc["cardId"] for cc in (comp.get("cards") or []) if cc.get("cardId")}

                all_rows = conn.execute(
                    """SELECT placement, final_board FROM game_records
                       WHERE hero_card_id = ? AND final_board != '[]'""",
                    (hero_card_id,),
                ).fetchall()

                placements = []
                for row in all_rows:
                    try:
                        board = set(json.loads(row["final_board"]))
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if len(board & comp_cards) >= 2:
                        placements.append(row["placement"])
            else:
                rows = conn.execute(
                    "SELECT placement FROM game_records WHERE hero_card_id = ?",
                    (hero_card_id,),
                ).fetchall()
                placements = [r["placement"] for r in rows]
        finally:
            conn.close()

        if not placements:
            return {"games": 0, "msg": "无匹配数据"}

        games = len(placements)
        avg = round(sum(placements) / games, 2)
        top4 = sum(1 for p in placements if p <= 4)
        top1 = sum(1 for p in placements if p == 1)

        dist = []
        from collections import Counter
        counter = Counter(placements)
        for rank in range(1, 9):
            cnt = counter.get(rank, 0)
            dist.append({"rank": rank, "count": cnt, "percentage": round(cnt / games * 100, 1)})

        best_comps = self.get_hero_comp_breakdown(hero_card_id)[:5]

        return {
            "hero_card_id": hero_card_id,
            "comp_name": comp_name,
            "games": games,
            "avg_placement": avg,
            "top4_rate": round(top4 / games * 100, 1),
            "top1_rate": round(top1 / games * 100, 1),
            "placement_dist": dist,
            "best_comps": best_comps,
        }


# 模块级单例
_player_stats: PlayerStats | None = None


def get_player_stats(db_path: str = "bg_player.db") -> PlayerStats:
    global _player_stats
    if _player_stats is None:
        _player_stats = PlayerStats(db_path)
    return _player_stats
