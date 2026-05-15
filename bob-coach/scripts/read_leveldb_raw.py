"""
Raw LevelDB SST file reader — bypasses comparator check.
Reads Chromium IndexedDB LevelDB files directly.
"""
import struct
import sys
import os

def read_varint32(data, offset):
    """Read a 32-bit varint from data at offset. Returns (value, new_offset)."""
    result = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            break
        shift += 7
    return result, offset

def read_varint64(data, offset):
    """Read a 64-bit varint. Returns (value, new_offset)."""
    result = 0
    shift = 0
    for _ in range(10):
        if offset >= len(data):
            break
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, offset
        shift += 7
    return result, offset

def read_block(data, offset):
    """Read a LevelDB block. Returns (entries, new_offset)."""
    # Block format:
    # [entry1][entry2]...[entryN][restart_offsets][num_restarts(4)][type(1)]
    # Each entry: [shared_len(varint32)][unshared_len(varint32)][value_len(varint32)][unshared_key][value]

    entries = []
    key_buf = bytearray()

    # We need to find the restart array at the end
    # Last 4 bytes = num_restarts, byte before = compression type
    if offset + 5 > len(data):
        return entries, offset

    block_end = offset
    # Find block boundaries by scanning for restart info
    # Actually we need to know block size from the index block
    # For now, scan entry by entry

    return entries, offset

def sanitize_key(key_bytes):
    """Try to extract readable string from IndexedDB key."""
    # Chromium IndexedDB key format varies by object store
    # Usually starts with a prefix byte(s) + encoded key
    parts = []
    for b in key_bytes:
        if 32 <= b < 127:
            parts.append(chr(b))
        else:
            parts.append(f'\\x{b:02x}')
    return ''.join(parts)

def try_decode_value(val_bytes):
    """Try to decode value as JSON or text."""
    # Try UTF-8
    try:
        text = val_bytes.decode('utf-8')
        if len(text) > 20 and ('{' in text or '[' in text):
            return text[:200] + ('...' if len(text) > 200 else '')
        return text[:200]
    except:
        pass
    return f'<binary {len(val_bytes)} bytes>'

def main():
    ldb_dir = sys.argv[1] if len(sys.argv) > 1 else 'E:/claude_project/temp_firestone_ldb'

    # Collect all .ldb files
    ldb_files = sorted([f for f in os.listdir(ldb_dir) if f.endswith('.ldb')],
                       key=lambda x: int(x.replace('.ldb', '')))

    print(f"Found {len(ldb_files)} .ldb files")

    all_data = b''
    for fname in ldb_files:
        fpath = os.path.join(ldb_dir, fname)
        with open(fpath, 'rb') as f:
            all_data += f.read()

    print(f"Total data: {len(all_data)} bytes")

    # Scan for JSON-like content
    import re
    # Find JSON objects in the binary data
    json_starts = [m.start() for m in re.finditer(b'\{', all_data)]
    print(f"\nFound {len(json_starts)} potential JSON objects")

    # Try to extract meaningful JSON chunks
    shown = 0
    for start in json_starts[:500]:
        # Try to find the matching closing brace (simple heuristic)
        depth = 0
        end = start
        for i in range(start, min(start + 5000, len(all_data))):
            if all_data[i:i+1] == b'{':
                depth += 1
            elif all_data[i:i+1] == b'}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
            elif all_data[i:i+1] == b'"':
                # Skip string
                j = i + 1
                while j < len(all_data) and all_data[j:j+1] != b'"':
                    if all_data[j:j+1] == b'\\':
                        j += 1
                    j += 1
                i = j

        if end > start:
            chunk = all_data[start:end]
            try:
                text = chunk.decode('utf-8')
                # Only show interesting chunks (containing game-related keys)
                if any(kw in text.lower() for kw in ['hero', 'card', 'game', 'match', 'placement', 'player', 'minion', 'race', 'tier', 'rank']):
                    if shown < 50:
                        print(f"\n--- Chunk at offset {start} ({len(chunk)} bytes) ---")
                        print(text[:300])
                        shown += 1
            except:
                pass

if __name__ == '__main__':
    main()
