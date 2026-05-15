"""
LevelDB SST parser v2 — with Snappy decompression + proper block handling.
"""
import struct
import sys
import os
import json

try:
    from snappy import uncompress as snappy_decompress
except ImportError:
    try:
        import cramjam
        def snappy_decompress(data):
            return cramjam.snappy.decompress(data)
    except ImportError:
        print("ERROR: Need snappy or cramjam installed")
        sys.exit(1)

LEVELDB_MAGIC = bytes([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb])

def read_varint64(data, pos):
    result = 0
    shift = 0
    while pos < len(data):
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, pos
        shift += 7
        if shift > 70:
            break
    return result, pos

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
        if shift > 35:
            break
    return result, pos

def read_block_entries(raw, start, block_uncompressed_size):
    """
    Read entries from an UNCOMPRESSED block.
    block_uncompressed_size: size of block data (excluding trailer).
    The actual block format is:
    [entries...][restarts][num_restarts(uint32)][compression_type(uint8)]

    We need to find where entries end and restarts begin.
    We do this by reading from the end first.
    """
    entries_end = start + block_uncompressed_size

    # Read trailer (5 bytes at end)
    comp_type = raw[entries_end - 1]
    num_restarts = struct.unpack('<I', raw[entries_end - 5:entries_end - 1])[0]

    # Restart offsets array
    restarts_start = entries_end - 5 - num_restarts * 4

    # Read restart offsets
    restart_offsets = []
    for i in range(num_restarts):
        off = struct.unpack('<I', raw[restarts_start + i*4:restarts_start + (i+1)*4])[0]
        restart_offsets.append(off)

    # Now read entries from start to restarts_start
    entries = []
    pos = start
    key_buf = bytearray()

    while pos < restarts_start:
        shared, pos = read_varint32(raw, pos)
        unshared, pos = read_varint32(raw, pos)
        value_len, pos = read_varint32(raw, pos)

        if pos + unshared + value_len > restarts_start:
            break

        key_buf = key_buf[:shared]
        key_buf.extend(raw[pos:pos + unshared])
        pos += unshared

        value = raw[pos:pos + value_len]
        pos += value_len

        entries.append((bytes(key_buf), value))

    return entries, comp_type

def parse_sst(filepath):
    """Parse a complete LevelDB SST file."""
    with open(filepath, 'rb') as f:
        data = f.read()

    if len(data) < 48:
        return []

    # Find magic at end
    mag_pos = data.rfind(LEVELDB_MAGIC)
    if mag_pos == -1:
        return []

    footer = data[mag_pos - 40:mag_pos + 8]

    pos = 0
    metaindex_offset, pos = read_varint64(footer, pos)
    metaindex_size, pos = read_varint64(footer, pos)
    index_offset, pos = read_varint64(footer, pos)
    index_size, pos = read_varint64(footer, pos)

    # Parse index block to find data block locations
    index_entries, idx_comp = read_block_entries(data, index_offset, index_size)

    if idx_comp == 1:
        # Index block is compressed (unlikely but handle it)
        decompressed = snappy_decompress(data[index_offset:index_offset + index_size])
        index_entries, _ = read_block_entries(decompressed, 0, len(decompressed))

    # index_entries: (key, value) where value = BlockHandle(varint64 offset, varint64 size)
    data_blocks = []
    for k, v in index_entries:
        vpos = 0
        block_offset, vpos = read_varint64(v, vpos)
        block_size, vpos = read_varint64(v, vpos)
        data_blocks.append((block_offset, block_size))

    # Read each data block
    all_entries = []
    for blk_off, blk_size in data_blocks:
        if blk_off + blk_size > len(data):
            continue
        if blk_size < 5:
            continue

        # Check compression type
        comp_type = data[blk_off + blk_size - 1]

        if comp_type == 0:
            entries, _ = read_block_entries(data, blk_off, blk_size)
            all_entries.extend(entries)
        elif comp_type == 1:
            # Snappy compressed
            compressed = data[blk_off:blk_off + blk_size]
            try:
                decompressed = snappy_decompress(compressed)
                # The decompressed block has its own trailer
                entries, _ = read_block_entries(decompressed, 0, len(decompressed))
                all_entries.extend(entries)
            except Exception as e:
                pass
        else:
            # Unknown compression
            pass

    return all_entries

