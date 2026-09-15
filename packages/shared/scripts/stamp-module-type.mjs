import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Marks each build output with the module system it actually uses.
 *
 * The package itself is `"type": "commonjs"`, which is what the API needs, and
 * that would otherwise make Node read `dist/esm/*.js` as CommonJS too. The
 * bundler goes by the `exports` map and never notices, but a Node ESM
 * consumer would, and the failure would be a syntax error a long way from its
 * cause.
 */
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const [folder, type] of [
  ['esm', 'module'],
  ['cjs', 'commonjs'],
]) {
  writeFileSync(join(dist, folder, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}
