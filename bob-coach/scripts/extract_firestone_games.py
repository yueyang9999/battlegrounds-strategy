"""
Extract Firestone game records from LevelDB.
Combines WAL parsing + SST scanning with Snappy decompression.
"""
import struct
import sys
import os
import json

try:
    from snappy import uncompress as snappy_decompress
except ImportError:
    import cramjam
    def snappy_decompress(data):
        return cramjam.snappy.decompress(data)

def read_varint32(data, pos):
    result = 0; shift = 0
    while pos < len(data):
        byte = data[pos]; pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80): return result, pos
        shift += 7
    return result, pos

BLOCK_SIZE = 32768

def parse_wal(filepath):
    """Parse LevelDB .log file, return list of (key, value) pairs."""
    with open(filepath, 'rb') as f:
        data = f.read()

    records = []
    pos = 0
    while pos + 7 <= len(data):
        length = struct.unpack('<H', data[pos+4:pos+6])[0]
        rec_type = data[pos+6]
        pos += 7
        if length == 0 or pos + length > len(data):
            pos = ((pos - 7) // BLOCK_SIZE + 1) * BLOCK_SIZE
            continue
        rec_data = data[pos:pos + length]
        pos += length
        records.append((rec_type, rec_data))

    combined = []
    current = b''
    for rt, rd in records:
        if rt == 1:
            if current: combined.append(current)
            combined.append(rd)
            current = b''
        elif rt == 2:
            if current: combined.append(current)
            current = rd
        elif rt == 3: current += rd
        elif rt == 4:
            current += rd
            combined.append(current)
            current = b''
    if current: combined.append(current)

    ops = []
    for batch in combined:
        if len(batch) < 12: continue
        count = struct.unpack('<I', batch[8:12])[0]
        pos = 12
        for _ in range(count):
            if pos >= len(batch): break
            op_type = batch[pos]; pos += 1
            key_len, pos = read_varint32(batch, pos)
            if pos + key_len > len(batch): break
            key = batch[pos:pos + key_len]; pos += key_len
            value = b''
            if op_type == 1:
                value_len, pos = read_varint32(batch, pos)
                if pos + value_len > len(batch): break
                value = batch[pos:pos + value_len]; pos += value_len
                ops.append((key, value))
    return ops

def extract_text_fields(value):
    """Extract readable field names and potential values from binary data."""
    chunks = []
    i = 0
    while i < len(value):
        if 32 <= value[i] < 127:
            start = i
            while i < len(value) and 32 <= value[i] < 127:
                i += 1
            chunk = value[start:i].decode('ascii', errors='replace')
            if len(chunk) >= 3:
                chunks.append(chunk)
        else:
            i += 1
    return chunks

def parse_firestone_record(chunks):
    """Try to extract structured game data from text chunks."""
    record = {}
    field_map = {
        'playerCardId': 'playerCardId',
        'opponentCardId': 'opponentCardId',
        'playerRank': 'playerRank',
        'newPlayerRank': 'newPlayerRank',
        'opponentRank': 'opponentRank',
        'additionalResult': 'additionalResult',
        'result': 'result',
        'creationTimestamp': 'creationTimestamp',
        'gameMode': 'gameMode',
        'gameFormat': 'gameFormat',
        'buildNumber': 'buildNumber',
    }

    i = 0
    while i < len(chunks):
        chunk = chunks[i]
        # Check if this chunk is a field name
        for field_key, field_name in field_map.items():
            if chunk == field_name:
                # Next chunk(s) might contain the value
                if i + 1 < len(chunks):
                    val = chunks[i + 1]
                    # Clean up value - remove leading garbage
                    # Filter to just digits or reasonable text
                    val_clean = val.lstrip('"\'')
                    if val_clean:
                        record[field_key] = val_clean
                i += 2
                break
        else:
            i += 1

    return record

def scan_sst_for_records(filepath):
    """Scan SST file for game records by trying Snappy decompress at various offsets."""
    with open(filepath, 'rb') as f:
        data = f.read()

    results = []

    # Snappy-compressed blocks start at various offsets
    # Try decompressing from every 4KB-aligned offset
    for offset in range(0, len(data) - 100, 4096):
        # Try different block sizes
        for size_guess in [200, 500, 1000, 2000, 4000, 8000, 16000]:
            if offset + size_guess > len(data):
                continue
            try:
                chunk = data[offset:offset + size_guess]
                decompressed = snappy_decompress(chunk)
                text_fields = extract_text_fields(decompressed)
                if len(text_fields) >= 5:
                    # Check if looks like a game record
                    text_set = set(text_fields)
                    game_markers = {'playerCardId', 'playerRank', 'additionalResult', 'battlegrounds'}
                    if text_set & game_markers:
                        record = parse_firestone_record(text_fields)
                        if record:
                            results.append(record)
            except:
                pass

    return results

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'

    all_games = []

    # 1. Extract from WAL files
    log_files = sorted([f for f in os.listdir(ldb_dir) if f.endswith('.log')])
    for fname in log_files:
        fpath = os.path.join(ldb_dir, fname)
        print(f"Parsing WAL: {fname}...")
        ops = parse_wal(fpath)
        for key, value in ops:
            if len(value) < 200:
                continue
            chunks = extract_text_fields(value)
            game_markers = {'playerCardId', 'battlegrounds', 'additionalResult'}
            if set(chunks) & game_markers:
                record = parse_firestone_record(chunks)
                if record:
                    all_games.append(('wal', record))

    print(f"WAL games: {len(all_games)}")

    # 2. Scan SST files with Snappy decompression
    ldb_files = sorted([f for f in os.listdir(ldb_dir) if f.endswith('.ldb')],
                       key=lambda x: int(x.replace('.ldb', '')))
    for fname in ldb_files:
        fpath = os.path.join(ldb_dir, fname)
        size = os.path.getsize(fpath)
        print(f"Scanning SST: {fname} ({size//1024}KB)...")
        records = scan_sst_for_records(fpath)
        for r in records:
            r['_source_file'] = fname
        all_games.extend(('sst', r) for r in records)
        print(f"  Found {len(records)} game records")

    print(f"\n=== Total game records: {len(all_games)} ===")

    # Deduplicate by (playerCardId, playerRank)
    unique = {}
    for src, rec in all_games:
        key = (rec.get('playerCardId', ''), rec.get('playerRank', ''))
        if key not in unique:
            unique[key] = rec

    games = list(unique.values())
    print(f"Unique records: {len(games)}")

    if games:
        # Save
        out_path = 'E:/claude_project/bob-coach/data/_firestone_games.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(games, f, ensure_ascii=False, indent=2)
        print(f"\nSaved to {out_path}")

        # Show samples
        print("\n=== Game record samples ===")
        for i, rec in enumerate(games[:10]):
            print(f"\n[{i}] {json.dumps(rec, ensure_ascii=False)}")


if __name__ == '__main__':
    main()
