import { argValue } from '../lib/args.ts';
import { runExport } from '../graph/run-export.ts';

try {
  await runExport({
    snapshot: argValue('snapshot'),
    store: argValue('store'),
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.exitCode = 1;
  process.stderr.write(msg + '\n');
}
