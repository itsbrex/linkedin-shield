import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const popup = new JSDOM(readFileSync(join(root, manifest.action.default_popup), 'utf8'));
// Derive required assets independently from the extension's public entry points.
const required = [
  ...new Set([
    'manifest.json',
    'LICENSE',
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...manifest.declarative_net_request.rule_resources.map((entry) => entry.path),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    ...[...popup.window.document.querySelectorAll('script[src], link[rel="stylesheet"][href], img[src]')].map(
      (element) => element.getAttribute('src') || element.getAttribute('href'),
    ),
  ]),
].sort();
popup.window.close();
let fixture;

function write(relativePath, content) {
  const path = join(fixture, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function build() {
  // Exercise the actual CLI from a different working directory.
  return spawnSync(process.execPath, [join(fixture, 'scripts/build.mjs')], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'linkedin-shield-build-test-'));
  for (const file of required) {
    mkdirSync(dirname(join(fixture, file)), { recursive: true });
    copyFileSync(join(root, file), join(fixture, file));
  }
  mkdirSync(join(fixture, 'scripts'));
  copyFileSync(join(root, 'scripts/build.mjs'), join(fixture, 'scripts/build.mjs'));
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe('Unpacked extension build', () => {
  it('includes every runtime reference byte-for-byte and excludes unrelated files', () => {
    for (const file of [
      '.env',
      'package.json',
      'docs/private.md',
      'node_modules/example/index.js',
      'icons/draft.png',
    ]) {
      write(file, 'not part of the extension');
    }
    const result = build();
    expect(result.status, result.stderr).toBe(0);
    const output = readdirSync(join(fixture, 'dist'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(join(fixture, 'dist'), join(entry.parentPath, entry.name)).split(sep).join('/'))
      .sort();
    expect(output).toEqual(required);
    for (const file of required) {
      expect(readFileSync(join(fixture, 'dist', file))).toEqual(readFileSync(join(fixture, file)));
    }
  });

  it('refreshes changed files and removes stale output on rebuild', () => {
    expect(build().status).toBe(0);
    write('dist/stale.js', 'obsolete');
    write('popup.js', '// updated source');
    expect(build().status).toBe(0);
    expect(existsSync(join(fixture, 'dist/stale.js'))).toBe(false);
    expect(readFileSync(join(fixture, 'dist/popup.js'), 'utf8')).toBe('// updated source');
  });

  it('preserves the previous build if a required input is missing', () => {
    expect(build().status).toBe(0);
    const previous = readFileSync(join(fixture, 'dist/popup.js'));
    rmSync(join(fixture, 'popup.js'));
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('popup.js');
    expect(readFileSync(join(fixture, 'dist/popup.js'))).toEqual(previous);
    expect(readdirSync(fixture).some((file) => file.startsWith('.shield-build-'))).toBe(false);
  });

  it('refuses a linked output directory without changing its target', () => {
    write('unrelated/keep.txt', 'preserve this');
    symlinkSync(join(fixture, 'unrelated'), join(fixture, 'dist'), 'junction');
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('dist');
    expect(readFileSync(join(fixture, 'unrelated/keep.txt'), 'utf8')).toBe('preserve this');
    expect(readdirSync(join(fixture, 'unrelated'))).toEqual(['keep.txt']);
  });
});
