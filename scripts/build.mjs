#!/usr/bin/env node
/** Copy only the extension's runtime assets into a loadable dist directory. */
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep this allowlist in sync with manifest and popup references. Never copy the
// repository or icons directory recursively: either may contain private/WIP files.
export const RUNTIME_FILES = [
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

export function buildExtension({ root = ROOT, outputName = 'dist', prepare = () => {} } = {}) {
  if (!['dist', '.dev-build'].includes(outputName)) throw new Error('Unknown build output.');
  const output = join(root, outputName);
  let staging;
  try {
    const existing = lstatSync(output, { throwIfNoEntry: false });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new Error(`Refusing to replace ${outputName}: expected a regular directory, not a file or symlink.`);
    }
    // Validate every input before touching the previous build.
    for (const file of RUNTIME_FILES) {
      if (!lstatSync(join(root, file)).isFile()) throw new Error(`Expected a regular source file: ${file}`);
    }
    staging = mkdtempSync(join(root, '.shield-build-'));
    for (const file of RUNTIME_FILES) {
      const destination = join(staging, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, file), destination);
    }
    prepare(staging);
    rmSync(output, { recursive: true, force: true });
    renameSync(staging, output);
    return output;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    console.log(`Built ${RUNTIME_FILES.length} extension files in ${buildExtension()}`);
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
