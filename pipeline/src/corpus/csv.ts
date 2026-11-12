export interface CsvRow {
  oldTitles: string[];
  kana: string;
}

export function parseLawListCsv(text: string): Map<string, CsvRow> {
  const raw = text.replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]?.split(',') ?? [];
  const idx = (name: string): number => header.indexOf(name);
  const iOld = idx('旧法令名');
  const iKana = idx('法令名読み');
  const iId = idx('法令ID');
  const iPending = idx('未施行');
  const map = new Map<string, CsvRow>();
  for (const line of lines.slice(1)) {
    const cols = splitCsv(line);
    const lawId = cols[iId] ?? '';
    const pending = (cols[iPending] ?? '').trim();
    if (!lawId || pending !== '') continue;
    if (map.has(lawId)) continue;
    const oldRaw = cols[iOld] ?? '';
    const oldTitles = oldRaw
      .split('、')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    map.set(lawId, { oldTitles, kana: cols[iKana] ?? '' });
  }
  return map;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
