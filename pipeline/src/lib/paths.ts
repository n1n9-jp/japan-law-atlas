import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_STORE = '/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3';

export function resolveStore(storeArg: string | undefined): string {
  return path.resolve(storeArg ?? process.env.HOUREI_STORE ?? process.env.STORE ?? DEFAULT_STORE);
}

export function cacheDir(snapshotId: string, cacheArg?: string): string {
  return path.resolve(cacheArg ?? `/tmp/hourei-cache/egov/${snapshotId}`);
}

export function corpusDir(store: string, snapshotId: string): string {
  return path.join(store, 'data', 'corpus', snapshotId);
}

export function latestPath(store: string): string {
  return path.join(store, 'data', 'corpus', 'LATEST');
}

export function readLatest(store: string): string | null {
  const p = latestPath(store);
  if (!fs.existsSync(p)) return null;
  const id = fs.readFileSync(p, 'utf8').trim();
  return id.length > 0 ? id : null;
}

export function jstTodayStamp(): { snapshotId: string; asof: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';
  const day = parts.find((p) => p.type === 'day')?.value ?? '00';
  return { snapshotId: `${year}${month}${day}`, asof: `${year}-${month}-${day}` };
}

export function xmlPath(cache: string, revisionId: string): string {
  return path.join(cache, revisionId, `${revisionId}.xml`);
}
