import { describe, expect, it } from 'vitest';
import { orientAndNudge, softEnclose } from '../../src/graph/layout.ts';

describe('within-category orientation and enclosure', () => {
  it('rotates and nudges so the centroid goes +x when every pull is +x', () => {
    const pts = [
      { x: -2, y: 8 },
      { x: 1, y: 6 },
      { x: 0, y: 10 },
    ];
    const pulls = pts.map(() => ({ x: 1, y: 0 }));
    const s = [0.4, 0.5, 0.6];
    orientAndNudge(pts, pulls, 20, s);
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    expect(cx).toBeGreaterThan(0);
    expect(Math.abs(cx)).toBeGreaterThan(Math.abs(cy));
  });

  it('soft enclosure keeps every point inside the circle of radius rho', () => {
    const rho = 40;
    const pts = [
      { x: 0, y: 0 },
      { x: 38, y: 0 },
      { x: 200, y: 0 },
      { x: -80, y: 80 },
    ];
    softEnclose(pts, rho);
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(rho + 1e-9);
    }
    expect(Math.hypot(pts[2]!.x, pts[2]!.y)).toBeGreaterThan(0.92 * rho);
    expect(Math.hypot(pts[2]!.x, pts[2]!.y)).toBeLessThanOrEqual(rho + 1e-9);
  });
});
