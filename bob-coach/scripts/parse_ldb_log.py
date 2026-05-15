# -*- coding: utf-8 -*-
"""
Parse LevelDB Write-Ahead Log (.log files).
Log records contain raw key-value puts — simpler than SST format.
Output to file instead of stdout to avoid Windows encoding issues.
"""
import struct
import sys
import os
import json

def read_varint32(data, pos):
    result = 0
    shift = 0
    while pos < len(data):
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, pos
        shift += 7
    return result, pos

BLOCK_SIZE = 32768

def parse_log_file(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()

    records = []
    pos = 0
    while pos + 7 <= len(data):
        checksum = struct.unpack('<I', data[pos:pos+4])[0]
        length = struct.unpack('<H', data[pos+4:pos+6])[0]
        rec_type = data[pos+6]
        pos += 7
        if length == 0 or pos + length > len(data):
            pos = ((pos - 7) // BLOCK_SIZE + 1) * BLOCK_SIZE
            continue
        record_data = data[pos:pos + length]
        pos += length
        records.append((rec_type, record_data))

    # Concatenate multi-part records
    combined = []
    current = b''
    for rec_type, rec_data in records:
        if rec_type == 1:  # FULL
            if current:
                combined.append(current)
                current = b''
            combined.append(rec_data)
        elif rec_type == 2:  # FIRST
            if current:
                combined.append(current)
            current = rec_data
        elif rec_type == 3:  # MIDDLE
            current += rec_data
        elif rec_type == 4:  # LAST
            current += rec_data
            combined.append(current)
            current = b''
    if current:
        combined.append(current)

    # Parse WriteBatch
    ops = []
    for batch_data in combined:
        if len(batch_data) < 12:
            continue
        seq = struct.unpack('<Q', batch_data[0:8])[0]
        count = struct.unpack('<I', batch_data[8:12])[0]
        pos = 12
        for _ in range(count):
            if pos >= len(batch_data):
                break
            op_type = batch_data[pos]
            pos += 1
            key_len, pos = read_varint32(batch_data, pos)
            if pos + key_len > len(batch_data):
                break
            key = batch_data[pos:pos + key_len]
            pos += key_len
            value = b''
            if op_type == 1:  # PUT
                value_len, pos = read_varint32(batch_data, pos)
                if pos + value_len > len(batch_data):
                    break
                value = batch_data[pos:pos + value_len]
                pos += value_len
            ops.append(dict(seq=seq, type='PUT' if op_type == 1 else 'DEL', key=key, value=value))
    return ops

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'
    log_files = sorted([f for f in os.listdir(ldb_dir) if f.endswith('.log')])

    out_lines = []
    out_lines.append(f"=== LevelDB WAL Parser ===")
    out_lines.append(f"Log files: {log_files}")

    all_ops = []
    for fname in log_files:
        fpath = os.path.join(ldb_dir, fname)
        size = os.path.getsize(fpath)
        ops = parse_log_file(fpath)
        out_lines.append(f"\n{fname} ({size:,} bytes): {len(ops)} ops")
        all_ops.extend(ops)

    out_lines.append(f"\n=== Total: {len(all_ops)} operations ===")
    out_lines.append("")

    puts = [op for op in all_ops if op['type'] == 'PUT']
    dels = [op for op in all_ops if op['type'] == 'DEL']
    out_lines.append(f"PUTs: {len(puts)}, DELs: {len(dels)}")

    # Sample keys
    out_lines.append("\n=== Sample PUTs (first 40) ===")
    for i, op in enumerate(puts[:40]):
        k_hex = op['key'][:50].hex()
        v_len = len(op['value'])
        v_text = ''
        try:
            v_text = op['value'][:100].decode('utf-8', errors='replace')
            v_text = ''.join(c if ord(c) >= 32 and ord(c) < 127 else '.' for c in v_text)
        except:
            pass
        out_lines.append(f"  [{i}] k={k_hex} v({v_len}b)={v_text}")

    # Find JSON values
    json_ops = []
    for op in puts:
        try:
            text = op['value'].decode('utf-8')
            if '{' in text and len(text) > 50:
                obj = json.loads(text)
                json_ops.append((op, obj))
        except:
            # Extract JSON substrings
            try:
                text = op['value'].decode('utf-8', errors='replace')
                start = text.find('{')
                if start >= 0:
                    depth = 0
                    for j in range(start, len(text)):
                        if text[j] == '{': depth += 1
                        elif text[j] == '}':
                            depth -= 1
                            if depth == 0:
                                obj = json.loads(text[start:j+1])
                                json_ops.append((op, obj))
                                break
            except:
                pass

    out_lines.append(f"\n=== Found {len(json_ops)} JSON values ===")

    # Analyze JSON keys
    key_counts = {}
    for _, obj in json_ops:
        if isinstance(obj, dict):
            for k in obj.keys():
                key_counts[k] = key_counts.get(k, 0) + 1
    out_lines.append("\nTop JSON keys:")
    for k, c in sorted(key_counts.items(), key=lambda x: -x[1])[:30]:
        out_lines.append(f"  {k}: {c}")

    # Game records
    game_keys = {'heroCardId', 'placement', 'board', 'rank', 'mmr', 'hero',
                 'minions', 'playerCardId', 'damage', 'turn', 'cardId',
                 'battlegrounds', 'heroPower', 'won', 'tavernTier'}
    game_records = []
    for op, obj in json_ops:
        if isinstance(obj, dict) and (set(obj.keys()) & game_keys):
            game_records.append(obj)

    out_lines.append(f"\n=== GAME RECORDS: {len(game_records)} ===")

    if game_records:
        # Save all
        out_path = 'E:/claude_project/bob-coach/data/_firestone_games.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(game_records, f, ensure_ascii=False, indent=2)
        out_lines.append(f"Saved to {out_path}")

        # Show samples
        out_lines.append("\n=== Game record samples ===")
        for i, rec in enumerate(game_records[:5]):
            out_lines.append(f"\n--- Game {i+1} ---")
            out_lines.append(json.dumps(rec, indent=2, ensure_ascii=False)[:600])
    else:
        # Show non-game JSON samples
        out_lines.append("\n=== Non-game JSON samples ===")
        shown = 0
        for op, obj in json_ops:
            if isinstance(obj, dict) and len(obj) >= 3:
                s = json.dumps(obj, ensure_ascii=False)
                if len(s) > 50 and len(s) < 500:
                    out_lines.append(f"\n[{shown}] {s[:400]}")
                    shown += 1
                    if shown >= 15:
                        break

    # Write output
    report = '\n'.join(out_lines)
    output_file = 'E:/claude_project/bob-coach/data/_wal_parse_report.txt'
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(report)
    print(report)


if __name__ == '__main__':
    main()
