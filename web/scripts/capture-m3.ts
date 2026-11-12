import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { fitZoomForBounds } from '../lib/camera.ts';
import { STORE_ROOT } from '../lib/paths.ts';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MINPO = '129AC0000000089';
const DEST = path.join(STORE_ROOT, 'media/m3');
const VIEW = { width: 1440, height: 900 } as const;
const EXPECT_W = VIEW.width * 2;
const EXPECT_H = VIEW.height * 2;

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a png');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function waitEdgesReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__atlas?.edgesReady === true, null, { timeout: 60_000 });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }));
}

async function shot(page: Page): Promise<Buffer> {
  const buf = await page.screenshot({ type: 'png', scale: 'device', animations: 'disabled' });
  const { width, height } = pngSize(buf);
  if (width === EXPECT_W && height === EXPECT_H) return buf;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width,
    height: VIEW.height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  const { data } = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const cdp = Buffer.from(data, 'base64');
  const sz = pngSize(cdp);
  if (sz.width !== EXPECT_W || sz.height !== EXPECT_H) {
    throw new Error(`screenshot ${sz.width}×${sz.height}, expected ${EXPECT_W}×${EXPECT_H}`);
  }
  return cdp;
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

async function save(name: string, buf: Buffer): Promise<void> {
  const dest = path.join(DEST, name);
  await writeRetry(dest, buf);
  const { width, height } = pngSize(buf);
  console.log(dest, `${width}x${height}`, buf.length);
}

async function minpoAndFit(): Promise<{ x: number; y: number; fit: number }> {
  const latest = await fetch(`${BASE}/data/latest.json`).then((r) => r.json()) as { dataPath: string };
  const [manifest, laws] = await Promise.all([
    fetch(`${BASE}${latest.dataPath}manifest.json`).then((r) => r.json()) as Promise<{ bounds: [number, number, number, number] }>,
    fetch(`${BASE}${latest.dataPath}laws.json`).then((r) => r.json()) as Promise<{ id: string[]; x: number[]; y: number[] }>,
  ]);
  const i = laws.id.indexOf(MINPO);
  if (i < 0) throw new Error('民法が見つからない');
  return {
    x: laws.x[i]!,
    y: laws.y[i]!,
    fit: fitZoomForBounds(manifest.bounds, VIEW.width, VIEW.height),
  };
}

async function openShot(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string, waitPanel = false): Promise<Buffer> {
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: VIEW,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('hourei-atlas-seen', '1');
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitEdgesReady(page);
  if (waitPanel) {
    await page.locator('aside h2').waitFor({ state: 'attached', timeout: 12_000 });
  }
  const buf = await shot(page);
  await context.close();
  return buf;
}

async function main(): Promise<void> {
  await mkdir(DEST, { recursive: true });
  const cam = await minpoAndFit();
  const v = (zoom: number) => `${Math.round(cam.x)},${Math.round(cam.y)},${zoom.toFixed(2)}`;
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=2'] });

  await save('ui-overview.png', await openShot(browser, BASE));
  await save('ui-overview-kind.png', await openShot(browser, `${BASE}/?color=kind`));
  await save('ui-zoomed.png', await openShot(browser, `${BASE}/?v=${v(cam.fit + 2.5)}`));
  await save('ui-zoomed-deep.png', await openShot(browser, `${BASE}/?v=${v(cam.fit + 4)}`));
  await save('ui-selected-minpo.png', await openShot(browser, `${BASE}/?law=${MINPO}`, true));
  await save(
    'ui-selected-minpo-zoomed.png',
    await openShot(browser, `${BASE}/?law=${MINPO}&v=${v(cam.fit + 2.5)}`, true),
  );

  await browser.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
