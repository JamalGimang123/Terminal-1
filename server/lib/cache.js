// In-memory TTL cache with in-flight de-duplication, plus an optional disk
// layer for large, slow-changing payloads (ticker maps, ETF holdings).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const mem = new Map(); // key -> { value, expires }
const inflight = new Map(); // key -> Promise

export async function cached(key, ttlMs, producer, { staleOnError = true } = {}) {
  const hit = mem.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await producer();
      mem.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    } catch (err) {
      // Serve stale data rather than nothing if the upstream blips.
      if (staleOnError && hit) return { ...hit.value, stale: true };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function peek(key) {
  const hit = mem.get(key);
  return hit ? hit.value : undefined;
}

function diskPath(key) {
  return path.join(config.cacheDir, key.replace(/[^a-zA-Z0-9._-]+/g, '_') + '.json');
}

// Disk-backed cache: survives restarts. Falls back to the stale disk copy when the producer fails.
export async function diskCached(key, ttlMs, producer) {
  return cached(`disk:${key}`, Math.min(ttlMs, 6 * 3600e3), async () => {
    const file = diskPath(key);
    let existing = null;
    try {
      existing = JSON.parse(await fs.readFile(file, 'utf8'));
      if (existing && Date.now() - existing.savedAt < ttlMs) return existing.value;
    } catch {
      /* no cache yet */
    }
    try {
      const value = await producer();
      await fs.mkdir(config.cacheDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify({ savedAt: Date.now(), value }));
      return value;
    } catch (err) {
      if (existing) return existing.value;
      throw err;
    }
  });
}
