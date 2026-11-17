// Minimal, dependency-free XML helpers sufficient for RSS/Atom feeds,
// EDGAR Atom listings and N-PORT documents.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function unwrap(s) {
  if (s == null) return '';
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : s;
}

export function stripTags(html) {
  return decodeEntities(decodeEntities(unwrap(html || '')).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Inner text of the first <tag>…</tag> (namespace prefix allowed in the tag name).
export function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = xml.match(re);
  return m ? unwrap(m[1]).trim() : '';
}

export function attr(xml, name, attribute) {
  const re = new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? decodeEntities(m[1]) : '';
}

export function blocks(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

// Parse RSS 2.0 or Atom into a uniform item list.
export function parseFeed(xml) {
  const items = [];
  const rssItems = blocks(xml, 'item');
  if (rssItems.length) {
    for (const it of rssItems) {
      const date = tag(it, 'pubDate') || tag(it, 'dc:date') || tag(it, 'updated');
      items.push({
        title: stripTags(tag(it, 'title')),
        link: stripTags(tag(it, 'link')) || stripTags(tag(it, 'guid')),
        summary: stripTags(tag(it, 'description')).slice(0, 400),
        published: toISO(stripTags(date)),
        author: stripTags(tag(it, 'dc:creator') || tag(it, 'author')),
        category: stripTags(tag(it, 'category')),
      });
    }
  } else {
    for (const en of blocks(xml, 'entry')) {
      const link = attr(en, 'link', 'href');
      const date = tag(en, 'updated') || tag(en, 'published');
      items.push({
        title: stripTags(tag(en, 'title')),
        link,
        summary: stripTags(tag(en, 'summary') || tag(en, 'content')).slice(0, 400),
        published: toISO(date),
        author: stripTags(tag(en, 'name')),
        category: attr(en, 'category', 'term'),
      });
    }
  }
  return items.filter((i) => i.title && i.link);
}

export function toISO(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
