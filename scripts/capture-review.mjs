#!/usr/bin/env node
/** Parse untrusted captures as syntax only; emit review artifacts, never execute them. */
import { parse } from 'acorn';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 16 * 1024 * 1024;
const COOKIE_NAMES = new Set(['df_ts', 'li_apfcdc', '_px3', '_pxhd', '_pxvid', 'pxcts', 'bcookie', 'JSESSIONID']);
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedPairs = (pairs) => [...pairs].sort(([a], [b]) => compare(a, b));
const position = (node) => ({ line: node.loc.start.line, column: node.loc.start.column + 1, offset: node.start });
const key = (node) => (node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? node.value : null);

function syntax(source) {
  if (Buffer.byteLength(source) > MAX_BYTES) throw new Error('Capture exceeds the 16 MiB review limit.');
  let location;
  for (const sourceType of ['script', 'module']) {
    try {
      return parse(source, { ecmaVersion: 'latest', sourceType, locations: true });
    } catch (error) {
      // Parser messages can contain source text; retain locations only.
      location = error.loc;
    }
  }
  throw new Error(`Cannot parse JavaScript at ${location?.line ?? '?'}:${(location?.column ?? -1) + 1}.`);
}

function* walk(root) {
  const stack = [{ node: root, parent: null }];
  while (stack.length) {
    const entry = stack.pop();
    yield entry;
    const children = Object.values(entry.node).flatMap((value) => (Array.isArray(value) ? value : [value]));
    for (let index = children.length - 1; index >= 0; index--) {
      if (children[index]?.type) stack.push({ node: children[index], parent: entry.node });
    }
  }
}

function literal(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function staticString(node, depth = 0) {
  if (!node || depth > 64) return null;
  if (literal(node) !== null) return node.value;
  if (node.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left, depth + 1);
    const right = staticString(node.right, depth + 1);
    if (left !== null && right !== null && left.length + right.length <= 2048) return left + right;
  }
  return null;
}

function properties(node) {
  if (node?.type !== 'ObjectExpression') throw new Error('Expected a literal object in the probe table.');
  const entries = new Map();
  for (const property of node.properties) {
    const name = key(property.key);
    if (
      property.type !== 'Property' ||
      property.kind !== 'init' ||
      property.computed ||
      property.method ||
      typeof name !== 'string' ||
      entries.has(name) ||
      literal(property.value) === null
    ) {
      throw new Error(`Expected unique literal string properties at line ${property.loc.start.line}.`);
    }
    entries.set(name, property.value.value);
  }
  return entries;
}

function validatePair(id, file) {
  if (!/^[a-p]{32}$/.test(id)) throw new Error('Probe table contains an invalid extension ID.');
  let decoded;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    throw new Error('Probe table contains an invalid encoded resource path.');
  }
  if (
    !file ||
    file !== file.trim() ||
    /^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(decoded) ||
    /[\\?#\p{Cc}]/u.test(decoded) ||
    decoded.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error('Probe resources must be relative paths without traversal, queries, fragments, or controls.');
  }
}

function capturedTable(ast, { table = 'o', line } = {}) {
  const candidates = [...walk(ast)].filter(({ node, parent }) => {
    if (node.type !== 'VariableDeclarator' || node.id.name !== table || parent.kind !== 'const') return false;
    if (line !== undefined) return node.loc.start.line === line;
    return (
      node.init?.type === 'ArrayExpression' &&
      node.init.elements.some((item) =>
        item?.properties?.some((property) => ['id', 'file'].includes(key(property.key))),
      )
    );
  });
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one literal probe table; found ${candidates.length}. Use --table and --line to disambiguate.`,
    );
  }
  const node = candidates[0].node;
  if (node.init?.type !== 'ArrayExpression' || !node.init.elements.length) {
    throw new Error('Expected a nonempty literal array; refusing an empty catalog replacement.');
  }
  const pairs = new Map();
  for (const item of node.init.elements) {
    const entry = properties(item);
    if (entry.size !== 2 || !entry.has('id') || !entry.has('file')) {
      throw new Error('Every probe must have exactly id and file string properties.');
    }
    const id = entry.get('id');
    const file = entry.get('file');
    validatePair(id, file);
    if (pairs.has(id)) throw new Error('Probe table contains a duplicate extension ID.');
    pairs.set(id, file);
  }
  return { pairs: sortedPairs(pairs), location: { name: table, ...position(node), end: node.end } };
}

function endpoint(value) {
  if (!value || value.length > 2048 || /[\\\s\p{Cc}]/u.test(value)) return null;
  let kind;
  if (/^https?:\/\//i.test(value)) kind = 'absolute';
  else if (/^\/\/[^/]/.test(value)) kind = 'protocol-relative';
  else if (/^\/(?:[^/]|$)/.test(value)) kind = 'relative';
  else return null;
  try {
    const url = new URL(value, 'https://unresolved.invalid');
    const normalized =
      kind === 'relative' ? url.pathname : `${kind === 'absolute' ? url.protocol : ''}//${url.host}${url.pathname}`;
    return { value: normalized, kind };
  } catch {
    return null;
  }
}

