import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { layoutEdgeWeight } from './edges.ts';
import { hubLawIds } from './layout-metrics.ts';
import type { GraphState } from './types.ts';

const FRAME = 1200;
const W = FRAME * 3;
const H = FRAME;
const PAD = 40;
const INNER = 1160;

function mapX(frame: number, x: number): number {
  return frame * FRAME + PAD + ((x + 1000) / 2000) * (INNER - PAD);
}
function mapY(y: number): number {
  return H - (PAD + ((y + 1000) / 2000) * (INNER - PAD));
}

function drawFrame(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, frame: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame * FRAME, 0, FRAME, FRAME);
  ctx.clip();
  const cx = mapX(frame, 0);
  const cy = mapY(0);
  const r = mapX(frame, 250) - mapX(frame, 0);
  ctx.strokeStyle = '#f5d76e';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.abs(r), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function renderLayoutCheck(state: GraphState, destPath: string): void {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);

  const hubs = new Set(hubLawIds(state.nodes, state.pairs, 30));
  const byId = new Map(state.nodes.map((n) => [n.lawId, n]));
  const edges = state.pairs
    .map((p) => {
      const w = layoutEdgeWeight(p);
      if (w <= 0) return null;
      const a = byId.get(p.srcLaw);
      const b = byId.get(p.tgtLaw);
      if (!a || !b) return null;
      const len = Math.hypot(a.x - b.x, a.y - b.y);
      return { a, b, len };
    })
    .filter((e): e is { a: typeof state.nodes[0]; b: typeof state.nodes[0]; len: number } => e !== null);

  for (let f = 0; f < 3; f++) drawFrame(ctx, f);

  // A: nodes
  {
    const f = 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FRAME, FRAME);
    ctx.clip();
    for (const n of state.nodes) {
      const color = n.ghost ? [154, 163, 174] : (state.categories[n.category]?.color ?? [200, 200, 200]);
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.beginPath();
      ctx.arc(mapX(f, n.x), mapY(n.y), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    for (const n of state.nodes) {
      if (!hubs.has(n.lawId)) continue;
      ctx.beginPath();
      ctx.arc(mapX(f, n.x), mapY(n.y), 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // B: all main edges
  {
    const f = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(FRAME, 0, FRAME, FRAME);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,255,255,0.006)';
    ctx.lineWidth = 1;
    for (const e of edges) {
      ctx.beginPath();
      ctx.moveTo(mapX(f, e.a.x), mapY(e.a.y));
      ctx.lineTo(mapX(f, e.b.x), mapY(e.b.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  // C: long edges > 500
  {
    const f = 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(FRAME * 2, 0, FRAME, FRAME);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,90,60,0.01)';
    ctx.lineWidth = 1;
    for (const e of edges) {
      if (e.len <= 500) continue;
      ctx.beginPath();
      ctx.moveTo(mapX(f, e.a.x), mapY(e.a.y));
      ctx.lineTo(mapX(f, e.b.x), mapY(e.b.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, canvas.toBuffer('image/png'));
}
