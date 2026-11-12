import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  CITE_KIND_ALPHA_MUL,
  EDGE_BLEND,
  EDGE_FAR_OPACITY,
  EDGE_LAYER_OPACITY,
  EDGE_VERTEX_ALPHA,
  INTRA_CATEGORY_ALPHA_MUL,
  OVERVIEW_PAIR_WEIGHT,
} from '../lib/edge-style.ts';
import { STORE_ROOT } from '../lib/paths.ts';

const DEST = path.join(STORE_ROOT, 'media/m3');
const NAMES = [
  'ui-overview.png',
  'ui-overview-kind.png',
  'ui-zoomed.png',
  'ui-zoomed-deep.png',
  'ui-selected-minpo.png',
  'ui-selected-minpo-zoomed.png',
] as const;

const CSS_TOP = 80;
const CSS_BOTTOM = 80;
const CSS_LEFT = 200;
const CSS_RIGHT = 200;
const PANEL_CSS = 400;
const PANEL_INSET_CSS = 20;
const VIEW_W = 1440;
const VIEW_H = 900;
const BLOWOUT = 235;
const P1_LIMIT = 0.5;
const P2_LIMIT = 40;
const P3_LIMIT = 3;
const P3_DIFF = 15;

type Rgba = { width: number; height: number; data: Buffer };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyFilter(filter: number, row: Buffer, prev: Buffer, bpp: number): void {
  const n = row.length;
  if (filter === 0) return;
  for (let i = 0; i < n; i++) {
    const left = i >= bpp ? row[i - bpp]! : 0;
    const up = prev[i]!;
    const upLeft = i >= bpp ? prev[i - bpp]! : 0;
    let v = row[i]!;
    if (filter === 1) v = (v + left) & 255;
    else if (filter === 2) v = (v + up) & 255;
    else if (filter === 3) v = (v + ((left + up) >> 1)) & 255;
    else if (filter === 4) v = (v + paeth(left, up, upLeft)) & 255;
    else throw new Error(`bad png filter ${filter}`);
    row[i] = v;
  }
}