function signalsFrom(ast) {
  const buckets = { endpoints: new Map(), cookies: new Map(), headers: new Map() };
  const seen = new Map();
  const ignored = new Set();
  const ignore = (root) => {
    if (root) for (const { node } of walk(root)) ignored.add(node);
  };
  function add(type, value, node, context, details = {}) {
    if (!value) return;
    const bucket = buckets[type];
    const entry = bucket.get(value) ?? { value, ...details, contexts: [], count: 0, locations: [] };
    if (!entry.contexts.includes(context)) entry.contexts.push(context);
    const identity = `${type}:${value}`;
    const locations = seen.get(identity) ?? new Set();
    if (!locations.has(node.start)) {
      entry.count++;
      if (entry.locations.length < 5) entry.locations.push(position(node));
      locations.add(node.start);
      seen.set(identity, locations);
    }
    bucket.set(value, entry);
  }
  for (const { node, parent } of walk(ast)) {
    if (ignored.has(node)) continue;
    const value = staticString(node);
    // A fully static concatenation is one candidate, not several misleading pieces.
    if (value !== null && !(parent?.type === 'BinaryExpression' && staticString(parent) !== null)) {
      const candidate = endpoint(value);
      if (candidate)
        add('endpoints', candidate.value, node, 'static string; request use unproven', { kind: candidate.kind });
      if (COOKIE_NAMES.has(value)) add('cookies', value, node, 'known cookie-name literal');
      if (value.toLowerCase() === 'x-li-apfc-data')
        add('headers', value.toLowerCase(), node, 'captured header-name literal');
    }
    if (node.type === 'CallExpression') {
      const method = node.callee.type === 'MemberExpression' ? key(node.callee.property) : key(node.callee);
      const target = node.arguments[method === 'open' ? 1 : 0];
      if (['fetch', 'sendBeacon', 'open'].includes(method)) {
        const candidate = endpoint(staticString(target));
        if (candidate)
          add('endpoints', candidate.value, target, `${method} argument (callee identity unproven)`, {
            kind: candidate.kind,
          });
      }
      if (['getCookie', 'setCookie', 'deleteCookie', 'removeCookie'].includes(method)) {
        node.arguments.slice(1).forEach(ignore);
        const name = staticString(node.arguments[0]);
        if (name && NAME.test(name))
          add('cookies', name, node.arguments[0], `${method} argument (callee identity unproven)`);
      }
      if (method === 'setRequestHeader') {
        node.arguments.slice(1).forEach(ignore);
        const name = staticString(node.arguments[0]);
        if (name && NAME.test(name)) add('headers', name.toLowerCase(), node.arguments[0], 'setRequestHeader argument');
      }
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
      if (node.left.object.name === 'document' && key(node.left.property) === 'cookie') {
        ignore(node.right);
        const cookie = staticString(node.right);
        const name = cookie?.slice(0, cookie.indexOf('=')).trim();
        if (cookie?.includes('=') && NAME.test(name)) add('cookies', name, node.right, 'document.cookie assignment');
      }
    }
    if (
      node.type === 'Property' &&
      !node.computed &&
      key(node.key) === 'headers' &&
      node.value.type === 'ObjectExpression'
    ) {
      for (const property of node.value.properties) {
        ignore(property.value);
        const name = !property.computed && key(property.key);
        if (typeof name === 'string' && NAME.test(name))
          add('headers', name.toLowerCase(), property, 'headers object key');
      }
    }
  }
  return Object.fromEntries(
    Object.entries(buckets).map(([type, bucket]) => [
      type,
      [...bucket.values()].sort((a, b) => compare(a.value, b.value)),
    ]),
  );
}

export function analyzeCapture(source, options = {}) {
  const ast = syntax(source);
  return { ...capturedTable(ast, options), signals: signalsFrom(ast) };
}

function catalogFrom(source) {
  const declarations = [...walk(syntax(source))].filter(
    ({ node }) => node.type === 'VariableDeclarator' && node.id.name === 'EXTENSION_PROBES',
  );
  if (declarations.length !== 1) throw new Error('Expected one EXTENSION_PROBES catalog declaration.');
  const node = declarations[0].node.init;
  const pairs = properties(node);
  for (const [id, file] of pairs) validatePair(id, file);
  return { node, pairs };
}

