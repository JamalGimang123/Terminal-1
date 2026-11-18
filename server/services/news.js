// News aggregation from free, public RSS feeds and per-symbol news endpoints.
import { getText, browserHeaders, secHeaders, mapLimit } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseFeed } from '../lib/xml.js';
import { normalizeSymbol, classify } from '../lib/symbols.js';
import { nasdaqNews } from '../providers/nasdaq.js';
import { yahooNews } from '../providers/yahoo.js';
import { biPress } from '../providers/indonesia.js';

const cnbc = (id) => `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=${id}`;
const mw = (f) => `https://feeds.content.dowjones.io/public/rss/${f}`;

export const FEEDS = [
  { id: 'cnbc-top', source: 'CNBC', name: 'Top News', url: cnbc(100003114), cats: ['top', 'markets'] },
  { id: 'cnbc-markets', source: 'CNBC', name: 'Investing', url: cnbc(15839069), cats: ['markets'] },
  { id: 'cnbc-economy', source: 'CNBC', name: 'Economy', url: cnbc(20910258), cats: ['economy'] },
  { id: 'cnbc-earnings', source: 'CNBC', name: 'Earnings', url: cnbc(15839135), cats: ['markets', 'earnings'] },
  { id: 'cnbc-finance', source: 'CNBC', name: 'Finance', url: cnbc(10000664), cats: ['markets'] },
  { id: 'cnbc-tech', source: 'CNBC', name: 'Technology', url: cnbc(19854910), cats: ['tech'] },
  { id: 'cnbc-world', source: 'CNBC', name: 'World', url: cnbc(100727362), cats: ['world'] },
  { id: 'mw-top', source: 'MarketWatch', name: 'Top Stories', url: mw('mw_topstories'), cats: ['top', 'markets'] },
  { id: 'mw-rt', source: 'MarketWatch', name: 'Real-time Headlines', url: mw('mw_realtimeheadlines'), cats: ['top', 'markets'] },
  { id: 'mw-pulse', source: 'MarketWatch', name: 'Market Pulse', url: mw('mw_marketpulse'), cats: ['markets'] },
  { id: 'fed-all', source: 'Federal Reserve', name: 'Press Releases', url: 'https://www.federalreserve.gov/feeds/press_all.xml', cats: ['economy', 'fed'] },
  { id: 'fed-mon', source: 'Federal Reserve', name: 'Monetary Policy', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', cats: ['fed'] },
  { id: 'sec-press', source: 'SEC', name: 'Press Releases', url: 'https://www.sec.gov/news/pressreleases.rss', cats: ['regulatory'], sec: true },
  // Indonesia (lang: 'id' = Bahasa Indonesia, 'en' = English)
  { id: 'id-cnbc-market', source: 'CNBC Indonesia', name: 'Market', url: 'https://www.cnbcindonesia.com/market/rss', cats: ['indonesia'], lang: 'id' },
  { id: 'id-cnbc-news', source: 'CNBC Indonesia', name: 'News', url: 'https://www.cnbcindonesia.com/news/rss', cats: ['indonesia'], lang: 'id' },
  { id: 'id-antara-fin', source: 'Antara', name: 'Ekonomi Finansial', url: 'https://www.antaranews.com/rss/ekonomi-finansial.xml', cats: ['indonesia'], lang: 'id' },
  { id: 'id-antara-biz', source: 'Antara', name: 'Ekonomi Bisnis', url: 'https://www.antaranews.com/rss/ekonomi-bisnis.xml', cats: ['indonesia'], lang: 'id' },
  { id: 'id-antara-en', source: 'Antara', name: 'English News', url: 'https://en.antaranews.com/rss/news.xml', cats: ['indonesia'], lang: 'en' },
  { id: 'id-detik-fin', source: 'Detik Finance', name: 'Finance', url: 'https://finance.detik.com/rss', cats: ['indonesia'], lang: 'id' },
  { id: 'id-bi-press', source: 'Bank Indonesia', name: 'Press Releases', custom: 'bi', cats: ['indonesia', 'bi'], lang: 'en' },
];

// How Indonesian media refer to IDX blue chips.
const ID_ALIASES = {
  'BBCA.JK': ['BCA', 'Bank Central Asia'], 'BBRI.JK': ['BRI', 'Bank Rakyat Indonesia'], 'BMRI.JK': ['Bank Mandiri'], 'BBNI.JK': ['BNI', 'Bank Negara Indonesia'],
  'TLKM.JK': ['Telkom', 'Telkom Indonesia'], 'ASII.JK': ['Astra', 'Astra International'], 'AMMN.JK': ['Amman Mineral', 'Amman'], 'BREN.JK': ['Barito Renewables'],
  'TPIA.JK': ['Chandra Asri'], 'DSSA.JK': ['Dian Swastatika'], 'ICBP.JK': ['Indofood CBP'], 'INDF.JK': ['Indofood'], 'UNTR.JK': ['United Tractors'],
  'AMRT.JK': ['Alfamart', 'Sumber Alfaria'], 'ADRO.JK': ['AlamTri', 'Adaro'], 'ANTM.JK': ['Antam', 'Aneka Tambang'], 'KLBF.JK': ['Kalbe', 'Kalbe Farma'],
  'CPIN.JK': ['Charoen Pokphand'], 'UNVR.JK': ['Unilever Indonesia'], 'PGAS.JK': ['PGN', 'Perusahaan Gas Negara'], 'MDKA.JK': ['Merdeka Copper'],
  'GOTO.JK': ['GoTo', 'Gojek', 'Tokopedia'],
};

export const CATEGORIES = ['top', 'markets', 'economy', 'fed', 'earnings', 'tech', 'world', 'regulatory', 'indonesia', 'bi'];

// Sponsored content is not news: drop paid advertorial placements.
const isAdvertorial = (i) => /\/advertorial|\/adv-|sponsored|\/promosi\//i.test(i.link) || /^\s*(advertorial|adv|sponsored)\b/i.test(i.title);

async function loadFeed(feed) {
  return cached(`feed:${feed.id}`, 3 * 60e3, async () => {
    const tag = (i) => ({ ...i, source: feed.source, feed: feed.name, feedId: feed.id, lang: feed.lang || 'en' });
    if (feed.custom === 'bi') return (await biPress()).map(tag);
    const headers = feed.sec ? secHeaders() : browserHeaders({ Accept: 'application/rss+xml, application/xml, text/xml' });
    const xml = await getText(feed.url, { headers, timeout: 12000 });
    return parseFeed(xml).filter((i) => !isAdvertorial(i)).map(tag);
  });
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const k = i.link.replace(/[?#].*$/, '') + '|' + i.title.toLowerCase().slice(0, 60);
    const k2 = i.title.toLowerCase().replace(/\W+/g, '').slice(0, 70);
    if (seen.has(k) || seen.has(k2)) return false;
    seen.add(k);
    seen.add(k2);
    return true;
  });
}

const byDate = (a, b) => (b.published || '').localeCompare(a.published || '');

export async function categoryNews(cat = 'top', limit = 60) {
  const feeds = cat === 'all' ? FEEDS : FEEDS.filter((f) => f.cats.includes(cat));
  const results = await mapLimit(feeds, 6, loadFeed);
  const items = [];
  const status = [];
  results.forEach((r, i) => {
    status.push({ feed: `${feeds[i].source} ${feeds[i].name}`, ok: r.ok, error: r.ok ? null : r.error.message, count: r.ok ? r.value.length : 0 });
    if (r.ok) items.push(...r.value);
  });
  // Some feeds keep years-old items around; keep news fresh (official releases are less frequent).
  const maxAgeDays = ['fed', 'regulatory', 'bi'].includes(cat) ? 120 : 10;
  const cutoff = new Date(Date.now() - maxAgeDays * 86400e3).toISOString();
  const biCutoff = new Date(Date.now() - 60 * 86400e3).toISOString();
  const fresh = items.filter((i) => !i.published || i.published >= (i.feedId === 'id-bi-press' ? biCutoff : cutoff));
  return { category: cat, items: dedupe(fresh.sort(byDate)).slice(0, limit), feeds: status };
}

export async function symbolNews(rawSym, companyName = '') {
  const sym = normalizeSymbol(rawSym);
  return cached(`news:${sym}`, 5 * 60e3, async () => {
    const [nq, yh, general] = await Promise.all([
      // Nasdaq only covers US listings (it returns generic stories for anything else).
      (classify(sym) === 'us' ? nasdaqNews(sym) : Promise.reject(new Error('US listings only'))).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })),
      yahooNews(sym).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })),
      categoryNews('all', 400).catch(() => ({ items: [] })),
    ]);
    const items = [];
    const status = [];
    if (nq.ok) items.push(...nq.v);
    status.push({ feed: 'Nasdaq', ok: nq.ok, error: nq.ok ? null : nq.e.message });
    // Yahoo's per-symbol feed mixes in unrelated market stories: keep the ones that mention the company.
    const mentions = (i) => reTicker.test(i.title) || (reName && (reName.test(i.title) || reName.test(i.summary))) || reTicker.test(i.summary);
    status.push({ feed: 'Yahoo Finance RSS', ok: yh.ok, error: yh.ok ? null : yh.e.message });
    // Also surface general-feed stories that mention the ticker or company.
    const short = companyName
      .replace(/^PT\.?\s+/i, '')
      .replace(/,?\s+(inc|corp|corporation|co|ltd|plc|holdings|group|company|tbk|\(persero\))\.?$/i, '')
      .replace(/\s+\(Persero\)/i, '')
      .trim();
    const base = sym.replace(/\.[A-Z]{1,4}$/, '').replace(/[^A-Z0-9]/g, '');
    const reTicker = new RegExp(`\\b${base}\\b`);
    const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Brand names the press actually uses (e.g. Indonesian media write "BCA", not "BBCA").
    // Short acronyms match case-sensitively so they don't hit ordinary words.
    const aliases = [...(ID_ALIASES[sym] || []), ...(short.length >= 4 ? [short] : [])];
    const longA = aliases.filter((a) => a.length > 4);
    const shortA = aliases.filter((a) => a.length <= 4);
    const reLong = longA.length ? new RegExp(`\\b(${longA.map(escRe).join('|')})\\b`, 'i') : null;
    const reShort = shortA.length ? new RegExp(`\\b(${shortA.map(escRe).join('|')})\\b`) : null;
    const reName = reLong || reShort ? { test: (t) => (reLong?.test(t) ?? false) || (reShort?.test(t) ?? false) } : null;
    if (yh.ok) items.push(...yh.v.filter(mentions));
    for (const i of general.items || []) {
      if (reTicker.test(i.title) || (reName && (reName.test(i.title) || reName.test(i.summary)))) items.push(i);
    }
    return { symbol: sym, items: dedupe(items.sort(byDate)).slice(0, 60), feeds: status };
  });
}
