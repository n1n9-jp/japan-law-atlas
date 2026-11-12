export interface ViewTarget {
  target: [number, number, number];
  zoom: number;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function fitZoomForBounds(
  bounds: [number, number, number, number],
  width: number,
  height: number,
  padding = 0.12,
): number {
  const [minX, minY, maxX, maxY] = bounds;
  const worldW = Math.max(maxX - minX, 1);
  const worldH = Math.max(maxY - minY, 1);
  const zx = Math.log2((width * (1 - padding)) / worldW);
  const zy = Math.log2((height * (1 - padding)) / worldH);
  return Math.min(zx, zy);
}

export function screenDeltaToWorld(px: number, py: number, zoom: number): [number, number] {
  const s = 2 ** zoom;
  return [px / s, py / s];
}

export function worldDeltaToScreen(dx: number, dy: number, zoom: number): number {
  const s = 2 ** zoom;
  return Math.hypot(dx * s, dy * s);
}

export const EASE_IN_OUT = (t: number): number => {
  // cubic-bezier(0.77, 0, 0.175, 1)
  return bezierY(0.77, 0, 0.175, 1, t);
};

function bezierY(x1: number, y1: number, x2: number, y2: number, x: number): number {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xt = cubic(t, x1, x2);
    const dx = sampleDeriv(t, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    t -= (xt - x) / dx;
    t = clamp(t, 0, 1);
  }
  return cubic(t, y1, y2);
}

function cubic(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

function sampleDeriv(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
}

export function cameraDurationMs(deltaZoom: number, screenPx: number): number {
  return clamp(220 + 90 * Math.abs(deltaZoom) + 0.15 * screenPx, 240, 520);
}

export function boundsOfPoints(xs: number[], ys: number[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    minX = Math.min(minX, xs[i]!);
    minY = Math.min(minY, ys[i]!);
    maxX = Math.max(maxX, xs[i]!);
    maxY = Math.max(maxY, ys[i]!);
  }
  return [minX, minY, maxX, maxY];
}
