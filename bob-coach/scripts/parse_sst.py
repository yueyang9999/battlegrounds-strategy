"""
Raw LevelDB SST file parser — reads Chromium IndexedDB LevelDB directly.
No external dependencies, Python 3 stdlib only.
"""
import struct
import sys
import os
import json
import re

# LevelDB magic number (little-endian)
LEVELDB_MAGIC = bytes([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb])

def read_varint(data, pos):
    """Read 32-bit varint. Returns (value, new_pos)."""
    result = 0
    for shift in range(0, 35, 7):
        if pos >= len(data):
            return 0, pos
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, pos
    return result, pos

def read_varint64(data, pos):
    """Read 64-bit varint. Returns (value, new_pos)."""
    result = 0
    for shift in range(0, 70, 7):
        if pos >= len(data):
            return 0, pos
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, pos
    return result, pos

def decode_block(data, offset, block_end):
    """Decode a LevelDB data block, return list of (key, value) pairs."""
    entries = []
    pos = offset
    key_buf = b''
    restart_offsets = []

    # Read entries until we approach the restart section
    # We'll detect the restart array by reading backwards
    # First, find num_restarts and compression type

    # Read entries sequentially
    while pos < block_end - 4:
        shared, pos = read_varint(data, pos)
        unshared, pos = read_varint(data, pos)
        value_len, pos = read_varint(data, pos)

        if pos + unshared + value_len > block_end:
            break

        key_buf = key_buf[:shared] + data[pos:pos + unshared]
        pos += unshared

        value = data[pos:pos + value_len]
        pos += value_len

        if shared == 0:
            restart_offsets.append(len(entries))

        entries.append((bytes(key_buf), value))

    return entries

def parse_sst(filepath):
    """Parse a LevelDB SST file and return all key-value pairs."""
    with open(filepath, 'rb') as f:
        data = f.read()

    if len(data) < 48:
        return []

    # Read footer (last 48 bytes)
    footer = data[-48:]

    # Check magic
    if footer[-8:] != LEVELDB_MAGIC:
        # Try again with the magic at a different position
        # Sometimes there's extra data after footer
        mag_pos = data.rfind(LEVELDB_MAGIC)
        if mag_pos == -1 or mag_pos < 8:
            return []
        footer = data[mag_pos - 40:mag_pos + 8]

    # Footer: [metaindex_handle][index_handle][padding][magic]
    # Each handle: varint64 offset + varint64 size
    footer_pos = 0

    # Metaindex handle
    metaindex_offset, footer_pos = read_varint64(footer, footer_pos)
    metaindex_size, footer_pos = read_varint64(footer, footer_pos)

    # Index handle
    index_offset, footer_pos = read_varint64(footer, footer_pos)
    index_size, footer_pos = read_varint64(footer, footer_pos)

    # Decode index block to find data block locations
    index_block = decode_block(data, index_offset, index_offset + index_size)

    all_entries = []
    for key, value in index_block:
        # Key is the last key of the data block
        # Value is a BlockHandle: varint64 offset + varint64 size
        bh_pos = 0
        block_offset, bh_pos = read_varint64(value, bh_pos)
        block_size, bh_pos = read_varint64(value, bh_pos)

        if block_offset + block_size > len(data):
            continue

        # Read data block
        entries = decode_block(data, block_offset, block_offset + block_size)
        all_entries.extend(entries)

    return all_entries

def decode_utf16le_key(raw_key):
    """Try to decode IndexedDB key to readable string."""
    try:
        return raw_key.decode('utf-16-le')
    except:
        return raw_key.hex()

def extract_json_values(entries):
    """Extract entries whose values look like JSON game records."""
    results = []
    for key, value in entries:
        # Try to decode value as JSON
        try:
            text = value.decode('utf-8')
            if '{' in text:
                results.append((key, text))
        except:
            pass
    return results

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'

    ldb_files = sorted(
        [f for f in os.listdir(ldb_dir) if f.endswith('.ldb')],
        key=lambda x: int(x.replace('.ldb', ''))
    )

    print(f"=== LevelDB SST Parser ===")
    print(f"Directory: {ldb_dir}")
    print(f"Files: {len(ldb_files)} .ldb files")

    all_kv = []
    for fname in ldb_files:
        fpath = os.path.join(ldb_dir, fname)
        size = os.path.getsize(fpath)
        if size < 100:
            continue
        print(f"\nParsing {fname} ({size:,} bytes)...")
        entries = parse_sst(fpath)
        print(f"  Extracted {len(entries)} key-value pairs")
        all_kv.extend(entries)

    print(f"\n=== Total: {len(all_kv)} key-value pairs ===")

    # Show key structure
    print("\n=== Key Samples (first 30) ===")
    for i, (k, v) in enumerate(all_kv[:30]):
        hex_prefix = k[:16].hex() if len(k) > 16 else k.hex()
        val_preview = v[:80].decode('utf-8', errors='replace') if v else '<empty>'
        print(f"  [{i}] key={k[:32].hex()} v={val_preview!r}")

    # Try to find game records
    game_records = []
    for k, v in all_kv:
        try:
            text = v.decode('utf-8')
            if len(text) > 50 and '{' in text:
                # Check if looks like a game/match record
                if any(kw in text.lower() for kw in ['hero', 'placement', 'board', 'minion', 'player', 'game', 'match', 'rank']):
                    try:
                        obj = json.loads(text)
                        game_records.append((k, obj))
                    except json.JSONDecodeError:
                        # Partial JSON - try to find JSON objects within
                        brace_depth = 0
                        start = -1
                        for j, ch in enumerate(text):
                            if ch == '{':
                                if start == -1:
                                    start = j
                                brace_depth += 1
                            elif ch == '}':
                                brace_depth -= 1
                                if brace_depth == 0 and start >= 0:
                                    try:
                                        obj = json.loads(text[start:j+1])
                                        game_records.append((k, obj))
                                    except:
                                        pass
                                    start = -1
        except:
            pass

    if game_records:
        print(f"\n=== Found {len(game_records)} game-like records ===")
        for i, (k, obj) in enumerate(game_records[:5]):
            print(f"\n--- Record {i+1} ---")
            print(json.dumps(obj, indent=2, ensure_ascii=False)[:500])
    else:
        print("\n=== No JSON game records found. Dumping first 50 values that look like text ===")
        count = 0
        for k, v in all_kv:
            try:
                text = v.decode('utf-8')
                if len(text) > 30:
                    print(f"\n[{count}] val({len(v)}b): {text[:200]}")
                    count += 1
                    if count >= 50:
                        break
            except:
                pass

if __name__ == '__main__':
    main()
