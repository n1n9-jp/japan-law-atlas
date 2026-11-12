import type { LawType } from '../../lib/shared/contract.ts';
import { parentScore, type PairAgg } from './edges.ts';

export const CAN_HAVE_PARENT = new Set<LawType>([
  'CabinetOrder',
  'ImperialOrder',
  'MinisterialOrdinance',
  'Rule',
  'Misc',
]);

export const CAN_BE_PARENT = new Set<LawType>([
  'Constitution',
  'Act',
  'CabinetOrder',
  'ImperialOrder',
]);

export interface FamilyNode {
  lawId: string;
  title: string;
  lawType: LawType;
}

export function pickParent(
  child: FamilyNode,
  outgoing: PairAgg[],
  byId: Map<string, FamilyNode>,
): string | null {
  if (!CAN_HAVE_PARENT.has(child.lawType)) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  let bestMain = -1;
  let bestPref = -1;
  for (const p of outgoing) {
    const tgt = byId.get(p.tgtLaw);
    if (!tgt || !CAN_BE_PARENT.has(tgt.lawType)) continue;
    const score = parentScore(p);
    if (score <= 0) continue;
    const pref = tgt.lawType === 'Act' || tgt.lawType === 'Constitution' ? 1 : 0;
    if (
      score > bestScore ||
      (score === bestScore && (pref > bestPref || (pref === bestPref && (p.mainRefs > bestMain || (p.mainRefs === bestMain && p.tgtLaw < (bestId ?? '\uffff'))))))
    ) {
      bestScore = score;
      bestMain = p.mainRefs;
      bestPref = pref;
      bestId = p.tgtLaw;
    }
  }
  if (bestId) return bestId;

  let bestTitle = '';
  let bestPrefix: string | null = null;
  for (const p of outgoing) {
    if (p.mainRefs <= 0) continue;
    const tgt = byId.get(p.tgtLaw);
    if (!tgt || tgt.lawType !== 'Act') continue;
    if (tgt.title.length === 0) continue;
    if (!child.title.startsWith(tgt.title)) continue;
    if (tgt.title.length > bestTitle.length || (tgt.title.length === bestTitle.length && tgt.lawId < (bestPrefix ?? '\uffff'))) {
      bestTitle = tgt.title;
      bestPrefix = tgt.lawId;
    }
  }
  return bestPrefix;
}

export function assignFamilies(
  nodes: FamilyNode[],
  parentOf: Map<string, string | null>,
): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.lawId, n]));
  const cycleRoot = new Map<string, string>();

  for (const n of nodes) {
    const cyc = findCycle(n.lawId, parentOf, byId);
    if (!cyc) continue;
    const root = [...cyc].sort()[0]!;
    for (const id of cyc) cycleRoot.set(id, root);
  }

  const family = new Map<string, string>();
  for (const n of nodes) {
    family.set(n.lawId, walkRoot(n.lawId, parentOf, byId, cycleRoot));
  }
  return family;
}

function findCycle(
  start: string,
  parentOf: Map<string, string | null>,
  byId: Map<string, FamilyNode>,
): string[] | null {
  const path: string[] = [];
  const idx = new Map<string, number>();
  let cur: string | null = start;
  while (cur) {
    if (idx.has(cur)) return path.slice(idx.get(cur)!);
    idx.set(cur, path.length);
    path.push(cur);
    const node = byId.get(cur);
    if (!node) return null;
    if (node.lawType === 'Act' || node.lawType === 'Constitution') return null;
    cur = parentOf.get(cur) ?? null;
  }
  return null;
}

function walkRoot(
  start: string,
  parentOf: Map<string, string | null>,
  byId: Map<string, FamilyNode>,
  cycleRoot: Map<string, string>,
): string {
  const seen = new Set<string>();
  let cur = start;
  for (;;) {
    if (cycleRoot.has(cur)) return cycleRoot.get(cur)!;
    if (seen.has(cur)) return cur;
    seen.add(cur);
    const node = byId.get(cur);
    if (!node) return cur;
    if (node.lawType === 'Act' || node.lawType === 'Constitution') return cur;
    const p = parentOf.get(cur);
    if (!p) return cur;
    cur = p;
  }
}
