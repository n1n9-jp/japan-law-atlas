import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAcceptableDictName } from './names.js';
import { Trie } from './trie.js';
import type { LawDict, NameHit, NameSource, SlimMeta } from './types.js';

const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../vendor/jlawcite');

const SOURCE_RANK: Record<NameSource, number> = {
  title: 0,
  oldTitle: 1,
  egovAbbrev: 2,
  jlaw: 3,
};

export interface JlawMaps {
  aliasToTitle: Map<string, string>;
}

export function loadJlawMaps(dir = VENDOR_DIR): JlawMaps {
  const aliasToTitle = new Map<string, string>();
  for (const file of ['jp_abbrev_kit.json', 'jp_law_aliases.json']) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('_')) continue;
      if (!aliasToTitle.has(k)) aliasToTitle.set(k, v);
    }
  }
  return { aliasToTitle };
}

export function buildDict(laws: SlimMeta[], jlaw: JlawMaps = loadJlawMaps()): LawDict {
  const byId = new Map<string, SlimMeta>();
  const byNum = new Map<string, string[]>();
  for (const m of laws) {
    byId.set(m.lawId, m);
    if (m.numNorm) {
      const arr = byNum.get(m.numNorm) ?? [];
      arr.push(m.lawId);
      byNum.set(m.numNorm, arr);
    }
  }

  type Cand = { lawId: string; status: SlimMeta['status']; source: NameSource };
  const nameCands = new Map<string, Cand[]>();
  let droppedNames = 0;

  const add = (name: string, lawId: string, status: SlimMeta['status'], source: NameSource) => {
    if (!name) return;
    if (!isAcceptableDictName(name, source)) {
      droppedNames++;
      return;
    }
    const arr = nameCands.get(name) ?? [];
    arr.push({ lawId, status, source });
    nameCands.set(name, arr);
  };

  for (const m of laws) {
    add(m.title, m.lawId, m.status, 'title');
    for (const t of m.oldTitles) add(t, m.lawId, m.status, 'oldTitle');
    for (const a of m.abbrevs) add(a, m.lawId, m.status, 'egovAbbrev');
  }

  for (const [alias, title] of jlaw.aliasToTitle) {
    const hits = nameCands.get(title);
    if (!hits) continue;
    const resolved = pickUnique(hits);
    if (!resolved) continue;
    add(alias, resolved.lawId, resolved.status, 'jlaw');
  }

  const trie = new Trie<NameHit>();
  const ambiguousNames: string[] = [];
  let droppedAmbiguous = 0;
  for (const [name, cands] of nameCands) {
    const picked = pickUnique(cands);
    if (!picked) {
      ambiguousNames.push(name);
      droppedAmbiguous++;
      continue;
    }
    const sources = cands.filter((c) => c.lawId === picked.lawId).map((c) => c.source);
    const source = sources.reduce((best, s) => (SOURCE_RANK[s] < SOURCE_RANK[best] ? s : best), sources[0]!);
    trie.insert(name, {
      lawId: picked.lawId,
      title: name,
      source,
    });
  }

  return {
    byNum,
    byId,
    stats: {
      ambiguousNames: ambiguousNames.sort(),
      nameCount: trie.size,
      numCount: byNum.size,
      droppedAmbiguous,
      droppedNames,
    },
    longestName(text, i) {
      const hit = trie.longestMatch(text, i);
      return hit ? { end: hit.end, hit: hit.value } : null;
    },
  };
}

function pickUnique(cands: { lawId: string; status: SlimMeta['status'] }[]): { lawId: string; status: SlimMeta['status'] } | null {
  const uniq = new Map<string, { lawId: string; status: SlimMeta['status'] }>();
  for (const c of cands) uniq.set(c.lawId, c);
  const current = [...uniq.values()].filter((c) => c.status !== 'repealed');
  const pool = current.length > 0 ? current : [...uniq.values()];
  if (pool.length === 1) return pool[0]!;
  return null;
}

export function lookupNum(dict: LawDict, numNorm: string): SlimMeta | null {
  const ids = dict.byNum.get(numNorm);
  if (!ids || ids.length === 0) return null;
  const metas = ids.map((id) => dict.byId.get(id)).filter((m): m is SlimMeta => !!m);
  const current = metas.filter((m) => m.status !== 'repealed');
  const pool = current.length > 0 ? current : metas;
  if (pool.length === 1) return pool[0]!;
  return pool[0] ?? null;
}
