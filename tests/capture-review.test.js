/** Static capture review through the public parser and filesystem/CLI seams. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { analyzeCapture, reviewCapture } from '../scripts/capture-review.mjs';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const script = fileURLToPath(new URL('../scripts/capture-review.mjs', import.meta.url));
const directories = [];
const capture = (pairs = [[A, 'icon.png']], extra = '') =>
  `const o = ${JSON.stringify(pairs.map(([id, file]) => ({ id, file })))};\n${extra}`;

async function fixture(
  source = capture([
    [A, 'new.png'],
    [C, 'fonts/Vazirmatn[wght].woff2'],
  ]),
) {
  const root = await mkdtemp(resolve(tmpdir(), 'shield-capture-test-'));
  directories.push(root);
  const catalog = `const KNOWN_EXTENSIONS = { ${A}: { name: 'Curated name', category: 'Privacy' } };
// Captured const o registry: 2 unique extension IDs and their exact resource paths.
// SHA-256 of source: ${'0'.repeat(64)}
const EXTENSION_PROBES = { ${A}: 'old.png', ${B}: 'removed.png' };
for (const [id, file] of Object.entries(EXTENSION_PROBES)) KNOWN_EXTENSIONS[id] = { ...KNOWN_EXTENSIONS[id], file };
`;
  await writeFile(resolve(root, 'known-extensions.js'), catalog);
  const inputPath = resolve(root, 'vendor.js');
  await writeFile(inputPath, source);
  return { root, inputPath, outDir: resolve(root, 'review'), catalog };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('static capture analysis', () => {
  it('selects the literal const o table among unrelated variables without running source', () => {
    const source = `throw new Error('must never run');
function unrelated() { const o = function () { throw new Error('also never run'); }; }
${capture([
  [B, 'fonts/日本語[wght].woff2'],
  [A, 'icons/a b.png'],
])}`;
    const result = analyzeCapture(source);
    expect(result.pairs).toEqual([
      [A, 'icons/a b.png'],
      [B, 'fonts/日本語[wght].woff2'],
    ]);
    expect(result.location).toMatchObject({ name: 'o', line: 3, column: 7 });
  });

  it('rejects ambiguous tables until the caller selects an exact line', () => {
    const source = `${capture()}\nfunction another() { ${capture([[B, 'other.png']])} }`;
    expect(() => analyzeCapture(source)).toThrow('found 2');
    expect(analyzeCapture(source, { line: 1 }).pairs).toEqual([[A, 'icon.png']]);
    expect(analyzeCapture('const renamed = [{id: "' + A + '", file: "x.png"}];', { table: 'renamed' }).pairs).toEqual([
      [A, 'x.png'],
    ]);
  });

  it.each([
    [`[{id: '${A}', get file() { throw new Error('never run'); }}]`, 'unique literal'],
    [`[{id: '${A}', file: (() => 'x.png')()}]`, 'unique literal'],
    [`[{id: '${A}', ['file']: 'x.png'}]`, 'unique literal'],
    [`[{id: '${A}', file: 'x.png', file: 'y.png'}]`, 'unique literal'],
    [`[{id: '${A}', file: 'x.png', ...other}]`, 'unique literal'],
    [`[{id: '${A}', file: 'x.png'}, ...other]`, 'literal object'],
    [`[{id: '${A}', file: 'x.png'}, ,]`, 'literal object'],
    [`[{id: '${A}', file: 'x.png', extra: 'x'}]`, 'exactly id and file'],
    [`[{id: '${A}', file: 'x.png'}, {id: '${A}', file: 'y.png'}]`, 'duplicate extension ID'],
    ["[{id: 'invalid', file: 'x.png'}]", 'invalid extension ID'],
  ])('rejects malformed or executable table entries: %s', (table, message) => {
    expect(() => analyzeCapture(`const o = ${table};`)).toThrow(message);
  });

  it.each([
    '../file',
    '/absolute',
    'chrome-extension://other/file',
    'x\\file',
    '%2e%2e/file',
    'x?token=private',
    'x#private',
    'x\nfile',
    ' x.png',
  ])('rejects unsafe resource path %j', (file) => {
    expect(() => analyzeCapture(capture([[A, file]]))).toThrow('relative paths');
  });

  it('fails on missing or empty tables, syntax errors, and oversized input', () => {
    expect(() => analyzeCapture('const unrelated = 1;')).toThrow('found 0');
    expect(() => analyzeCapture('const o = [];', { line: 1 })).toThrow('nonempty');
    expect(() => analyzeCapture('const o = @;')).toThrow('Cannot parse JavaScript at 1:');
    expect(() => analyzeCapture(' '.repeat(16 * 1024 * 1024 + 1))).toThrow('16 MiB');
  });

  it('normalizes endpoint candidates and records uncertainty and source locations', () => {
    const source = capture(
      undefined,
      `
fetch('https://person:private@example.test/collect?token=secret#fragment');
navigator.sendBeacon('/apfc/' + 'collect?secret=value', 'payload');
xhr.open('POST', '//example.test/metrics?key=private');
const template = \`https://example.test/template?private=true\`;
const dynamic = \`https://\${host}/unresolved\`;
`,
    );
    const result = analyzeCapture(source);
    expect(result.signals.endpoints.map(({ value }) => value)).toEqual([
      '//example.test/metrics',
      '/apfc/collect',
      'https://example.test/collect',
      'https://example.test/template',
    ]);
    expect(result.signals.endpoints.find(({ value }) => value === 'https://example.test/collect')).toMatchObject({
      kind: 'absolute',
      count: 1,
      locations: [{ line: 3, column: 7 }],
      contexts: expect.arrayContaining(['fetch argument (callee identity unproven)']),
    });
    const output = JSON.stringify(result.signals);
    for (const privateValue of ['person', 'private', 'secret', 'fragment', 'payload', 'unresolved'])
      expect(output).not.toContain(privateValue);
  });

  it('emits cookie and header names while excluding their literal values from all signals', () => {
    const result = analyzeCapture(
      capture(
        undefined,
        `
document.cookie = 'new_cookie=private; path=/';
setCookie('other_cookie', 'https://private.test/cookie-value');
getCookie('df_ts');
xhr.setRequestHeader('X-Li-Apfc-Data', 'https://private.test/header-value');
fetch('/normal', {headers: {'Authorization': 'https://private.test/authorization-value', 'X-Custom': secret}});
`,
      ),
    );
    expect(result.signals.cookies.map(({ value }) => value)).toEqual(['df_ts', 'new_cookie', 'other_cookie']);
    expect(result.signals.headers.map(({ value }) => value)).toEqual(['authorization', 'x-custom', 'x-li-apfc-data']);
    expect(result.signals.endpoints.map(({ value }) => value)).toEqual(['/normal']);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('bounds stored locations but counts repeated occurrences exactly', () => {
    const result = analyzeCapture(capture(undefined, "fetch('/same');\n".repeat(8)));
    expect(result.signals.endpoints).toHaveLength(1);
    expect(result.signals.endpoints[0]).toMatchObject({ count: 8, locations: expect.any(Array) });
    expect(result.signals.endpoints[0].locations).toHaveLength(5);
  });
});

describe('review artifacts', () => {
  it('writes a reviewable, applicable patch while preserving the source catalog and curated labels', async () => {
    const options = await fixture();
    const { report, patch } = await reviewCapture(options);
    expect(report.catalog).toMatchObject({
      count: 2,
      baselineCount: 2,
      added: [{ id: C, file: 'fonts/Vazirmatn[wght].woff2' }],
      removed: [{ id: B, file: 'removed.png' }],
      changed: [{ id: A, before: 'old.png', after: 'new.png' }],
    });
    expect(report.source.sha256).toBe(
      createHash('sha256')
        .update(await readFile(options.inputPath))
        .digest('hex'),
    );
    expect(report.catalog.pairsSha256).toBe(
      createHash('sha256')
        .update(
          JSON.stringify([
            [A, 'new.png'],
            [C, 'fonts/Vazirmatn[wght].woff2'],
          ]),
        )
        .digest('hex'),
    );
    expect(report.changes).toBeNull();
    expect(await readFile(resolve(options.root, 'known-extensions.js'), 'utf8')).toBe(options.catalog);
    expect(await readdir(options.outDir)).toEqual(['catalog.patch', 'report.json', 'review.md']);
    expect(JSON.stringify(report)).not.toContain(options.root);
    expect(patch).toContain('--- a/known-extensions.js');
    const path = resolve(options.outDir, 'catalog.patch');
    expect(spawnSync('git', ['apply', '--check', path], { cwd: options.root }).status).toBe(0);
    expect(spawnSync('git', ['apply', path], { cwd: options.root }).status).toBe(0);
    const updated = await readFile(resolve(options.root, 'known-extensions.js'), 'utf8');
    expect(updated).toContain('Curated name');
    expect(updated).toContain('new.png');
    expect(updated).not.toContain('removed.png');
    expect(updated).toContain(report.source.sha256);
    const repeated = await reviewCapture({ ...options, outDir: resolve(options.root, 'repeat') });
    expect(repeated.patch).toBe('');
    expect(repeated.report.catalog).toMatchObject({ added: [], removed: [], changed: [] });
  });

  it('produces deterministic reports and compares sanitized signals against a prior review', async () => {
    const options = await fixture(capture(undefined, "fetch('/old?private=1'); setCookie('old_cookie', 'secret');"));
    const first = await reviewCapture(options);
    const repeated = await reviewCapture({ ...options, outDir: resolve(options.root, 'repeat') });
    expect(repeated.report).toEqual(first.report);
    expect(repeated.patch).toBe(first.patch);
    await writeFile(options.inputPath, capture(undefined, "fetch('/new?private=2'); getCookie('new_cookie');"));
    const next = await reviewCapture({
      ...options,
      outDir: resolve(options.root, 'next'),
      baselinePath: resolve(options.outDir, 'report.json'),
    });
    expect(next.report.changes).toEqual({
      endpoints: { added: ['/new'], removed: ['/old'] },
      cookies: { added: ['new_cookie'], removed: ['old_cookie'] },
      headers: { added: [], removed: [] },
    });
    expect(await readFile(resolve(options.root, 'next/review.md'), 'utf8')).toContain(
      'Added `/new`'.replace('/new', '"/new"'),
    );
  });

  it('rejects invalid baselines and unsafe catalogs before creating output', async () => {
    const options = await fixture();
    const baselinePath = resolve(options.root, 'baseline.json');
    await writeFile(
      baselinePath,
      JSON.stringify({ schemaVersion: 1, signals: { endpoints: [{ value: 'https://host/path?secret=value' }] } }),
    );
    await expect(reviewCapture({ ...options, baselinePath })).rejects.toThrow('normalized endpoint');
    await expect(readdir(options.outDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(
      resolve(options.root, 'known-extensions.js'),
      `const EXTENSION_PROBES = { ${A}: (() => 'never.png')() };`,
    );
    await expect(reviewCapture(options)).rejects.toThrow('unique literal');
  });

  it('round-trips root-path candidates through a baseline report', async () => {
    const options = await fixture(capture(undefined, "fetch('/?token=private');"));
    const first = await reviewCapture(options);
    expect(first.report.signals.endpoints.map(({ value }) => value)).toEqual(['/']);
    const next = await reviewCapture({
      ...options,
      outDir: resolve(options.root, 'next'),
      baselinePath: resolve(options.outDir, 'report.json'),
    });
    expect(next.report.changes.endpoints).toEqual({ added: [], removed: [] });
  });

  it('rejects malformed and null baseline reports without exposing their source text', async () => {
    const options = await fixture();
    const baselinePath = resolve(options.root, 'baseline.json');
    await writeFile(baselinePath, 'private-baseline-text');
    await expect(reviewCapture({ ...options, baselinePath })).rejects.toThrow('Cannot parse baseline report JSON.');
    await writeFile(baselinePath, 'null');
    await expect(reviewCapture({ ...options, baselinePath })).rejects.toThrow('Unsupported baseline report schema');
    await expect(readdir(options.outDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses existing output directories and symlinks without changing their contents', async () => {
    const options = await fixture();
    await mkdir(options.outDir);
    await writeFile(resolve(options.outDir, 'keep'), 'untouched');
    await expect(reviewCapture(options)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readdir(options.outDir)).toEqual(['keep']);
    const link = resolve(options.root, 'linked-output');
    await symlink(options.outDir, link);
    await expect(reviewCapture({ ...options, outDir: link })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(resolve(options.outDir, 'keep'), 'utf8')).toBe('untouched');
  });

  it('rejects source symlinks and leaves no review after malformed input', async () => {
    const options = await fixture('this is not JavaScript');
    await expect(reviewCapture(options)).rejects.toThrow('Cannot parse');
    await expect(readdir(options.outDir)).rejects.toMatchObject({ code: 'ENOENT' });
    const link = resolve(options.root, 'linked-input.js');
    await symlink(options.inputPath, link);
    await expect(reviewCapture({ ...options, inputPath: link })).rejects.toThrow('regular files');
  });

  it('supports CLI help and rejects missing option values without executing input', async () => {
    expect(spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' })).toMatchObject({
      status: 0,
      stdout: expect.stringContaining('Usage:'),
    });
    const options = await fixture();
    const bad = spawnSync(process.execPath, [script, options.inputPath, '--out'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Unknown or incomplete option');
    expect(spawnSync(process.execPath, [script, options.inputPath, '--line', '0']).status).toBe(1);
  });
});
