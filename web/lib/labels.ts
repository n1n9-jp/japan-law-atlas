/** 全角中黒は TextLayer / SDF の advance が広すぎるので、組んだ見た目の中黒に差し替える。 */
export const FULLWIDTH_NAKAGURO = '・';
export const TIGHT_NAKAGURO = '·';

export function displayLabel(text: string): string {
  return text.replaceAll(FULLWIDTH_NAKAGURO, TIGHT_NAKAGURO);
}

export function charsetFrom(texts: string[]): string[] {
  const chars = new Set<string>();
  for (const text of texts) {
    for (const ch of displayLabel(text)) chars.add(ch);
  }
  chars.add(FULLWIDTH_NAKAGURO);
  chars.add(TIGHT_NAKAGURO);
  return [...chars];
}

export type LabelBox = { x0: number; y0: number; x1: number; y1: number };

export type PlaceableLabel = {
  position: [number, number];
  text: string;
  priority: number;
  locked?: boolean;
};

export function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** Noto Sans JP 漢字に合わせた衝突箱。法令名は 11px、まとまりは 16px。 */
export function labelBox(x: number, y: number, text: string, zoom: number, fontPx = 11): LabelBox {
  const s = 2 ** zoom;
  const pad = 3 / s;
  const h = (fontPx + 5) / s;
  const charW = fontPx / s;
  const w = Math.max([...text].length, 1) * charW;
  return {
    x0: x - w / 2 - pad,
    y0: y - h / 2 - pad,
    x1: x + w / 2 + pad,
    y1: y + h / 2 + pad,
  };
}

function makeOffsets(): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([x, y]);
  };
  add(0, -18);
  add(0, 18);
  add(24, 0);
  add(-24, 0);
  for (const r of [20, 32, 46, 62, 80]) {
    const n = r <= 32 ? 8 : 12;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      add(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r));
    }
  }
  add(0, 0);
  return out;
}

const OFFSETS_PX = makeOffsets();

export function placeLabels<T extends PlaceableLabel>(
  items: T[],
  zoom: number,
  blocked: LabelBox[] = [],
): T[] {
  const s = 2 ** zoom;
  const sorted = [...items].sort((a, b) => {
    if (a.locked && !b.locked) return -1;
    if (!a.locked && b.locked) return 1;
    return b.priority - a.priority;
  });
  const boxes: LabelBox[] = [...blocked];
  const out: T[] = [];
  for (const item of sorted) {
    const tries = item.locked || item.priority >= 700 ? OFFSETS_PX : OFFSETS_PX.slice(0, 8);
    let placed: T | null = null;
    for (const [ox, oy] of tries) {
      const x = item.position[0] + ox / s;
      const y = item.position[1] + oy / s;
      const box = labelBox(x, y, item.text, zoom);
      if (boxes.some((b) => overlaps(box, b))) continue;
      placed = { ...item, position: [x, y] };
      boxes.push(box);
      break;
    }
    if (placed) {
      out.push(placed);
      continue;
    }
    if (item.locked) {
      for (const [ox, oy] of OFFSETS_PX) {
        const x = item.position[0] + ox / s;
        const y = item.position[1] + oy / s;
        const box = labelBox(x, y, item.text, zoom);
        if (boxes.some((b) => overlaps(box, b))) continue;
        placed = { ...item, position: [x, y] };
        boxes.push(box);
        break;
      }
      if (!placed) {
        const x = item.position[0];
        const y = item.position[1] - 22 / s;
        out.push({ ...item, position: [x, y] });
        boxes.push(labelBox(x, y, item.text, zoom));
      } else {
        out.push(placed);
      }
    }
  }
  return out;
}

/** 画面上の CSS 矩形を Orthographic のワールド座標へ。pan と同じ変換。 */
export function screenRectToWorld(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
  zoom: number,
  target: [number, number, number],
): LabelBox {
  const s = 2 ** zoom;
  const toWorld = (sx: number, sy: number): [number, number] => [
    target[0] + (sx - width / 2) / s,
    target[1] + (sy - height / 2) / s,
  ];
  const [wx0, wy0] = toWorld(x0, y0);
  const [wx1, wy1] = toWorld(x1, y1);
  return {
    x0: Math.min(wx0, wx1),
    y0: Math.min(wy0, wy1),
    x1: Math.max(wx0, wx1),
    y1: Math.max(wy0, wy1),
  };
}

export function chromeWorldBoxes(
  width: number,
  height: number,
  zoom: number,
  target: [number, number, number],
): LabelBox[] {
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    screenRectToWorld(x0, y0, x1, y1, width, height, zoom, target);
  return [
    rect(0, 0, 320, 96),
    rect(width / 2 - 260, 0, width / 2 + 260, 72),
    rect(width / 2 - 380, height - 40, width / 2 + 380, height),
  ];
}
