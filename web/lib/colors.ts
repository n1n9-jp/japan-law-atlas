import { LAW_TYPES, REF_KINDS, type RefKind } from './shared/contract';

export const KIND_HEX: Record<RefKind, string> = {
  basis: '#F2B84B',
  implements: '#F5D58A',
  amend: '#8A94A6',
  junyo: '#B48CF2',
  rei: '#F28CC0',
  exclude: '#F2766B',
  term: '#5CC8E0',
  cite: '#D9DEE7',
};

export const KIND_RGB: [number, number, number][] = REF_KINDS.map((k) => hexToRgb(KIND_HEX[k]));

export const BG_RGB: [number, number, number] = [11, 15, 20];
export const ACCENT_RGB: [number, number, number] = [138, 180, 255];
export const GHOST_RGB: [number, number, number] = [154, 163, 174];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbCss(rgb: [number, number, number], a = 1): string {
  return a === 1 ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

export function lighten(rgb: [number, number, number], t = 0.35): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * t),
    Math.round(rgb[1] + (255 - rgb[1]) * t),
    Math.round(rgb[2] + (255 - rgb[2]) * t),
  ];
}

export function typeLabel(i: number): string {
  return LAW_TYPES[i] ?? 'Misc';
}
