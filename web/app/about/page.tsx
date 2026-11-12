import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';

async function loadAttribution(): Promise<{ lines: string[]; asof: string; snapshotId: string }> {
  const latestPath = path.join(process.cwd(), 'public/data/latest.json');
  const latest = JSON.parse(await readFile(latestPath, 'utf8')) as { dataPath: string; snapshotId: string };
  const rel = latest.dataPath.replace(/^\//, '').replace(/\/?$/, '');
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), 'public', rel, 'manifest.json'), 'utf8'),
  ) as { attribution: string[]; egovAsof: string; snapshotId: string };
  return { lines: manifest.attribution, asof: manifest.egovAsof, snapshotId: manifest.snapshotId };
}

export default async function AboutPage() {
  const attr = await loadAttribution();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px 80px', fontFamily: 'var(--font-ui)' }}>
      <p><Link href="/">← 地図に戻る</Link></p>
      <h1 style={{ fontFamily: 'var(--font-law)', fontWeight: 600, fontSize: 28 }}>法令アトラスについて</h1>
      <p>
        日本の施行中の法令を、参照関係でつながった1枚の地図として見られるようにした試作です。
        分野の大陸、参照の種類、その場で読める条文本文を一つの画面にまとめています。
      </p>
      <h2>データ</h2>
      <p>
        法令の本文と識別子は e-Gov 法令検索の法令データ（公共データ利用規約）を使っています。
        スナップショット {attr.snapshotId}、データ時点 {attr.asof}。
      </p>
      <h2>出典</h2>
      <ul>
        {attr.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </main>
  );
}
