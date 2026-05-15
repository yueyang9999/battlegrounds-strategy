# -*- coding: utf-8 -*-
"""
Extract Firestone game records from LevelDB WAL + SST files.
Handles Firestone's binary serialization format.
"""
import struct
import sys
import os
import json
import re
import datetime

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

LEVELDB_MAGIC = bytes([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb])

# ── WAL Parsing ──

def parse_wal_values(filepath):
    """Parse LevelDB WAL and return all PUT values."""
    with open(filepath, 'rb') as f:
        data = f.read()

    BLOCK_SIZE = 32768
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
            combined.append(rd); current = b''
        elif rt == 2:
            if current: combined.append(current)
            current = rd
        elif rt == 3: current += rd
        elif rt == 4:
            current += rd; combined.append(current); current = b''
    if current: combined.append(current)

    values = []
    for batch in combined:
        if len(batch) < 12: continue
        count = struct.unpack('<I', batch[8:12])[0]
        bp = 12
        for _ in range(count):
            if bp >= len(batch): break
            op_type = batch[bp]; bp += 1
            key_len, bp = read_varint32(batch, bp)
            if bp + key_len > len(batch): break
            key = batch[bp:bp + key_len]; bp += key_len
            if op_type == 1:
                value_len, bp = read_varint32(batch, bp)
                if bp + value_len > len(batch): break
                value = batch[bp:bp + value_len]; bp += value_len
                values.append((key, value))
    return values

# ── Firestone Binary Record Parsing ──

def parse_firestone_value(value):
    """
    Parse a Firestone game record from binary value.
    Format: [header][fields...]
    Field: [name_len:varint?][name][type_byte][value]
      type 0x22 = string: [1-byte len][string]
      type 0x49 = int32: [4-byte LE]
      type 0x4E = double: [8-byte LE]
    """
    if len(value) < 20:
        return None

    # Skip header (scan for first field marker)
    # Fields start after a variable-length header.
    # A field name starts with an ASCII letter (0x61-0x7A).
    # Find the first field that looks like a known key.

    known_fields = [
        b'playerCardId', b'opponentCardId', b'playerRank', b'newPlayerRank',
        b'opponentRank', b'additionalResult', b'result', b'creationTimestamp',
        b'gameMode', b'gameFormat', b'buildNumber', b'playerClass',
        b'opponentClass', b'playerName', b'opponentName',
        b'reviewId', b'coinPlay', b'playerDeckName', b'playerDecklist',
    ]

    result = {}

    for field_name in known_fields:
        pos = value.find(field_name)
        if pos < 0:
            continue

        # Skip field name
        data_pos = pos + len(field_name)
        if data_pos >= len(value):
            continue

        type_byte = value[data_pos]
        data_pos += 1

        if type_byte == 0x22:  # String
            if data_pos >= len(value):
                continue
            str_len = value[data_pos]
            data_pos += 1
            if data_pos + str_len > len(value):
                continue
            str_val = value[data_pos:data_pos + str_len].decode('utf-8', errors='replace')
            result[field_name.decode()] = str_val

        elif type_byte == 0x49:  # Int32
            if data_pos + 4 > len(value):
                continue
            int_val = struct.unpack('<i', value[data_pos:data_pos + 4])[0]
            data_pos += 4
            result[field_name.decode()] = int_val

        elif type_byte == 0x4E:  # Double (timestamp)
            if data_pos + 8 > len(value):
                continue
            double_val = struct.unpack('<d', value[data_pos:data_pos + 8])[0]
            data_pos += 8
            # Convert JS timestamp (ms) to date
            if 'Timestamp' in field_name.decode():
                try:
                    dt = datetime.datetime.utcfromtimestamp(double_val / 1000)
                    result[field_name.decode()] = dt.strftime('%Y-%m-%d %H:%M:%S')
                except:
                    result[field_name.decode()] = double_val
            else:
                result[field_name.decode()] = double_val

    # Map to our standard format
    if 'playerCardId' in result:
        return simplify_record(result)
    return None

def simplify_record(raw):
    """Map Firestone fields to standard game record format."""
    mmr = None
    try:
        if 'playerRank' in raw:
            mmr = int(raw['playerRank'])
    except:
        pass

    new_mmr = None
    try:
        if 'newPlayerRank' in raw:
            new_mmr = int(raw['newPlayerRank'])
    except:
        pass

    placement = None
    try:
        if 'additionalResult' in raw:
            placement = int(raw['additionalResult'])
    except:
        pass

    return {
        'hero': raw.get('playerCardId', ''),
        'placement': placement,
        'mmr': mmr,
        'newMmr': new_mmr,
        'mmrChange': (new_mmr - mmr) if mmr is not None and new_mmr is not None else None,
        'result': raw.get('result', ''),
        'date': raw.get('creationTimestamp', ''),
        'opponentHero': raw.get('opponentCardId', ''),
        '_raw': raw,
    }

# ── SST Parsing (with Snappy) ──

def read_varint64(data, pos):
    result = 0; shift = 0
    while pos < len(data):
        byte = data[pos]; pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80): return result, pos
        shift += 7
    return result, pos