def decode_indexeddb_key(key):
    """Decode Chromium IndexedDB key (UTF-16LE encoded)."""
    try:
        # Try UTF-16LE first
        text = key.decode('utf-16-le', errors='replace')
        # Remove null chars
        text = text.replace('\x00', '')
        if text and all(32 <= ord(c) < 127 or ord(c) > 0x4e00 for c in text if c):
            return text
    except:
        pass

    # Fall back to hex
    return key.hex()

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'

    ldb_files = sorted(
        [f for f in os.listdir(ldb_dir) if f.endswith('.ldb')],
        key=lambda x: int(x.replace('.ldb', ''))
    )

    print(f"Directory: {ldb_dir}")
    print(f"Files: {len(ldb_files)}")

    all_kv = []
    for fname in ldb_files:
        fpath = os.path.join(ldb_dir, fname)
        size = os.path.getsize(fpath)
        if size < 500:
            continue
        print(f"\n{fname} ({size:,} bytes)...")
        entries = parse_sst(fpath)
        print(f"  {len(entries)} entries")
        all_kv.extend(entries)

    print(f"\n=== Total: {len(all_kv)} entries ===")

    if not all_kv:
        print("No entries found!")
        return

    # Try to decode keys and find game data
    # Chromium IndexedDB stores object store data with prefix bytes
    # Key format varies but often starts with 0x00 + database_id + object_store_name + index_key

    # Group entries by key prefix to understand store structure
    key_prefixes = {}
    for k, v in all_kv:
        prefix_len = min(4, len(k))
        prefix = k[:prefix_len]
        if prefix not in key_prefixes:
            key_prefixes[prefix] = 0
        key_prefixes[prefix] += 1

    print("\n=== Key prefix distribution ===")
    for prefix, cnt in sorted(key_prefixes.items(), key=lambda x: -x[1])[:20]:
        print(f"  {prefix.hex()}: {cnt} entries")

    # Show sample keys per prefix
    print("\n=== Sample entries per prefix ===")
    shown_prefixes = set()
    for k, v in all_kv:
        prefix = k[:4]
        if prefix in shown_prefixes or len(shown_prefixes) >= 10:
            continue
        shown_prefixes.add(prefix)

        # Try to decode key and value
        key_text = decode_indexeddb_key(k)
        try:
            val_text = v.decode('utf-8')
            if '{' in val_text:
                val_preview = val_text[:200]
            else:
                val_preview = v[:100].hex()
        except:
            val_preview = v[:100].hex()

        print(f"\n  Key prefix: {prefix.hex()}")
        print(f"  Key({len(k)}b): {key_text[:100]}")
        print(f"  Val({len(v)}b): {val_preview}")

    # Try to find game records specifically
    game_records = []
    for k, v in all_kv:
        try:
            text = v.decode('utf-8')
            if len(text) > 100 and '{' in text:
                try:
                    obj = json.loads(text)
                    if isinstance(obj, dict) and len(obj) >= 3:
                        # Check for game-related keys
                        if any(kw in str(obj.keys()).lower() for kw in ['hero', 'card', 'placement', 'board', 'match', 'player', 'minion', 'race', 'tier', 'damage']):
                            game_records.append((k[:20], obj))
                except:
                    pass
        except:
            pass

    if game_records:
        print(f"\n=== Found {len(game_records)} game-related JSON records ===")
        for i, (k, obj) in enumerate(game_records[:5]):
            print(f"\n--- Record {i+1} ---")
            print(json.dumps(obj, indent=2, ensure_ascii=False)[:600])


if __name__ == '__main__':
    main()
