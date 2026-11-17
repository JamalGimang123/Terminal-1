// Small RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF).
export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Parse "$1,234.50", "1.2%", "--", "N/A" etc. into a number (or null).
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,%\s]/g, '').replace(/^\+/, '');
  if (s === '' || s === '--' || s === '.' || /^n\/?a$/i.test(s) || s === 'UNCH') return s === 'UNCH' ? 0 : null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
