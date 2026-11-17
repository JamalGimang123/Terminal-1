// Time helpers for US-Eastern market data.
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });

// Offset of America/New_York from UTC in minutes at the given instant (e.g. -300 or -240).
export function etOffsetMinutes(date = new Date()) {
  const part = offsetFmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return -300;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] || 0);
}

// Interpret a wall-clock time in New York, given as "fake UTC" milliseconds, as a real instant.
export function etWallClockToEpoch(fakeUtcMs) {
  const off = etOffsetMinutes(new Date(fakeUtcMs));
  return fakeUtcMs - off * 60e3;
}

// Parse ISO-ish timestamps that may carry 7 fractional digits or no offset (assumed ET).
export function parseETDateTime(s) {
  if (!s) return null;
  let str = String(s).trim().replace(/(\.\d{3})\d+/, '$1');
  const hasZone = /([+-]\d{2}:?\d{2}|Z)$/.test(str);
  if (hasZone) {
    const t = Date.parse(str);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(str + 'Z');
  return Number.isNaN(t) ? null : etWallClockToEpoch(t);
}

// "Nov 17, 2026 1:55 PM ET" -> epoch ms
export function parseNasdaqTimestamp(s) {
  if (!s) return null;
  const m = String(s).match(/([A-Za-z]{3}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ([AP]M))?/);
  if (!m) return null;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  let h = Number(m[4] || 16);
  if (m[6] === 'PM' && h < 12) h += 12;
  if (m[6] === 'AM' && h === 12) h = 0;
  const fake = Date.UTC(Number(m[3]), months[m[1]], Number(m[2]), h, Number(m[5] || 0));
  return etWallClockToEpoch(fake);
}

// "11/16/2026" -> "2026-11-16"
export function mdyToISO(s) {
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}
