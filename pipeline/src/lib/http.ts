const MIN_INTERVAL_MS = 500;
const RETRY_WAITS_MS = [1000, 2000, 4000, 8000, 16000];
const USER_AGENT = 'hourei-atlas/0.1 (corpus; research)';

let lastAt = 0;
let chain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTurn(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

export async function egovFetch(url: string): Promise<Response> {
  const run = chain.then(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      await waitTurn();
      try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        if (res.status >= 500 || res.status === 429) {
          lastErr = new Error(`HTTP ${res.status} for ${url}`);
        } else {
          return res;
        }
      } catch (err) {
        lastErr = err;
      }
      const wait = RETRY_WAITS_MS[attempt];
      if (wait === undefined) break;
      await sleep(wait);
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function egovFetchJson(url: string): Promise<unknown> {
  const res = await egovFetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

export async function egovFetchBuffer(url: string): Promise<{ status: number; body: Buffer }> {
  const res = await egovFetch(url);
  const ab = await res.arrayBuffer();
  return { status: res.status, body: Buffer.from(ab) };
}
