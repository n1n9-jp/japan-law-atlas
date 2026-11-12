import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasFlag, argValue } from '../lib/args.ts';
import { readLatest, resolveStore } from '../lib/paths.ts';
import { fetchExternal, copyExternalIntoSnapshot, loadExternalCounts } from './fetch-external.ts';
import { chooseSecondPass, sampleIndex, toGoldSentences } from './gold-sample.ts';
import { readJsonl, writeJsonl, writeText } from './io.ts';
import { buildSentenceIndex, hydrateGoldBodies, loadGold } from './load.ts';
import { evalPaths } from './paths.ts';
import { buildReport } from './report.ts';
import { writeJlawSecondPass } from './jlaw-sample.ts';
import { goldSentenceSchema } from './schemas.ts';

interface Args {
  store: string;
  snapshot?: string;
  fetch: boolean;
  sampleGold: boolean;
  secondPass: boolean;
  jlawSecondPass: boolean;
  help: boolean;
}

function parseArgs(): Args {
  return {
    store: resolveStore(argValue('store')),
    snapshot: argValue('snapshot'),
    fetch: hasFlag('fetch'),
    sampleGold: hasFlag('sample-gold'),
    secondPass: hasFlag('prepare-second-pass'),
    jlawSecondPass: hasFlag('prepare-jlaw-second-pass'),
    help: hasFlag('help') || hasFlag('h'),
  };
}

function guidelineSrc(): string {
  return fileURLToPath(new URL('./guideline.md', import.meta.url));
}

function copyGuideline(dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) return;
  copyFileSync(guidelineSrc(), dest);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(
      'Usage: npm run eval -- [--snapshot ID] [--store PATH] [--fetch] [--sample-gold] [--prepare-second-pass] [--prepare-jlaw-second-pass]\n',
    );
    return;
  }

  const snapshot = args.snapshot ?? readLatest(args.store);
  const cacheDir = '/tmp/hourei-cache/eval-external';

  if (args.fetch) {
    const snap = snapshot ?? '_prefetch';
    const paths = evalPaths(args.store, snap);
    const counts = await fetchExternal(paths, cacheDir);
    if (!snapshot) {
      process.stdout.write(
        `fetched to ${paths.prefetchExternal} (no corpus LATEST yet; snapshot copy skipped)\n`,
      );
    }
    process.stdout.write(JSON.stringify(counts, null, 2) + '\n');
    if (!args.sampleGold && !args.secondPass && !args.jlawSecondPass && !snapshot) return;
  }

  if (!snapshot) {
    const prefetchPaths = evalPaths(args.store, '_prefetch');
    const counts = loadExternalCounts(prefetchPaths);
    process.stdout.write(
      'snapshotId が未確定（data/corpus/LATEST なし）。外部データの検算だけ出します。\n',
    );
    process.stdout.write(JSON.stringify(counts, null, 2) + '\n');
    process.exitCode = 0;
    return;
  }

  const paths = evalPaths(args.store, snapshot);
  mkdirSync(paths.evalRoot, { recursive: true });
  mkdirSync(paths.goldDir, { recursive: true });
  copyExternalIntoSnapshot(paths);
  copyGuideline(paths.guideline);
  const prefetchGuideline = path.join(paths.prefetchGold, 'guideline.md');
  copyGuideline(prefetchGuideline);

  if (args.jlawSecondPass) {
    const src = existsSync(paths.jlawPrecision)
      ? paths.jlawPrecision
      : path.join(paths.prefetchExternal, 'jlaw-precision-sample.csv');
    if (!existsSync(src)) {
      throw new Error(`missing ${src}; run --fetch first`);
    }
    const wrote = writeJlawSecondPass(readFileSync(src, 'utf8'), paths.jlawPrecisionSecondPass);
    process.stdout.write(
      `jlaw-second-pass ${wrote.selected} -> ${paths.jlawPrecisionSecondPass}\n`,
    );
  }

  if (args.sampleGold) {
    const index = await buildSentenceIndex(paths);
    const picked = sampleIndex(index);
    const bodies = await hydrateGoldBodies(paths, picked.selected);
    const sentences = toGoldSentences(picked.selected, bodies);
    const result = { ...picked, sentences };
    writeJsonl(paths.sentences, sentences);
    writeText(
      path.join(paths.goldDir, 'sample-stats.json'),
      JSON.stringify(
        {
          typeCounts: result.typeCounts,
          hardCounts: result.hardCounts,
          supplCount: result.supplCount,
          unmet: result.unmet,
        },
        null,
        2,
      ) + '\n',
    );
    if (result.unmet.length > 0) {
      process.stderr.write(`gold sample quotas unmet: ${result.unmet.join(', ')}\n`);
      process.exitCode = 2;
    }
    process.stdout.write(`sampled ${result.sentences.length} sentences -> ${paths.sentences}\n`);
  }

  if (args.secondPass) {
    if (!existsSync(paths.sentences)) {
      throw new Error(`missing ${paths.sentences}; run --sample-gold first`);
    }
    const sentences = readJsonl(paths.sentences, goldSentenceSchema);
    const gids = chooseSecondPass(sentences.map((s) => s.gid));
    const gidSet = new Set(gids);
    const rows = sentences.filter((s) => gidSet.has(s.gid));
    writeJsonl(paths.secondPassInput, rows);
    process.stdout.write(`second-pass ${rows.length} -> ${paths.secondPassInput}\n`);
  }

  if (args.sampleGold || args.secondPass || args.jlawSecondPass) {
    return;
  }

  if (!existsSync(path.join(paths.refsDir, 'manifest.json'))) {
    process.stdout.write(`抽出が未完成（${path.join(paths.refsDir, 'manifest.json')} なし）\n`);
    process.exitCode = 2;
    return;
  }

  const gold = await loadGold(paths);
  const report = await buildReport(paths, gold);
  process.stdout.write(`${paths.reportJson}\nstatus=${report.status} missing=${report.missing.join(',')}\n`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
