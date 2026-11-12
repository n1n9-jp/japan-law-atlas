import { chromium } from '@playwright/test';

async function main(): Promise<void> {
const marks: number[] = [];
const walls: number[] = [];
for (let i = 0; i < 3; i++) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('hourei-atlas-seen', '1'));
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__atlas?.ready === true, null, { timeout: 15_000 });
  const wall = Date.now() - t0;
  const mark = await page.evaluate(() => {
    const e = performance.getEntriesByName('atlas:first-frame')[0];
    return e ? e.startTime : -1;
  });
  const info = await page.evaluate(() => ({
    ready: window.__atlas.ready,
    edges: window.__atlas.visibleEdgeCount,
    mock: document.body.innerText.includes('仮データ'),
    count: document.body.innerText.match(/法令 ([\d,]+) 件/)?.[1] ?? null,
  }));
  console.log(JSON.stringify({ i, mark: Math.round(mark), wall, info }));
  marks.push(mark);
  walls.push(wall);
  await browser.close();
}
marks.sort((a, b) => a - b);
console.log('median_mark', Math.round(marks[1]!));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
