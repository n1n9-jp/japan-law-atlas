import { argValue } from '../lib/args.js';
import { runExtract } from './io.js';

const args = {
  snapshot: argValue('snapshot'),
  store: argValue('store'),
  law: argValue('law'),
};
try {
  await runExtract(args);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(msg + '\n');
  process.exitCode = 1;
}
