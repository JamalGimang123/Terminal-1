// Read the first worksheet of an .xlsx file into a 2-D array of strings/numbers.
import { readZip } from './zip.js';
import { decodeEntities } from './xml.js';

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readFirstSheet(buf) {
  const zip = readZip(buf);
  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const xml = zip.read('xl/sharedStrings.xml').toString('utf8');
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml))) {
      // Concatenate all <t> runs (rich text has several).
      const parts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
      shared.push(decodeEntities(parts.join('')));
    }
  }
  const sheetName = zip.names.find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n)) || zip.names.find((n) => n.startsWith('xl/worksheets/sheet'));
  if (!sheetName) throw new Error('Workbook has no worksheet');
  const xml = zip.read(sheetName).toString('utf8');
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const [, ref, attrs, inner = ''] = cm;
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      let value = null;
      if (type === 'inlineStr') {
        value = decodeEntities([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v !== undefined) {
          if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'str' || type === 'e') value = decodeEntities(v);
          else if (type === 'b') value = v === '1';
          else value = Number(v);
        }
      }
      row[colIndex(ref)] = value;
    }
    rows.push(row);
  }
  return rows;
}
