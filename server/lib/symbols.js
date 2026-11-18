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

// Trading currency inferred from the Yahoo exchange suffix (quotes from the batch
// spark endpoint omit it). "GBp" = pence sterling.
const SUFFIX_CCY = {
  JK: 'IDR', T: 'JPY', L: 'GBp', HK: 'HKD', TO: 'CAD', V: 'CAD', AX: 'AUD', NZ: 'NZD', SI: 'SGD', KS: 'KRW', KQ: 'KRW',
  SS: 'CNY', SZ: 'CNY', NS: 'INR', BO: 'INR', TW: 'TWD', TWO: 'TWD', BK: 'THB', KL: 'MYR', PS: 'PHP', SA: 'BRL', MX: 'MXN',
  DE: 'EUR', F: 'EUR', PA: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR', BR: 'EUR', LS: 'EUR', VI: 'EUR', HE: 'EUR', IR: 'EUR',
  SW: 'CHF', ST: 'SEK', OL: 'NOK', CO: 'DKK', WA: 'PLN', TA: 'ILS', JO: 'ZAc', IS: 'TRY',
};
const INDEX_CCY = { '^JKSE': 'IDR', '^JKLQ45': 'IDR', '^JKII': 'IDR', '^N225': 'JPY', '^HSI': 'HKD', '^FTSE': 'GBP', '^GDAXI': 'EUR', '^FCHI': 'EUR', '^STOXX50E': 'EUR', '^KS11': 'KRW', '^GSPTSE': 'CAD', '^AXJO': 'AUD', '^BSESN': 'INR', '000001.SS': 'CNY' };

export function currencyOf(sym) {
  if (INDEX_CCY[sym]) return INDEX_CCY[sym];
  const kind = classify(sym);
  if (kind === 'us' || kind === 'crypto' || kind === 'future') return 'USD';
  if (kind === 'fx') {
    const p = fxPair(sym);
    return p ? p[1] : 'USD';
  }
  const m = sym.match(/\.([A-Z]{1,4})$/);
  return m ? SUFFIX_CCY[m[1]] || null : sym.startsWith('^') ? null : 'USD';
}
