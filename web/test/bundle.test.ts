import { describe, expect, it } from 'vitest';
import { bundleEdges, categoryCenters } from '../lib/bundle-edges';
import {
  CITE_KIND_ALPHA_MUL,
  EDGE_VERTEX_ALPHA,
  INTRA_CATEGORY_ALPHA_MUL,
  nearLayerOpacity,
} from '../lib/edge-style';
import { DEFAULT_KINDS, DEFAULT_TYPES } from '../lib/url-state';
import {
  farWeightFloor,
  gpuFilterCategories,
  gpuFilterRangeFar,
  gpuFilterRangeNear,
  lodLengthCutoff,
  nearWeightFloor,
  maskFilterValue,
  remapFilterCategory,
  worldScreenDiagonal,
} from '../lib/filters';
import { buildGeometryFromPacked, pairVertexAlpha } from '../lib/geometry';
import { displayLabel, labelBox, overlaps, placeLabels } from '../lib/labels';

describe('bundleEdges', () => {
  it('endpoints match law positions; 17 pts cross, 9 pts intra', () => {
    const bundled = bundleEdges({
      nLaws: 3,
      x: [0, 10, 100],
      y: [0, 0, 0],
      category: [0, 0, 1],
      nEdges: 2,
      src: [0, 0],
      tgt: [1, 2],
      categoryCount: 2,
    });
    const intraStart = bundled.startIndices[0]!;
    const intraEnd = bundled.startIndices[1]!;
    const crossStart = bundled.startIndices[1]!;
    const crossEnd = bundled.startIndices[2]!;
    expect(intraEnd - intraStart).toBe(9);
    expect(crossEnd - crossStart).toBe(17);
    expect(bundled.positions[intraStart * 2]).toBeCloseTo(0);
    expect(bundled.positions[intraStart * 2 + 1]).toBeCloseTo(0);
    const lastI = (intraEnd - 1) * 2;
    expect(bundled.positions[lastI]).toBeCloseTo(10);
    expect(bundled.positions[lastI + 1]).toBeCloseTo(0);
    expect(bundled.positions[crossStart * 2]).toBeCloseTo(0);
    const lastC = (crossEnd - 1) * 2;
    expect(bundled.positions[lastC]).toBeCloseTo(100);
    expect(bundled.positions[lastC + 1]).toBeCloseTo(0);
  });

  it('cross-category control points pull toward category centers with β=0.8', () => {
    const x = [0, 0, 90];
    const y = [0, 30, 0];
    const category = [0, 0, 1];
    const centers = categoryCenters(3, x, y, category, 2);
    const c0x = centers[0]!;
    const c0y = centers[1]!;
    const c1x = centers[2]!;
    const c1y = centers[3]!;
    const beta = 0.8;
    const q1x = beta * c0x + (1 - beta) * (0 + (1 / 3) * 90);
    const q1y = beta * c0y + (1 - beta) * (0 + (1 / 3) * 0);
    const q2x = beta * c1x + (1 - beta) * (0 + (2 / 3) * 90);
    const q2y = beta * c1y + (1 - beta) * (0 + (2 / 3) * 0);
    const bundled = bundleEdges({
      nLaws: 3, x, y, category, nEdges: 1, src: [0], tgt: [2], categoryCount: 2,
    });
    const t = 1 / 16;
    const u = 1 - t;
    const px = u * u * u * 0 + 3 * u * u * t * q1x + 3 * u * t * t * q2x + t * t * t * 90;
    const py = u * u * u * 0 + 3 * u * u * t * q1y + 3 * u * t * t * q2y + t * t * t * 0;
    expect(bundled.positions[2]).toBeCloseTo(px, 5);
    expect(bundled.positions[3]).toBeCloseTo(py, 5);
  });
});

