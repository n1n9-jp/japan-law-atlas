import { spawn } from 'node:child_process';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  return undefined;
}

async function curl(url: string, extra: string[] = []): Promise<{ code: string; headers: string; body: string }> {
  const args = ['-sS', '-D', '-', '-o', '/tmp/verify-prod-body.txt', '-w', '\n%{http_code}', ...extra, url];
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn('curl', args);
    let buf = '';
    p.stdout.on('data', (c: Buffer) => { buf += c.toString(); });
    p.stderr.on('data', (c: Buffer) => { buf += c.toString(); });
    p.on('close', (code) => (code === 0 || buf ? resolve(buf) : reject(new Error(`curl ${code}`))));
  });
  const lines = out.split('\n');
  const code = lines[lines.length - 1] ?? '';
  return { code, headers: out, body: '' };
}

async function main(): Promise<void> {
  const url = (arg('--url') ?? '').replace(/\/$/, '');
  if (!url) {
    console.error('usage: npm run verify:prod -- --url https://alias.vercel.app');
    process.exit(2);
  }
  const home = await curl(url + '/');
  console.log('GET /', home.code);
  if (home.code !== '200') process.exit(1);
  if (/vercel.com\/sso-api/.test(home.headers)) {
    console.error('redirects to vercel SSO');
    process.exit(1);
  }
  const latest = await curl(url + '/data/latest.json');
  console.log('GET /data/latest.json', latest.code);
  if (latest.code !== '200') process.exit(1);
  const latestJson = JSON.parse(await (await fetch(url + '/data/latest.json')).text()) as { dataPath: string };
  const manUrl = url + latestJson.dataPath + (latestJson.dataPath.endsWith('/') ? '' : '/') + 'manifest.json';
  const man = await curl(manUrl);
  console.log('GET manifest', man.code);
  if (man.code !== '200') process.exit(1);
  if (!/content-type:.*json/i.test(man.headers)) {
    console.error('manifest content-type is not json');
    process.exit(1);
  }
  const br = await curl(manUrl, ['-H', 'Accept-Encoding: br']);
  if (!/content-encoding:\s*(br|gzip)/i.test(br.headers)) {
    console.error('manifest not compressed');
    process.exit(1);
  }
  if (!/cache-control:.*immutable/i.test(man.headers) && !/cache-control:.*immutable/i.test(br.headers)) {
    console.error('manifest cache-control missing immutable');
    process.exit(1);
  }
  console.log('curl checks ok');
  const env = { ...process.env, BASE_URL: url };
  const code = await new Promise<number>((resolve) => {
    const p = spawn('npx', ['playwright', 'test'], { stdio: 'inherit', env });
    p.on('close', (c) => resolve(c ?? 1));
  });
  process.exit(code);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
