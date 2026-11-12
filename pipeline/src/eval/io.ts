import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';

export async function forEachJsonlGzLine(
  filePath: string,
  fn: (parsed: unknown, lineNo: number) => void | Promise<void>,
): Promise<void> {
  const stream = createReadStream(filePath).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    if (line.trim() === '') continue;
    await fn(JSON.parse(line) as unknown, lineNo);
  }
}

export async function readJsonlGz<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const out: T[] = [];
  await forEachJsonlGzLine(filePath, (parsed, lineNo) => {
    const v = schema.safeParse(parsed);
    if (!v.success) {
      throw new Error(`${filePath}:${lineNo}: ${v.error.message}`);
    }
    out.push(v.data);
  });
  return out;
}

export function readJsonl<T>(filePath: string, schema: z.ZodType<T>): T[] {
  const text = readFileSync(filePath, 'utf8');
  const out: T[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const parsed: unknown = JSON.parse(line);
    const v = schema.safeParse(parsed);
    if (!v.success) {
      throw new Error(`${filePath}:${i + 1}: ${v.error.message}`);
    }
    out.push(v.data);
  }
  return out;
}

export function writeJsonl(filePath: string, rows: readonly unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(filePath, rows.length ? `${body}\n` : '');
}

export function writeText(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

export function listShardFiles(dir: string, prefix: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .sort()
    .map((name) => path.join(dir, name));
}

export { existsSync, mkdirSync, readFileSync, writeFileSync };
