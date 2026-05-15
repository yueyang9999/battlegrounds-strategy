"""
Brute-force JSON extractor from LevelDB SST files.
Scans raw bytes for JSON objects, no LevelDB format parsing needed.
"""
import sys
import os
import json
import re

def extract_json_objects(data, min_len=40):
    """Find all valid JSON objects in binary data."""
    results = []
    i = 0
    while i < len(data):
        # Find next '{'
        brace_pos = data.find(b'{', i)
        if brace_pos == -1:
            break

        # Try to find matching '}'
        depth = 0
        in_string = False
        escape_next = False
        end_pos = -1

        for j in range(brace_pos, min(brace_pos + 100000, len(data))):
            b = data[j]

            if escape_next:
                escape_next = False
                continue

            if b == 0x5C:  # backslash
                escape_next = True
                continue

            if b == 0x22:  # double quote
                in_string = not in_string
                continue

            if not in_string:
                if b == 0x7B:  # '{'
                    depth += 1
                elif b == 0x7D:  # '}'
                    depth -= 1
                    if depth == 0:
                        end_pos = j
                        break

        if end_pos > brace_pos:
            chunk = data[brace_pos:end_pos + 1]
            try:
                obj = json.loads(chunk.decode('utf-8'))
                if isinstance(obj, dict) and len(obj) >= 2:
                    results.append(obj)
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

        i = brace_pos + 1

    return results

def is_game_record(obj):
    """Check if a JSON object looks like a game/match record."""
    keys = set(obj.keys()) if isinstance(obj, dict) else set()

    # Firestone possible match record keys
    match_keys = {'heroCardId', 'playerCardId', 'placement', 'damage', 'hero',
                  'rank', 'turn', 'mmr', 'rating', 'board', 'minions',
                  'cardId', 'heroes', 'gameMode', 'battlegrounds', 'tavernTier',
                  'fights', 'combatHistory', 'heroPower', 'startingHeroPower',
                  'opponent', 'won', 'lost'}

    if not keys:
        return False

    overlap = keys & match_keys
    return len(overlap) >= 2

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'

    ldb_files = sorted(
        [f for f in os.listdir(ldb_dir) if f.endswith('.ldb')],
        key=lambda x: int(x.replace('.ldb', ''))
    )

    print(f"Scanning {len(ldb_files)} .ldb files in {ldb_dir}")

    all_objects = []
    game_records = []

    for fname in ldb_files:
        fpath = os.path.join(ldb_dir, fname)
        size = os.path.getsize(fpath)
        if size < 500:
            continue

        with open(fpath, 'rb') as f:
            data = f.read()

        print(f"\n{ fname} ({size:,} bytes)...")

        objs = extract_json_objects(data)
        print(f"  JSON objects: {len(objs)}")

        for obj in objs:
            all_objects.append(obj)
            if is_game_record(obj):
                game_records.append((fname, obj))

    print(f"\n=== Summary ===")
    print(f"Total JSON objects found: {len(all_objects)}")
    print(f"Game-like records: {len(game_records)}")

    # Show non-trivial keys across all objects
    all_keys = {}
    for obj in all_objects[:500]:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k not in all_keys:
                    all_keys[k] = 0
                all_keys[k] += 1

    if all_keys:
        print(f"\n=== Top-level keys (frequency in first 500 objects) ===")
        for k, cnt in sorted(all_keys.items(), key=lambda x: -x[1])[:50]:
            print(f"  {k}: {cnt}")

    # Show game record samples
    if game_records:
        print(f"\n=== Game Record Samples ===")
        for i, (src, rec) in enumerate(game_records[:10]):
            print(f"\n--- Record {i+1} (from {src}) ---")
            # Show first 500 chars
            text = json.dumps(rec, ensure_ascii=False, indent=2)
            print(text[:600])
    else:
        # Show non-game objects that aren't too small
        print(f"\n=== Non-game record samples (first 10 meaningful objects) ===")
        shown = 0
        for obj in all_objects:
            if isinstance(obj, dict) and len(obj) >= 3:
                text = json.dumps(obj, ensure_ascii=False)
                if len(text) > 80 and len(text) < 1000:
                    print(f"\n[{shown}] ({len(text)} chars)")
                    print(text[:400])
                    shown += 1
                    if shown >= 10:
                        break

    # Save all game records
    if game_records:
        out_path = os.path.join(os.path.dirname(ldb_dir), 'firestone_game_records.json')
        recs = [r for _, r in game_records]
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=2)
        print(f"\nGame records saved to: {out_path}")


if __name__ == '__main__':
    main()