def parse_sst_values(filepath):
    """Parse SST file with Snappy decompression for data blocks."""
    with open(filepath, 'rb') as f:
        data = f.read()

    if len(data) < 48:
        return []

    # Find footer
    mag_pos = data.rfind(LEVELDB_MAGIC)
    if mag_pos < 0:
        return []

    footer = data[mag_pos - 40:mag_pos + 8]
    pos = 0
    _, pos = read_varint64(footer, pos)  # metaindex offset
    _, pos = read_varint64(footer, pos)  # metaindex size
    index_offset, pos = read_varint64(footer, pos)
    index_size, pos = read_varint64(footer, pos)

    # Read index block entries
    idx_end = index_offset + index_size
    # Try to decompress if first bytes don't look like entry data
    idx_raw = data[index_offset:idx_end]
    try:
        idx_decomp = snappy_decompress(idx_raw)
        idx_raw = idx_decomp
        idx_end_real = len(idx_raw)
    except:
        idx_end_real = idx_size

    # Parse block handles from index
    block_handles = []
    pos = 0
    key_buf = bytearray()
    while pos < idx_end_real - 4:
        shared, pos2 = read_varint32(idx_raw, pos)
        if pos2 == pos: break
        pos = pos2
        unshared, pos2 = read_varint32(idx_raw, pos)
        if pos2 == pos: break
        pos = pos2
        vlen, pos2 = read_varint32(idx_raw, pos)
        if pos2 == pos: break
        pos = pos2
        if pos + unshared + vlen > idx_end_real - 5:
            break
        key_buf = key_buf[:shared]
        key_buf.extend(idx_raw[pos:pos + unshared])
        pos += unshared
        value = idx_raw[pos:pos + vlen]
        pos += vlen
        vp = 0
        blk_off, vp = read_varint64(value, vp)
        blk_sz, vp = read_varint64(value, vp)
        block_handles.append((blk_off, blk_sz))

    # Read each data block
    values = []
    for blk_off, blk_sz in block_handles:
        if blk_off + 5 > len(data):
            continue
        raw = data[blk_off:blk_off + blk_sz]
        # Try decompression
        try:
            decompressed = snappy_decompress(raw)
        except:
            decompressed = raw

        if len(decompressed) < 50:
            continue

        # Parse entries from decompressed block
        pos = 0
        key_buf = bytearray()
        while pos < len(decompressed) - 10:
            shared, pos2 = read_varint32(decompressed, pos)
            if pos2 == pos: break
            pos = pos2
            unshared, pos2 = read_varint32(decompressed, pos)
            if pos2 == pos: break
            pos = pos2
            vlen, pos2 = read_varint32(decompressed, pos)
            if pos2 == pos: break
            pos = pos2
            if pos + unshared + vlen > len(decompressed):
                break
            key_buf = key_buf[:shared]
            key_buf.extend(decompressed[pos:pos + unshared])
            pos += unshared
            entry_value = decompressed[pos:pos + vlen]
            pos += vlen
            values.append((bytes(key_buf), entry_value))

    return values

# ── Main ──

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'

    all_values = []

    # Parse WAL
    log_files = sorted([f for f in os.listdir(ldb_dir) if f.endswith('.log')])
    for fname in log_files:
        fpath = os.path.join(ldb_dir, fname)
        print(f"WAL: {fname}...")
        vals = parse_wal_values(fpath)
        all_values.extend(vals)
        print(f"  {len(vals)} values")

    # Parse SST
    ldb_files = sorted([f for f in os.listdir(ldb_dir) if f.endswith('.ldb')],
                       key=lambda x: int(x.replace('.ldb', '')))
    for fname in ldb_files:
        fpath = os.path.join(ldb_dir, fname)
        size = os.path.getsize(fpath)
        print(f"SST: {fname} ({size//1024}KB)...")
        vals = parse_sst_values(fpath)
        all_values.extend(vals)
        print(f"  {len(vals)} values")

    print(f"\nTotal values: {len(all_values)}")

    # Parse game records
    games = []
    for key, value in all_values:
        if len(value) < 100:
            continue
        if b'battlegrounds' not in value and b'playerCardId' not in value:
            continue
        rec = parse_firestone_value(value)
        if rec:
            games.append(rec)

    print(f"Game records found: {len(games)}")

    # Deduplicate
    seen = set()
    unique = []
    for g in games:
        sig = (g.get('hero', ''), g.get('placement', 0), g.get('mmr', 0))
        if sig not in seen:
            seen.add(sig)
            unique.append(g)

    print(f"Unique: {len(unique)}")

    if unique:
        out_path = 'E:/claude_project/bob-coach/data/_firestone_games.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(unique, f, ensure_ascii=False, indent=2)
        print(f"Saved to {out_path}")

        print("\n=== Game Records ===")
        for i, g in enumerate(unique[:30]):
            print(f"  {i+1}. {g['hero']} rank={g['placement']} mmr={g['mmr']} "
                  f"change={g['mmrChange']:+d}" if g['mmrChange'] is not None else f"  {i+1}. {g['hero']} rank={g['placement']} mmr={g['mmr']}")


if __name__ == '__main__':
    main()