describe('zoom LOD ranges', () => {
  it('near/far weight floors follow 5−2Δ (ceil) and 20×4^(Δ−1)', () => {
    expect(nearWeightFloor(0)).toBe(5);
    expect(nearWeightFloor(-0.4)).toBe(5);
    expect(nearWeightFloor(1)).toBe(3);
    expect(nearWeightFloor(2)).toBe(1);
    expect(nearWeightFloor(2.5)).toBe(1);
    expect(farWeightFloor(1)).toBe(20);
    expect(farWeightFloor(2)).toBe(80);
    expect(farWeightFloor(2.5)).toBeCloseTo(160);
    expect(farWeightFloor(3)).toBe(320);
  });

  it('near layer opacity is 0.12 × min(4, 2^max(0, Δ−1)); far stays 0.06', () => {
    expect(nearLayerOpacity(0)).toBeCloseTo(0.12);
    expect(nearLayerOpacity(1)).toBeCloseTo(0.12);
    expect(nearLayerOpacity(2)).toBeCloseTo(0.24);
    expect(nearLayerOpacity(2.5)).toBeCloseTo(0.12 * 2 ** 1.5);
    expect(nearLayerOpacity(3)).toBeCloseTo(0.48);
    expect(nearLayerOpacity(5)).toBeCloseTo(0.48);
  });

  it('length cutoff is ∞ at Δ≤0.5 and 0.6× screen diagonal in world units after that', () => {
    const w = 1440;
    const h = 900;
    const fit = -1.2;
    expect(lodLengthCutoff(w, h, fit, fit)).toBe(1e6);
    expect(lodLengthCutoff(w, h, fit + 0.5, fit)).toBe(1e6);
    const z = fit + 1;
    expect(lodLengthCutoff(w, h, z, fit)).toBeCloseTo(worldScreenDiagonal(w, h, z) * 0.6);
  });

  it('gpu filterRange is 4 channels: weights then endpoint length', () => {
    const near = gpuFilterRangeNear('main', 1, 5, 120);
    expect(near).toHaveLength(4);
    expect(near[0]).toEqual([5, 1e6]);
    expect(near[1]).toEqual([-1e6, 1e6]);
    expect(near[2]).toEqual([-1e6, 1e6]);
    expect(near[3]).toEqual([-1e6, 120]);
    const far = gpuFilterRangeFar('all', 1, 20, 120);
    expect(far).toHaveLength(4);
    expect(far[2]).toEqual([20, 1e6]);
    expect(far[3]![0]).toBeCloseTo(120 + 1e-4);
    expect(far[3]![1]).toBe(1e6);
  });
});

describe('remapFilterCategory identity keys', () => {
  it('maps cite (7) onto a key that filterCategories will set, not raw 7', () => {
    const n = 3;
    const raw = new Uint8Array([
      7, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 1,
    ]);
    const mapped = remapFilterCategory(raw, n, DEFAULT_KINDS, DEFAULT_TYPES, false);
    const cats = gpuFilterCategories(DEFAULT_KINDS, DEFAULT_TYPES, false);
    expect(DEFAULT_KINDS).not.toContain(2);
    expect(mapped[0]).toBe(DEFAULT_KINDS.indexOf(7));
    expect(mapped[0]).toBeLessThan(cats[0]!.length);
    expect(mapped[4]).toBe(31);
    expect(mapped[8]).toBe(DEFAULT_KINDS.indexOf(0));
    expect(mapped[11]).toBe(1);
  });
});

describe('maskFilterValue', () => {
  it('zeros hidden kinds so GPU range drops them', () => {
    const n = 2;
    const filterValue = new Float32Array([9, 0, 9, 10, 9, 0, 9, 10]);
    const raw = new Uint8Array([7, 0, 0, 0, 2, 0, 0, 0]);
    const masked = maskFilterValue(filterValue, raw, n, DEFAULT_KINDS, DEFAULT_TYPES, false);
    expect(masked[0]).toBe(9);
    expect(masked[4]).toBe(-1);
    expect(masked[5]).toBe(-1);
  });
});

describe('displayLabel', () => {
  it('replaces fullwidth nakaguro with a tight middle dot', () => {
    expect(displayLabel('司法・治安')).toBe('司法·治安');
    expect(displayLabel('民事・商事・金融')).toBe('民事·商事·金融');
  });
});