function difference(before, after) {
  return {
    added: [...after].filter((value) => !before.has(value)).sort(compare),
    removed: [...before].filter((value) => !after.has(value)).sort(compare),
  };
}

function signalChanges(baseline, signals) {
  if (baseline === undefined) return null;
  if (baseline?.schemaVersion !== 1) throw new Error('Unsupported baseline report schema.');
  return Object.fromEntries(
    Object.entries(signals).map(([type, entries]) => {
      const previous = baseline.signals?.[type];
      if (
        !Array.isArray(previous) ||
        previous.some(
          (entry) =>
            !entry ||
            typeof entry.value !== 'string' ||
            (type === 'endpoints' ? endpoint(entry.value)?.value !== entry.value : !NAME.test(entry.value)),
        )
      ) {
        throw new Error('Baseline must contain normalized endpoint candidates and cookie/header names only.');
      }
      return [
        type,
        difference(new Set(previous.map(({ value }) => value)), new Set(entries.map(({ value }) => value))),
      ];
    }),
  );
}

async function patchFor(before, after) {
  if (before === after) return '';
  const temporary = await mkdtemp(resolve(tmpdir(), 'shield-catalog-diff-'));
  try {
    for (const [folder, source] of [
      ['a', before],
      ['b', after],
    ]) {
      await mkdir(resolve(temporary, folder));
      await writeFile(resolve(temporary, folder, 'known-extensions.js'), source);
    }
    const result = spawnSync(
      'git',
      [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--no-prefix',
        '--',
        'a/known-extensions.js',
        'b/known-extensions.js',
      ],
      { cwd: temporary, encoding: 'utf8', maxBuffer: MAX_BYTES * 2 },
    );
    if (result.error || ![0, 1].includes(result.status))
      throw new Error('Could not generate the catalog patch with git diff.');
    return result.stdout;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const code = (value) => '`' + JSON.stringify(value).replaceAll('`', '\\u0060').replaceAll('<', '\\u003c') + '`';

function markdown(report) {
  const { source, table, catalog, signals, changes } = report;
  const lines = [
    '# Captured-script review',
    '',
    `Source SHA-256: ${code(source.sha256)} (${source.bytes} bytes).`,
    '',
    `Literal table ${code(table.name)} at line ${table.line}, column ${table.column}; ${catalog.count} unique pairs.`,
    '',
    `Sorted-pair SHA-256: ${code(catalog.pairsSha256)}.`,
    '',
    `Catalog: ${catalog.added.length} added, ${catalog.removed.length} removed, ${catalog.changed.length} changed resources.`,
    '',
    'Inspect `catalog.patch` before applying it. Curated names and categories are preserved.',
    'Review removals, update integrity expectations from independently checked evidence, then run `npm run verify`.',
    '',
    changes
      ? 'Signal deltas compare with the supplied prior report.'
      : 'No prior capture report supplied. Candidates below are not claims of newly introduced behavior.',
    '',
  ];
  for (const [type, entries] of Object.entries(signals)) {
    lines.push(`## ${type[0].toUpperCase()}${type.slice(1)}`, '');
    if (changes) {
      lines.push(`Added: ${changes[type].added.length}; removed: ${changes[type].removed.length}.`, '');
      for (const value of changes[type].added) lines.push(`- Added ${code(value)}`);
      for (const value of changes[type].removed) lines.push(`- Removed ${code(value)}`);
      lines.push('');
    }
    for (const entry of entries)
      lines.push(
        `- ${code(entry.value)} — ${entry.kind ?? 'name only'}; lines ${entry.locations.map((location) => location.line).join(', ')}; ${entry.contexts.join('; ')}.`,
      );
    if (!entries.length) lines.push('No static candidates found.');
    lines.push('');
  }
  lines.push('## Limits', '', ...report.limits.map((limit) => `- ${limit}`), '');
  return lines.join('\n');
}

async function boundedRead(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Inputs must be regular files no larger than 16 MiB.');
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error('Input grew beyond the 16 MiB review limit.');
  return bytes;
}

export async function reviewCapture({ inputPath, outDir, baselinePath, root = ROOT, ...options }) {
  const bytes = await boundedRead(inputPath);
  const sourceHash = hash(bytes);
  const analysis = analyzeCapture(bytes.toString('utf8'), options);
  const original = (await boundedRead(resolve(root, 'known-extensions.js'))).toString('utf8');
  const previous = catalogFrom(original);
  const next = new Map(analysis.pairs);
  const delta = difference(new Set(previous.pairs.keys()), new Set(next.keys()));
  let baseline;
  if (baselinePath) {
    const baselineBytes = await boundedRead(baselinePath);
    try {
      baseline = JSON.parse(baselineBytes.toString('utf8'));
    } catch {
      throw new Error('Cannot parse baseline report JSON.');
    }
  }
  const report = {
    schemaVersion: 1,
    source: { sha256: sourceHash, bytes: bytes.length },
    table: analysis.location,
    catalog: {
      count: next.size,
      pairsSha256: hash(JSON.stringify(analysis.pairs)),
      baselineCount: previous.pairs.size,
      added: delta.added.map((id) => ({ id, file: next.get(id) })),
      removed: delta.removed.map((id) => ({ id, file: previous.pairs.get(id) })),
      changed: analysis.pairs
        .filter(([id, file]) => previous.pairs.has(id) && previous.pairs.get(id) !== file)
        .map(([id, file]) => ({ id, before: previous.pairs.get(id), after: file })),
    },
    signals: analysis.signals,
    changes: signalChanges(baseline, analysis.signals),
    limits: [
      'Static strings are candidates, not proof of live requests or tracking. Request callee identities are not resolved.',
      'Dynamic expressions, aliases, encoded payloads, computed cookie names, and runtime configuration are not resolved.',
      'Relative paths have no verified hostname. No endpoint is automatically added to blocking rules.',
      'URL credentials, queries, and fragments are omitted. Paths may still contain sensitive data; review before sharing.',
      'Only cookie/header names are emitted. Capture source and absolute input paths are not copied into the report.',
      'Locations use one-based lines/columns and zero-based JavaScript string offsets; at most five locations per candidate.',
    ],
  };
  const replacement =
    '{\n' + analysis.pairs.map(([id, file]) => `  ${id}: ${JSON.stringify(file)},`).join('\n') + '\n}';
  let candidate = original.slice(0, previous.node.start) + replacement + original.slice(previous.node.end);
  candidate = candidate.replace(
    /\/\/ Captured const [A-Za-z_$][\w$]* registry: [\d,]+ unique extension IDs and their exact resource paths\./,
    () =>
      `// Captured const ${analysis.location.name} registry: ${next.size.toLocaleString('en-US')} unique extension IDs and their exact resource paths.`,
  );
  candidate = candidate.replace(/\/\/ SHA-256 of source: [a-f0-9]{64}/, `// SHA-256 of source: ${sourceHash}`);
  candidate = await format(candidate, {
    ...(await resolveConfig(resolve(root, 'known-extensions.js'))),
    parser: 'babel',
  });
  const patch = await patchFor(original, candidate);
  const destination = resolve(outDir ?? resolve(root, '.capture-reviews', sourceHash.slice(0, 12)));
  await mkdir(dirname(destination), { recursive: true });
  // Reserve exclusively, including against existing symlinks. Never overwrite an earlier review.
  await mkdir(destination, { mode: 0o700 });
  const temporary = await mkdtemp(resolve(dirname(destination), '.capture-review-'));
  try {
    await writeFile(resolve(temporary, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await writeFile(resolve(temporary, 'review.md'), markdown(report), { mode: 0o600 });
    await writeFile(resolve(temporary, 'catalog.patch'), patch, { mode: 0o600 });
    for (const file of ['report.json', 'review.md', 'catalog.patch'])
      await rename(resolve(temporary, file), resolve(destination, file));
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { report, destination, patch };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help')) {
      console.log(
        'Usage: npm run capture:review -- capture.js [--out directory] [--baseline report.json] [--table o] [--line number]',
      );
      process.exitCode = args.includes('--help') ? 0 : 1;
    } else {
      const options = { inputPath: resolve(args.shift()) };
      const flags = { '--out': 'outDir', '--baseline': 'baselinePath', '--table': 'table', '--line': 'line' };
      while (args.length) {
        const flag = args.shift();
        if (!flags[flag] || !args.length || args[0].startsWith('--'))
          throw new Error('Unknown or incomplete option. Use --help.');
        options[flags[flag]] = args.shift();
      }
      if (options.line !== undefined) {
        options.line = Number(options.line);
        if (!Number.isSafeInteger(options.line) || options.line < 1)
          throw new Error('--line must be a positive integer.');
      }
      if (options.table && !/^[A-Za-z_$][\w$]*$/.test(options.table)) throw new Error('--table must be an identifier.');
      const { report, destination } = await reviewCapture(options);
      console.log(`Review written to ${destination}`);
      console.log(
        `${report.catalog.count} pairs; ${report.catalog.added.length} added, ${report.catalog.removed.length} removed, ${report.catalog.changed.length} changed.`,
      );
      console.log(
        `${report.signals.endpoints.length} endpoint candidates. Catalog, rules, and integrity tests are unchanged.`,
      );
    }
  } catch (error) {
    console.error(
      error.code === 'EEXIST' ? 'Review directory already exists; choose a new --out directory.' : error.message,
    );
    process.exitCode = 1;
  }
}
