// Symbol classification and translation between provider symbologies.
// Canonical form is the Yahoo/SEC style: uppercase, share classes with "-" (BRK-B).

const SHARE_CLASS = /^([A-Z]{1,6})[.\-/]([A-C])$/;

export function normalizeSymbol(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(SHARE_CLASS);
  if (m) s = `${m[1]}-${m[2]}`;
  return s;
}

export function classify(sym) {
  if (sym.startsWith('^')) return 'index';
  if (sym.endsWith('=F')) return 'future';
  if (sym.endsWith('=X') || sym === 'DX-Y.NYB') return 'fx';
  if (/^[A-Z0-9]{2,10}-USD$/.test(sym)) return 'crypto';
  if (/\.[A-Z]{1,4}$/.test(sym)) return 'intl';
  if (/^[A-Z]{1,5}(-[A-C])?$/.test(sym)) return 'us';
  return 'other';
}

export function toNasdaq(sym) {
  return sym.replace(/-([A-C])$/, '.$1');
}

export function fromNasdaq(sym) {
  return normalizeSymbol(sym);
}

// Yahoo index symbols -> fallback sources when Yahoo is unavailable.
export const INDEX_FALLBACK = {
  '^GSPC': { cboe: '_SPX' },
  '^NDX': { nasdaq: 'NDX', cboe: '_NDX' },
  '^IXIC': { nasdaq: 'COMP' },
  '^RUT': { cboe: '_RUT' },
  '^VIX': { cboe: '_VIX' },
  '^DJI': { cboe: '_DJX', scale: 100 },
};

// Common crypto: Yahoo symbol -> CoinGecko id.
export const COINGECKO_IDS = {
  'BTC-USD': 'bitcoin',
  'ETH-USD': 'ethereum',
  'SOL-USD': 'solana',
  'XRP-USD': 'ripple',
  'BNB-USD': 'binancecoin',
  'ADA-USD': 'cardano',
  'DOGE-USD': 'dogecoin',
  'AVAX-USD': 'avalanche-2',
  'DOT-USD': 'polkadot',
  'LINK-USD': 'chainlink',
  'LTC-USD': 'litecoin',
  'MATIC-USD': 'matic-network',
  'TRX-USD': 'tron',
  'USDT-USD': 'tether',
  'USDC-USD': 'usd-coin',
};

// FX pairs Yahoo style -> [base, quote]
export function fxPair(sym) {
  if (sym === 'DX-Y.NYB') return null;
  const s = sym.replace('=X', '');
  if (s.length === 6) return [s.slice(0, 3), s.slice(3)];
  if (s.length === 3) return ['USD', s]; // e.g. JPY=X is USD/JPY
  return null;
}
