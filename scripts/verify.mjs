#!/usr/bin/env node
/** Verify tracked files, plus explicitly named new files, without changing them. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const extra = process.argv.slice(2).map((file) => {
  const path = relative(root, resolve(process.cwd(), file));
  if (!path || isAbsolute(path) || path === '..' || path.startsWith('../') || !existsSync(resolve(root, path))) {
    throw new Error(`Expected an existing file inside the repository: ${file}`);
  }
  return path;
});
const files = [...new Set([...tracked, ...extra])].filter((file) => existsSync(resolve(root, file)));
const javascript = files.filter((file) => /\.[cm]?js$/.test(file));

function run(label, args) {
  console.log(`\n${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Checking ${files.length} tracked/explicit files. Untracked files require an explicit path argument.`);
run('ESLint', ['node_modules/eslint/bin/eslint.js', '--', ...javascript]);
run('Prettier', ['node_modules/prettier/bin/prettier.cjs', '--check', '--ignore-unknown', '--', ...files]);
for (const file of ['background.js', 'bridge.js', 'content.js', 'known-extensions.js', 'popup.js']) {
  run(`Syntax: ${file}`, ['--check', file]);
}
run('Vitest', ['node_modules/vitest/vitest.mjs', 'run']);
console.log('\nVerification passed.');
