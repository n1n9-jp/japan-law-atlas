export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(text: string): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) {
    throw new Error('unterminated quoted CSV field');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]!] = row[c] ?? '';
    }
    out.push(obj);
  }
  return out;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\n') + '\n';
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
