// API client for the FinTerm server.
const inflight = new Map();

async function request(path, { method = 'GET', body, timeout = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Bad response from ${path}`);
    }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// GETs are de-duplicated while in flight.
export function get(path) {
  if (inflight.has(path)) return inflight.get(path);
  const p = request(path).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

export const api = {
  health: () => get('/api/health'),
  quotes: (symbols) => (symbols.length ? get(`/api/quotes?${q({ s: [...new Set(symbols)].join(',') })}`) : Promise.resolve({ quotes: {}, errors: {} })),
  chart: (s, range) => get(`/api/chart?${q({ s, range })}`),
  history: (symbols, range) => get(`/api/history?${q({ s: symbols.join(','), range })}`),
  profile: (s) => get(`/api/profile?${q({ s })}`),
  fundamentals: (s) => get(`/api/fundamentals?${q({ s })}`),
  news: (cat, limit) => get(`/api/news?${q({ cat, limit })}`),
  symbolNews: (s, name) => get(`/api/news?${q({ s, name })}`),
  movers: () => get('/api/movers'),
  earnings: (date) => get(`/api/calendar/earnings?${q({ date })}`),
  economic: (date) => get(`/api/calendar/economic?${q({ date })}`),
  yields: () => get('/api/yields'),
  fred: (ids, start) => get(`/api/fred?${q({ ids: ids.join(','), start })}`),
  crypto: (n) => get(`/api/crypto?${q({ n })}`),
  fx: () => get('/api/fx'),
  indonesiaMacro: () => get('/api/indonesia/macro'),
  bonds: () => get('/api/bonds/overview'),
  phei: () => get('/api/bonds/phei'),
  bondSearch: (query) => get(`/api/bonds/search?${q({ q: query })}`),
  fxOn: (date, base = 'USD', quote = 'IDR') => get(`/api/fx/on?${q({ date, base, quote })}`),
  valuation: (s) => get(`/api/valuation?${q({ s })}`),
  peers: (symbols) => get(`/api/valuation/peers?${q({ s: symbols.join(',') })}`),
  holdings: (s) => get(`/api/etf/holdings?${q({ s })}`),
  search: (query) => get(`/api/search?${q({ q: query })}`),
  portfolio: () => get('/api/portfolio'),
  savePortfolio: (doc) => request('/api/portfolio', { method: 'PUT', body: doc }),
};
