/// <reference path="../types/atlas.d.ts" />
import { expect, test, type Page } from '@playwright/test';
import { mapDiffPct } from '../scripts/check-screens.ts';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__atlas?.ready === true, null, { timeout: 5000 });
}

async function readyWithEdges(page: Page): Promise<void> {
  await ready(page);
  await page.waitForFunction(() => window.__atlas?.edgesReady === true, null, { timeout: 60_000 });
}

async function searchBox(page: Page) {
  const input = page.getByRole('combobox', { name: '法令を探す' });
  await expect(input).toBeVisible({ timeout: 10_000 });
  return input;
}

async function firstEdgeIds(page: Page): Promise<{ src: string; tgt: string }> {
  return page.evaluate(async () => {
    const latest = await (await fetch('/data/latest.json')).json() as { dataPath: string };
    const laws = await (await fetch(`${latest.dataPath}laws.json`)).json() as { id: string[] };
    const edges = await (await fetch(`${latest.dataPath}law-edges.json`)).json() as {
      src: number[];
      tgt: number[];
    };
    return { src: laws.id[edges.src[0]!]!, tgt: laws.id[edges.tgt[0]!]! };
  });
}

test('loads until atlas ready and count matches manifest', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const info = await page.evaluate(async () => {
    const latest = await (await fetch('/data/latest.json')).json() as { dataPath: string };
    const manifest = await (await fetch(`${latest.dataPath}manifest.json`)).json() as {
      categories: unknown[];
      counts: { laws: number };
    };
    return { cats: manifest.categories.length, laws: manifest.counts.laws };
  });
  expect(info.cats).toBe(50);
  await expect(page.getByText(`日本の施行中の法令 ${info.laws.toLocaleString('ja-JP')} 件の参照地図`)).toBeVisible();
});

test('search みんぽう then URL restore', async ({ page }) => {
  await page.goto('/');
  await readyWithEdges(page);
  const input = await searchBox(page);
  await input.fill('みんぽう');
  await expect(page.getByRole('option').first()).toContainText('民法');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/law=129AC0000000089/, { timeout: 20_000 });
});

test('URL law= restores 民法', async ({ page }) => {
  await page.goto('/?law=129AC0000000089');
  await readyWithEdges(page);
  await expect(page).toHaveURL(/law=129AC0000000089/);
  await expect.poll(
    () => page.evaluate(() => document.querySelector('aside h2')?.textContent ?? ''),
    { timeout: 20_000 },
  ).toBe('民法');
});

test('search 個人情報保護法', async ({ page }) => {
  await page.goto('/');
  await readyWithEdges(page);
  const input = await searchBox(page);
  await input.fill('個人情報保護法');
  const top: string[] = [];
  for (let i = 0; i < 3; i++) top.push((await page.getByRole('option').nth(i).innerText()) ?? '');
  expect(top.some((t) => /個人情報の保護に関する法律\s+法律/.test(t))).toBe(true);
});

test('search 平成15年法律第57号', async ({ page }) => {
  await page.goto('/');
  await readyWithEdges(page);
  const input = await searchBox(page);
  await input.fill('平成15年法律第57号');
  await expect(page.getByRole('option').first()).toContainText('個人情報の保護に関する法律');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/law=415AC0000000057/, { timeout: 20_000 });
});

test('filter changes visibleEdgeCount and persists in URL', async ({ page }) => {
  await page.goto('/');
  await readyWithEdges(page);
  const before = await page.evaluate(() => window.__atlas.visibleEdgeCount);
  await page.goto('/?parts=suppl');
  await readyWithEdges(page);
  await expect(page).toHaveURL(/parts=suppl/);
  const after = await page.evaluate(() => window.__atlas.visibleEdgeCount);
  expect(after).not.toBe(before);
  await page.reload();
  await readyWithEdges(page);
  await expect(page).toHaveURL(/parts=suppl/);
  expect(await page.evaluate(() => window.__atlas.visibleEdgeCount)).toBe(after);
});

test('Escape order', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?law=129AC0000000089');
  await readyWithEdges(page);
  await expect(page).toHaveURL(/law=129AC0000000089/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/law=/);

  const input = await searchBox(page);
  await input.fill('みんぽう');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option')).toHaveCount(0);

  const ids = await firstEdgeIds(page);
  await page.goto('about:blank');
  await page.goto(`/?edge=${ids.src}~${ids.tgt}`);
  await readyWithEdges(page);
  await expect(page).toHaveURL(/edge=/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/edge=/);
});

test('reduced motion has zero camera transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await readyWithEdges(page);
  const input = await searchBox(page);
  await input.fill('みんぽう');
  await page.keyboard.press('Enter');
  const ms = await page.evaluate(() => window.__atlas.lastTransitionMs);
  expect(ms).toBe(0);
});

test('keyboard pan does not animate', async ({ page }) => {
  await page.goto('/');
  await readyWithEdges(page);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__atlas.lastTransitionMs)).toBe(0);
});

test('mobile sheet', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await readyWithEdges(page);
  const input = await searchBox(page);
  await input.fill('みんぽう');
  await page.keyboard.press('Enter');
  const panel = page.locator('aside[data-open="true"]');
  await expect(panel).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('[data-legend-toggle]')).toHaveCount(1);
  const handle = page.locator('[data-sheet-handle]');
  await expect(handle).toBeAttached({ timeout: 15_000 });
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 4);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 420, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('aside[data-open="true"]')).toHaveCount(0, { timeout: 15_000 });
});

async function edgesReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__atlas?.edgesReady === true, null, { timeout: 60_000 });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test('edge layers paint pixels when color mode changes', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => window.localStorage.setItem('hourei-atlas-seen', '1'));
  await page.goto('/');
  await edgesReady(page);
  const category = await page.screenshot({ type: 'png', scale: 'css' });
  await page.goto('/?color=kind');
  await edgesReady(page);
  const kind = await page.screenshot({ type: 'png', scale: 'css' });
  const pct = mapDiffPct(Buffer.from(category), Buffer.from(kind), false);
  expect(pct).toBeGreaterThanOrEqual(3);
});
