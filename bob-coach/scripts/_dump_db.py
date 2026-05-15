"""Dump bg_player.db game_records to stdout as pipe-delimited text."""
import sqlite3, sys
db_path = sys.argv[1] if len(sys.argv) > 1 else "E:/claude_project/bg_player.db"
db = sqlite3.connect(db_path)
cur = db.cursor()
cur.execute("SELECT id,hero_card_id,placement,starting_comp,final_board,turn_actions,mmr_change,played_at FROM game_records")
for r in cur.fetchall():
    print("|".join(str(c or "") for c in r))
db.close()
