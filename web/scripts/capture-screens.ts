import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { STORE_ROOT } from '../lib/paths.ts';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MINPO = '129AC0000000089';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__atlas?.ready === true, null, { timeout: 15_000 });
  await page.waitForTimeout(1200);
}

async function shot(page: Page): Promise<Buffer> {
  const session = await page.context().newCDPSession(page);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  return Buffer.from(data, 'base64');
}

async function writeRetry(file: string, buf: Buffer): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      await writeFile(file, buf);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`write failed: ${file}`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('hourei-atlas-seen', '1');
  });
  const page = await context.newPage();

  const tmp: Record<string, Buffer> = {};

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  tmp.overview = await shot(page);

  await page.goto(`${BASE}/?law=${MINPO}`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.locator('aside[data-open="true"] h2').waitFor({ state: 'attached', timeout: 8000 });
  await page.waitForTimeout(800);
  tmp.selected = await shot(page);

  const mobileCtx = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await mobileCtx.addInitScript(() => {
    window.localStorage.setItem('hourei-atlas-seen', '1');
  });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto(`${BASE}/?law=${MINPO}`, { waitUntil: 'domcontentloaded' });
  await waitReady(mobilePage);
  await mobilePage.locator('aside[data-open="true"]').waitFor({ state: 'attached', timeout: 8000 });
  await mobilePage.waitForTimeout(800);
  tmp.mobile = await shot(mobilePage);
  await mobileCtx.close();

  await browser.close();
  const overview = tmp.overview!;
  const selected = tmp.selected!;
  const mobile = tmp.mobile!;

  const dirs = [path.join(STORE_ROOT, 'media/m2'), path.join(STORE_ROOT, 'media/atlas')];
  for (const dir of dirs) await mkdir(dir, { recursive: true });
  const files: [string, Buffer][] = [
    ['ui-overview.png', overview],
    ['ui-selected-minpo.png', selected],
    ['ui-mobile.png', mobile],
  ];
  for (const dir of dirs) {
    for (const [name, buf] of files) {
      const dest = path.join(dir, name);
      await writeRetry(dest, buf);
      console.log(dest, buf.length);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
