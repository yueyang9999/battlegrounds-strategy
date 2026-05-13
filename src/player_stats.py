"""玩家对战记录统计模块。

记录个人游戏数据，计算个人统计数据，支持两种推荐模式：
- 个人风格: 根据历史数据推荐玩家最擅长的打法
- 上分模式: 结合 Firestone 环境数据推荐上分最优解 (另由 meta 模块提供)
"""

import json

from .database import get_player_conn


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


# 模块级单例
_player_stats: PlayerStats | None = None


def get_player_stats(db_path: str = "bg_player.db") -> PlayerStats:
    global _player_stats
    if _player_stats is None:
        _player_stats = PlayerStats(db_path)
    return _player_stats
