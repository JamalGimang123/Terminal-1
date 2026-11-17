// Minimal ZIP reader (stored + deflate) using the central directory.
// Enough for .xlsx workbooks and SEC's zipped data files.
import zlib from 'node:zlib';

export function readZip(buf) {
  // Locate End Of Central Directory record (scan backwards for signature).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no EOCD)');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lh = e.localOffset;
      if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('Bad local header');
      const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
      const data = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${e.method}`);
    },
  };
}
