#!/usr/bin/env node
/** Copy only the extension's runtime assets into a loadable dist directory. */
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
// Keep this allowlist in sync with manifest and popup references. Never copy the
// repository or icons directory recursively: either may contain private/WIP files.
const files = [
  'manifest.json',
  'background.js',
  'bridge.js',
  'content.js',
  'known-extensions.js',
  'popup.html',
  'popup.js',
  'rules.json',
  'icons/shield-16.png',
  'icons/shield-32.png',
  'icons/shield-48.png',
  'icons/shield-128.png',
  'LICENSE',
];

let staging;
try {
  const existing = lstatSync(output, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    throw new Error('Refusing to replace dist: expected a regular directory, not a file or symlink.');
  }
  // Validate every input before touching the previous build.
  for (const file of files) {
    if (!lstatSync(join(root, file)).isFile()) throw new Error(`Expected a regular source file: ${file}`);
  }
  staging = mkdtempSync(join(root, '.shield-build-'));
  for (const file of files) {
    const destination = join(staging, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
  }
  rmSync(output, { recursive: true, force: true });
  renameSync(staging, output);
  console.log(`Built ${files.length} extension files in ${output}`);
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (staging) rmSync(staging, { recursive: true, force: true });
}