export function readPng(buf: Buffer): Rgba {
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a png');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats: Buffer[] = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') {
      idats.push(Buffer.from(data));
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth}`);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;
  if (bpp < 0) throw new Error(`colorType ${colorType}`);
  const inflated = inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let src = 0;
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]!;
    inflated.copy(row, 0, src, src + stride);
    src += stride;
    applyFilter(filter, row, prev, bpp);
    row.copy(prev);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 4) {
        out[o] = row[x * 4]!;
        out[o + 1] = row[x * 4 + 1]!;
        out[o + 2] = row[x * 4 + 2]!;
        out[o + 3] = row[x * 4 + 3]!;
      } else if (bpp === 3) {
        out[o] = row[x * 3]!;
        out[o + 1] = row[x * 3 + 1]!;
        out[o + 2] = row[x * 3 + 2]!;
        out[o + 3] = 255;
      } else {
        const g = row[x]!;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}

export function cropCss(hasPanel: boolean, imgW: number, imgH: number): { x0: number; y0: number; x1: number; y1: number } {
  const sx = imgW / VIEW_W;
  const sy = imgH / VIEW_H;
  const x0 = Math.round(CSS_LEFT * sx);
  const y0 = Math.round(CSS_TOP * sy);
  const y1 = imgH - Math.round(CSS_BOTTOM * sy);
  const right = hasPanel
    ? VIEW_W - PANEL_CSS - PANEL_INSET_CSS
    : VIEW_W - CSS_RIGHT;
  const x1 = Math.round(right * sx);
  return { x0, y0, x1, y1 };
}

function measure(img: Rgba, hasPanel: boolean): { p1Pct: number; p2Median: number; mapPixels: number; blowout: number } {
  const { x0, y0, x1, y1 } = cropCss(hasPanel, img.width, img.height);
  const hist = new Uint32Array(256);
  let blowout = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 4;
      const r = img.data[o]!;
      const g = img.data[o + 1]!;
      const b = img.data[o + 2]!;
      n++;
      if (r >= BLOWOUT && g >= BLOWOUT && b >= BLOWOUT) blowout++;
      const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      hist[Math.min(255, Math.max(0, luma))]!++;
    }
  }
  const mid = n / 2;
  let acc = 0;
  let median = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc >= mid) {
      median = i;
      break;
    }
  }
  return { p1Pct: n ? (100 * blowout) / n : 0, p2Median: median, mapPixels: n, blowout };
}

export function mapDiffPct(aBuf: Buffer, bBuf: Buffer, hasPanel = false): number {
  const a = readPng(aBuf);
  const b = readPng(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const { x0, y0, x1, y1 } = cropCss(hasPanel, a.width, a.height);
  let n = 0;
  let diff = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * a.width + x) * 4;
      n++;
      const d = Math.abs(a.data[o]! - b.data[o]!)
        + Math.abs(a.data[o + 1]! - b.data[o + 1]!)
        + Math.abs(a.data[o + 2]! - b.data[o + 2]!);
      if (d > P3_DIFF) diff++;
    }
  }
  return n ? (100 * diff) / n : 0;
}

async function main(): Promise<void> {
  const images: Record<string, {
    width: number;
    height: number;
    p1Pct: number;
    p2Median: number;
    mapPixels: number;
    blowout: number;
  }> = {};
  let p1MaxPct = 0;
  let p2MaxMedian = 0;
  for (const name of NAMES) {
    const buf = await readFile(path.join(DEST, name));
    const img = readPng(buf);
    const hasPanel = name.startsWith('ui-selected-');
    const m = measure(img, hasPanel);
    images[name] = { width: img.width, height: img.height, ...m };
    p1MaxPct = Math.max(p1MaxPct, m.p1Pct);
    p2MaxMedian = Math.max(p2MaxMedian, m.p2Median);
    console.log(name, JSON.stringify({ ...m, width: img.width, height: img.height }));
  }
  const overview = await readFile(path.join(DEST, 'ui-overview.png'));
  const overviewKind = await readFile(path.join(DEST, 'ui-overview-kind.png'));
  const p3Pct = mapDiffPct(overview, overviewKind, false);
  const out = {
    p1MaxPct,
    p2MaxMedian,
    p3Pct,
    p1LimitPct: P1_LIMIT,
    p2Limit: P2_LIMIT,
    p3LimitPct: P3_LIMIT,
    p1Ok: p1MaxPct <= P1_LIMIT,
    p2Ok: p2MaxMedian <= P2_LIMIT,
    p3Ok: p3Pct >= P3_LIMIT,
    images,
    settings: {
      layerOpacityNear: `${EDGE_LAYER_OPACITY} * min(4, 2^max(0, delta-1))`,
      layerOpacityFar: EDGE_FAR_OPACITY,
      vertexAlpha: EDGE_VERTEX_ALPHA,
      pairAlpha: `cross-category: vertex / sqrt(n) of (srcCat,tgtCat) with mainRefs>=${OVERVIEW_PAIR_WEIGHT}`,
      intraCategoryAlphaMul: INTRA_CATEGORY_ALPHA_MUL,
      citeKindAlphaMul: CITE_KIND_ALPHA_MUL,
      nearAboveNodesFromDelta: 3,
      citeDrawnFirst: true,
      farWeightFloor: '20 * 4^(delta-1)',
      getFilterCategory: 'accessor',
      getColor: 'binary-uint8',
      blend: {
        blendColorOperation: EDGE_BLEND.blendColorOperation,
        blendColorSrcFactor: EDGE_BLEND.blendColorSrcFactor,
        blendColorDstFactor: EDGE_BLEND.blendColorDstFactor,
      },
      clearColor: [11, 15, 20, 1],
      canvasBackground: '#0B0F14',
    },
  };
  const dest = path.join(DEST, 'screens-check.json');
  await writeFile(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(dest);
  console.log(JSON.stringify({
    p1MaxPct, p2MaxMedian, p3Pct,
    p1Ok: out.p1Ok, p2Ok: out.p2Ok, p3Ok: out.p3Ok,
  }));
}

const isDirect = process.argv[1]?.includes('check-screens');
if (isDirect) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
