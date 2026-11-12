export function simplifyClosedRing(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length === 0) return pts;
  let open = pts;
  if (pts.length >= 2) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1] || Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) {
      open = pts.slice(0, -1);
    }
  }
  if (open.length < 3) return [];
  const mid = Math.max(1, Math.floor(open.length / 2));
  const firstHalf = open.slice(0, mid + 1);
  const secondHalf = [...open.slice(mid), open[0]!];
  const s1 = douglasPeucker(firstHalf, eps);
  const s2 = douglasPeucker(secondHalf, eps);
  const simp: [number, number][] = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  if (simp.length < 3) return [];
  simp.push([simp[0]![0], simp[0]![1]]);
  return simp;
}

export function douglasPeucker(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let maxD = 0;
  let idx = 0;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i]![0] - dx * pts[i]![1] + last[0] * first[1] - last[1] * first[0]) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = douglasPeucker(pts.slice(0, idx + 1), eps);
    const right = douglasPeucker(pts.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

export function ringArea(ring: number[]): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

export function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const yi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const yj = ring[j * 2 + 1]!;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, y: number, polygon: number[][]): boolean {
  if (!polygon[0] || !pointInRing(x, y, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(x, y, polygon[i]!)) return false;
  }
  return true;
}

export function pointInPolygons(x: number, y: number, polygons: number[][][]): boolean {
  for (const poly of polygons) {
    if (pointInPolygon(x, y, poly)) return true;
  }
  return false;
}

export function separateCirclesAll(xs: number[], ys: number[], rs: number[], pad = 0.2): number {
  const n = xs.length;
  let hits = 0;
  for (let round = 0; round < 50; round++) {
    hits = 0;
    const cell = 20;
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(xs[i]! / cell);
      const iy = Math.floor(ys[i]! / cell);
      const k = `${ix},${iy}`;
      const b = grid.get(k);
      if (b) b.push(i);
      else grid.set(k, [i]);
    }
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(xs[i]! / cell);
      const iy = Math.floor(ys[i]! / cell);
      for (let adx = -1; adx <= 1; adx++) {
        for (let ady = -1; ady <= 1; ady++) {
          const b = grid.get(`${ix + adx},${iy + ady}`);
          if (!b) continue;
          for (const j of b) {
            if (j <= i) continue;
            const dx = xs[i]! - xs[j]!;
            const dy = ys[i]! - ys[j]!;
            const lim = rs[i]! + rs[j]! + pad;
            const d2 = dx * dx + dy * dy;
            if (d2 >= lim * lim) continue;
            hits++;
            const d = Math.sqrt(d2) || 1e-6;
            const push = (lim - d) / 2;
            const ux = dx / d;
            const uy = dy / d;
            xs[i]! += ux * push;
            ys[i]! += uy * push;
            xs[j]! -= ux * push;
            ys[j]! -= uy * push;
          }
        }
      }
    }
    if (hits === 0) break;
  }
  return hits;
}

export function separateCircles(xs: number[], ys: number[], rs: number[], pad = 0.08): number {
  const n = xs.length;
  let hits = 0;
  for (let round = 0; round < 80; round++) {
    hits = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[i]! - xs[j]!;
        const dy = ys[i]! - ys[j]!;
        const lim = rs[i]! + rs[j]! + pad;
        const d2 = dx * dx + dy * dy;
        if (d2 >= lim * lim) continue;
        hits++;
        const d = Math.sqrt(d2) || 1e-6;
        const push = (lim - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        xs[i]! += ux * push;
        ys[i]! += uy * push;
        xs[j]! -= ux * push;
        ys[j]! -= uy * push;
      }
    }
    if (hits === 0) break;
  }
  return hits;
}

export function circleOverlapCount(x: number[], y: number[], r: number[]): number {
  const n = x.length;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i]! - x[j]!;
      const dy = y[i]! - y[j]!;
      const lim = r[i]! + r[j]!;
      if (dx * dx + dy * dy < lim * lim - 1e-9) hits++;
    }
  }
  return hits;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (hi - i) + s[hi]! * (i - lo);
}

export function weightedMedian(items: { value: number; weight: number }[]): number {
  const usable = items.filter((x) => x.weight > 0 && Number.isFinite(x.value));
  if (usable.length === 0) return 0;
  const s = [...usable].sort((a, b) => a.value - b.value);
  const total = s.reduce((acc, x) => acc + x.weight, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return s[s.length - 1]!.value;
}

export function segmentHitsCircle(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const r2 = r * r;
  if (a2 < r2 || b2 < r2) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  let t = -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return px * px + py * py < r2;
}

export function segmentHitsAabb(
  ax: number, ay: number, bx: number, by: number,
  minX: number, minY: number, maxX: number, maxY: number,
): boolean {
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(ax, ay) || inside(bx, by)) return true;
  const hit = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return false;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  return (
    hit(ax, ay, bx, by, minX, minY, maxX, minY) ||
    hit(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
    hit(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
    hit(ax, ay, bx, by, minX, maxY, minX, minY)
  );
}