describe('pair vertex alpha', () => {
  it('divides by sqrt of pair count only for cross-category edges', () => {
    expect(pairVertexAlpha(1)).toBe(EDGE_VERTEX_ALPHA);
    expect(pairVertexAlpha(4)).toBe(Math.round(EDGE_VERTEX_ALPHA / 2));
    expect(pairVertexAlpha(400, { intra: true })).toBe(Math.round(EDGE_VERTEX_ALPHA * INTRA_CATEGORY_ALPHA_MUL));
    expect(pairVertexAlpha(1, { cite: true })).toBe(Math.round(EDGE_VERTEX_ALPHA * CITE_KIND_ALPHA_MUL));
    expect(pairVertexAlpha(9, { intra: true, cite: true })).toBe(
      Math.round(EDGE_VERTEX_ALPHA * INTRA_CATEGORY_ALPHA_MUL * CITE_KIND_ALPHA_MUL),
    );
    const packed = {
      nLaws: 3,
      x: new Float32Array([0, 10, 100]),
      y: new Float32Array([0, 0, 0]),
      category: new Uint16Array([0, 0, 1]),
      type: new Uint8Array([0, 0, 0]),
      nEdges: 3,
      src: new Uint32Array([0, 0, 0]),
      tgt: new Uint32Array([2, 2, 1]),
      mainRefs: new Float32Array([9, 6, 9]),
      supplRefs: new Float32Array([0, 0, 0]),
      domKind: new Uint8Array([7, 0, 7]),
      intraFamily: new Uint8Array([0, 0, 0]),
      categoryColors: new Uint8Array([10, 20, 30, 40, 50, 60]),
      categoryCount: 2,
    };
    const geo = buildGeometryFromPacked(packed);
    expect(geo.packedIndex[0]).toBe(0);
    expect(geo.packedIndex[2]).toBe(1);
    expect(geo.packedIndex[1]).toBe(2);
    expect(geo.filterCategory[0]).toBe(7);
    expect(geo.filterCategory[4]).toBe(7);
    expect(geo.filterCategory[8]).toBe(0);
    const pairCross = 2;
    expect(geo.colorByCategory[3]).toBe(pairVertexAlpha(pairCross));
    expect(geo.colorByCategory[7]).toBe(pairVertexAlpha(1, { intra: true }));
    expect(geo.colorByCategory[11]).toBe(pairVertexAlpha(pairCross));
    expect(geo.colorByKind[3]).toBe(pairVertexAlpha(pairCross, { cite: true }));
    expect(geo.colorByKind[7]).toBe(pairVertexAlpha(1, { intra: true, cite: true }));
    expect(geo.colorByKind[11]).toBe(pairVertexAlpha(pairCross));
  });
});

describe('placeLabels', () => {
  it('keeps 租特法 off the 財政・税 group name', () => {
    const zoom = -1.4364211846800803;
    const group = labelBox(-580.8, -16.4, '財政·税', zoom, 16);
    const placed = placeLabels(
      [{ position: [-523.7, -38.1] as [number, number], text: '租特法', priority: 800 }],
      zoom,
      [group],
    );
    for (const p of placed) {
      expect(overlaps(group, labelBox(p.position[0], p.position[1], p.text, zoom))).toBe(false);
    }
  });

  it('keeps 船舶登記令 and 戸籍法 from overlapping around 民法 at overview zoom', () => {
    const zoom = -1.4364211846800803;
    const items = [
      { position: [-378.8, -206.6] as [number, number], text: '民法', priority: 1000, locked: true },
      { position: [-351.1, -220.3] as [number, number], text: '戸籍法', priority: 900 },
      { position: [-448.5, -218.4] as [number, number], text: '船舶登記令', priority: 850 },
      { position: [-412.9, -217.2] as [number, number], text: '家事事件手続法', priority: 880 },
      { position: [-409.1, -205.5] as [number, number], text: '民法施行法', priority: 820 },
      { position: [-471.4, -234.0] as [number, number], text: '非訟法', priority: 870 },
    ];
    const placed = placeLabels(items, zoom);
    const byText = new Map(placed.map((p) => [p.text, p]));
    expect(byText.has('民法')).toBe(true);
    const a = byText.get('船舶登記令');
    const b = byText.get('戸籍法');
    if (a && b) {
      expect(overlaps(
        labelBox(a.position[0], a.position[1], a.text, zoom),
        labelBox(b.position[0], b.position[1], b.text, zoom),
      )).toBe(false);
    }
    const boxes = placed.map((p) => labelBox(p.position[0], p.position[1], p.text, zoom));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });
});
