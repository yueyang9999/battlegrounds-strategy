"""Filter Firestone game JSON by date range.

Usage:
  python scripts/filter_games_by_date.py <input.json> <output.json> <from_date> [to_date]

  Dates in YYYY-MM-DD format.
  Outputs count: filtered / total.
"""
import json, sys

def filter_games(input_path, output_path, from_date, to_date=None):
    with open(input_path, 'r', encoding='utf-8') as f:
        games = json.load(f)

    filtered = []
    for g in games:
        d = g.get('date', g.get('creationTimestamp', ''))
        if not d:
            continue
        d10 = d[:10]  # YYYY-MM-DD
        if d10 >= from_date:
            if to_date is None or d10 <= to_date:
                filtered.append(g)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(filtered, f, ensure_ascii=False, indent=2)

    print(f"Filtered {len(filtered)}/{len(games)} games ({from_date}" +
          (f" ~ {to_date}" if to_date else " onward") + f") -> {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    from_d = sys.argv[3]
    to_d = sys.argv[4] if len(sys.argv) > 4 else None
    filter_games(sys.argv[1], sys.argv[2], from_d, to_d)
