#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { buildExtension, ROOT, RUNTIME_FILES } from './build.mjs';

export function packageExtension({ root = ROOT } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  if (!/^\d+(?:\.\d+){1,3}$/.test(manifest.version)) throw new Error('Invalid manifest version for release filename.');
  const releaseDir = join(root, 'releases');
  const existing = lstatSync(releaseDir, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new Error('Invalid releases directory.');
  const output = buildExtension({ root });
  const entries = {};
  for (const file of [...RUNTIME_FILES].sort()) {
    entries[file] = [readFileSync(join(output, file)), { mtime: new Date(2020, 0, 1) }];
  }
  const archive = zipSync(entries, { level: 9 });
  const filename = `linkedin-shield-${manifest.version}.zip`;
  const digest = createHash('sha256').update(archive).digest('hex');
  mkdirSync(releaseDir, { recursive: true });
  const temporary = join(releaseDir, `.${filename}.${process.pid}.tmp`);
  const temporaryChecksum = `${temporary}.sha256`;
  try {
    writeFileSync(temporary, archive);
    writeFileSync(temporaryChecksum, `${digest}  ${filename}\n`);
    renameSync(temporary, join(releaseDir, filename));
    renameSync(temporaryChecksum, join(releaseDir, `${filename}.sha256`));
  } finally {
    rmSync(temporary, { force: true });
    rmSync(temporaryChecksum, { force: true });
  }
  return join(releaseDir, filename);
}

if (import.meta.main) {
  try {
    console.log(`Packaged ${packageExtension()}`);
  } catch (error) {
    console.error(`Packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
