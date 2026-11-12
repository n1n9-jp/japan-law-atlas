import { argValue, hasFlag } from '../lib/args.ts';
import { runGraph } from './run-graph.ts';

try {
  await runGraph({
    snapshot: argValue('snapshot'),
    store: argValue('store'),
    continentsOnly: hasFlag('continents-only'),
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(msg + '\n');
  process.exitCode = 1;
}
