import { LAW_TYPES, REF_KINDS } from './shared/contract';

export type PartsFilter = 'main' | 'suppl' | 'all';
export type ColorMode = 'category' | 'kind';

export interface AtlasUrlState {
  law: string | null;
  edge: { src: string; tgt: string } | null;
  kinds: number[];
  parts: PartsFilter;
  types: number[];
  minRefs: number;
  color: ColorMode;
  focus: { kind: 'group' | 'category'; id: number } | null;
  view: { x: number; y: number; zoom: number } | null;
}

export const DEFAULT_KINDS: number[] = REF_KINDS.map((_, i) => i).filter((i) => REF_KINDS[i] !== 'amend');
export const DEFAULT_TYPES: number[] = LAW_TYPES.map((_, i) => i);

export function defaultUrlState(): AtlasUrlState {
  return {
    law: null,
    edge: null,
    kinds: [...DEFAULT_KINDS],
    parts: 'main',
    types: [...DEFAULT_TYPES],
    minRefs: 1,
    color: 'category',
    focus: null,
    view: null,
  };
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function parseUrlState(search: string): AtlasUrlState {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const state = defaultUrlState();
  const law = p.get('law');
  if (law) state.law = law;
  const edge = p.get('edge');
  if (edge && edge.includes('~')) {
    const [src, tgt] = edge.split('~');
    if (src && tgt) state.edge = { src, tgt };
  }
  const kinds = p.get('kinds');
  if (kinds) {
    state.kinds = kinds.split(',').map(Number).filter((n) => n >= 0 && n < REF_KINDS.length);
  }
  const parts = p.get('parts');
  if (parts === 'main' || parts === 'suppl' || parts === 'all') state.parts = parts;
  const types = p.get('types');
  if (types) {
    state.types = types.split(',').map(Number).filter((n) => n >= 0 && n < LAW_TYPES.length);
  }
  const minRefs = p.get('minRefs');
  if (minRefs) {
    const n = Number(minRefs);
    if (n >= 1 && n <= 20) state.minRefs = n;
  }
  const color = p.get('color');
  if (color === 'category' || color === 'kind') state.color = color;
  const focus = p.get('focus');
  if (focus) {
    const g = /^g(\d+)$/.exec(focus);
    const c = /^c(\d+)$/.exec(focus);
    if (g) state.focus = { kind: 'group', id: Number(g[1]) };
    if (c) state.focus = { kind: 'category', id: Number(c[1]) };
  }
  const v = p.get('v');
  if (v) {
    const [x, y, zoom] = v.split(',').map(Number);
    if ([x, y, zoom].every((n) => Number.isFinite(n))) {
      state.view = { x: x!, y: y!, zoom: zoom! };
    }
  }
  return state;
}

export function serializeUrlState(state: AtlasUrlState): string {
  const p = new URLSearchParams();
  if (state.law) p.set('law', state.law);
  if (state.edge) p.set('edge', `${state.edge.src}~${state.edge.tgt}`);
  if (!sameSet(state.kinds, DEFAULT_KINDS)) p.set('kinds', [...state.kinds].sort((a, b) => a - b).join(','));
  if (state.parts !== 'main') p.set('parts', state.parts);
  if (!sameSet(state.types, DEFAULT_TYPES)) p.set('types', [...state.types].sort((a, b) => a - b).join(','));
  if (state.minRefs !== 1) p.set('minRefs', String(state.minRefs));
  if (state.color !== 'category') p.set('color', state.color);
  if (state.focus) p.set('focus', `${state.focus.kind === 'group' ? 'g' : 'c'}${state.focus.id}`);
  if (state.view) {
    p.set('v', `${Math.round(state.view.x)},${Math.round(state.view.y)},${state.view.zoom.toFixed(2)}`);
  }
  return p.toString();
}

export function urlHasUserState(search: string): boolean {
  const s = parseUrlState(search);
  const d = defaultUrlState();
  return Boolean(
    s.law || s.edge || s.view || s.focus
    || s.parts !== d.parts || s.minRefs !== d.minRefs || s.color !== d.color
    || !sameSet(s.kinds, d.kinds) || !sameSet(s.types, d.types),
  );
}
