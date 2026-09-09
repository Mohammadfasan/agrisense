#!/usr/bin/env node
/**
 * Runs a tool from the ml-service virtualenv, resolving the platform's bin
 * directory (`Scripts` on Windows, `bin` elsewhere) so the same lint-staged
 * entry works for everyone.
 *
 * Usage: node scripts/py-tool.mjs <tool> [args...]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venv = path.join(repoRoot, 'ml-service', '.venv');
const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';

const [tool, ...args] = process.argv.slice(2);

if (!tool) {
  console.error('usage: node scripts/py-tool.mjs <tool> [args...]');
  process.exit(2);
}

const exe = path.join(venv, binDir, process.platform === 'win32' ? `${tool}.exe` : tool);

if (!existsSync(exe)) {
  console.error(
    `${tool} not found at ${exe}\n` +
      'Create the environment first:\n' +
      '  cd ml-service && python -m venv .venv\n' +
      `  .venv/${binDir}/python -m pip install -r requirements-dev.txt`,
  );
  process.exit(1);
}

const result = spawnSync(exe, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
