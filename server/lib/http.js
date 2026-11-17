// Thin fetch wrapper: timeouts, sane headers, per-host concurrency limits,
// and typed errors so providers can decide whether to fall back.
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', body = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

// --- per-host concurrency gate -------------------------------------------
const hostLimits = {
  'www.sec.gov': 4,
  'data.sec.gov': 4,
  'query1.finance.yahoo.com': 4,
  'query2.finance.yahoo.com': 4,
  'api.nasdaq.com': 6,
  'api.coingecko.com': 2,
};
const active = new Map();
const queues = new Map();

async function acquire(host) {
  const limit = hostLimits[host] || 8;
  const n = active.get(host) || 0;
  if (n < limit) {
    active.set(host, n + 1);
    return;
  }
  await new Promise((resolve) => {
    if (!queues.has(host)) queues.set(host, []);
    queues.get(host).push(resolve);
  });
  active.set(host, (active.get(host) || 0) + 1);
}

function release(host) {
  active.set(host, Math.max(0, (active.get(host) || 1) - 1));
  const q = queues.get(host);
  if (q && q.length) q.shift()();
}

export function browserHeaders(extra = {}) {
  return {
    'User-Agent': config.browserUserAgent,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };
}

export function secHeaders(extra = {}) {
  return {
    'User-Agent': config.secUserAgent,
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate',
    ...extra,
  };
}

export async function request(url, { headers = {}, timeout = config.requestTimeoutMs, method = 'GET', body } = {}) {
  const host = new URL(url).host;
  await acquire(host);
  const started = Date.now();
  try {
    let res;
    try {
      res = await fetch(url, {
        method,
        body,
        headers: Object.keys(headers).length ? headers : browserHeaders(),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? `timeout after ${timeout}ms` : err?.cause?.code || err.message;
      throw new HttpError(`${host}: ${reason}`, { url });
    }
    if (config.logRequests) console.log(`[http] ${res.status} ${Date.now() - started}ms ${url}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(`${host} responded ${res.status}`, { status: res.status, url, body: text.slice(0, 300) });
    }
    return res;
  } finally {
    release(host);
  }
}

export async function getText(url, opts) {
  const res = await request(url, opts);
  return res.text();
}

export async function getJSON(url, opts) {
  const res = await request(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`${new URL(url).host}: invalid JSON`, { status: res.status, url, body: text.slice(0, 200) });
  }
}

export async function getBuffer(url, opts) {
  const res = await request(url, opts);
  return Buffer.from(await res.arrayBuffer());
}

// Map over items with bounded parallelism, collecting per-item errors.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
