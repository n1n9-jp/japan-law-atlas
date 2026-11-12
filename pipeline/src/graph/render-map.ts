import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { GraphState } from './types.ts';
import { sortNodes } from './write-web.ts';

export function renderMapPng(state: GraphState, destPath: string): void {
  const w = 3000;
  const h = 3000;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);

  const [minX, minY, maxX, maxY] = state.bounds;
  const pad = 50;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const s = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = (w - spanX * s) / 2;
  const oy = (h - spanY * s) / 2;
  const X = (x: number) => ox + (x - minX) * s;
  const Y = (y: number) => h - (oy + (y - minY) * s);

  for (const cat of state.continents.categories) {
    const color = state.categories[cat.id]?.color ?? [80, 90, 100];
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.22)`;
    ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.7)`;
    ctx.lineWidth = 1.2;
    for (const poly of cat.polygons) {
      const outer = poly[0];
      if (!outer || outer.length < 6) continue;
      ctx.beginPath();
      ctx.moveTo(X(outer[0]!), Y(outer[1]!));
      for (let i = 2; i < outer.length; i += 2) ctx.lineTo(X(outer[i]!), Y(outer[i + 1]!));
      ctx.closePath();
      for (let r = 1; r < poly.length; r++) {
        const hole = poly[r]!;
        if (hole.length < 6) continue;
        ctx.moveTo(X(hole[0]!), Y(hole[1]!));
        for (let i = 2; i < hole.length; i += 2) ctx.lineTo(X(hole[i]!), Y(hole[i + 1]!));
        ctx.closePath();
      }
      ctx.fill('evenodd');
      ctx.stroke();
    }
  }

  const byId = new Map(state.nodes.map((n) => [n.lawId, n]));
  const top = [...state.pairs]
    .filter((p) => p.mainRefs > 0)
    .sort((a, b) => b.mainRefs - a.mainRefs)
    .slice(0, 20000);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(200,220,255,0.04)';
  ctx.lineWidth = 0.8;
  for (const p of top) {
    const a = byId.get(p.srcLaw);
    const b = byId.get(p.tgtLaw);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y));
    ctx.lineTo(X(b.x), Y(b.y));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  const ordered = sortNodes(state.nodes);
  for (const n of ordered) {
    const color = n.ghost ? [154, 163, 174] : (state.categories[n.category]?.color ?? [200, 200, 200]);
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.beginPath();
    ctx.arc(X(n.x), Y(n.y), Math.max(1.2, n.r * s * 0.9), 0, Math.PI * 2);
    ctx.fill();
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, canvas.toBuffer('image/png'));
}
