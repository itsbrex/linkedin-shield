import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { WebSocket } from 'ws';
import { buildExtension, ROOT, RUNTIME_FILES } from '../scripts/build.mjs';
import { buildDevelopment } from '../dev/build.mjs';
import { startDevelopment } from '../dev/server.mjs';
import { packageExtension } from '../scripts/package.mjs';

let root;
let running;
const read = (file) => readFileSync(join(root, file));
const json = (file) => JSON.parse(read(file));
const clients = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shield-dev-test-'));
  for (const file of [...RUNTIME_FILES, 'dev/hot-reload.js', 'dev/build.mjs', 'dev/icon.mjs', 'scripts/build.mjs']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(root, file));
  }
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await running?.close();
  running = null;
  rmSync(root, { recursive: true, force: true });
});

describe('Development and release builds', () => {
  it('gives dev a distinct identity and packages its client without changing production files', () => {
    buildExtension({ root });
    const before = read('dist/manifest.json');
    const { revision } = buildDevelopment({ root });
    const dev = json('.dev-build/manifest.json');
    expect(dev.name).toBe('[DEV] LinkedIn Shield');
    expect(dev.action.default_title).toBe(dev.name);
    expect(dev.minimum_chrome_version).toBe('120');
    expect(dev.permissions).toContain('alarms');
    expect(dev.host_permissions).toContain('http://127.0.0.1/*');
    expect(dev.content_security_policy.extension_pages).toContain('ws://127.0.0.1:8396');
    expect(read('.dev-build/background.js').toString()).toMatch(/^importScripts\('dev\/hot-reload.js'\)/);
    expect(read('.dev-build/dev/hot-reload.js').toString()).toContain(revision);
    for (const [size, file] of Object.entries(dev.icons)) {
      const icon = read(`.dev-build/${file}`);
      expect(icon.readUInt32BE(16)).toBe(Number(size));
      expect(icon.readUInt32BE(20)).toBe(Number(size));
      expect(icon.equals(read(file))).toBe(false);
    }
    expect(read('dist/manifest.json')).toEqual(before);
    expect(read('manifest.json')).toEqual(before);
    expect(read('.dev-build/content.js')).toEqual(read('content.js'));
  });

  it('creates a repeatable versioned ZIP with only release bytes and a matching checksum', () => {
    buildDevelopment({ root });
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/private.txt'), 'exclude');
    const path = packageExtension({ root });
    const filename = `linkedin-shield-${json('manifest.json').version}.zip`;
    expect(path).toBe(join(root, 'releases', filename));
    const zip = readFileSync(path);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([...RUNTIME_FILES].sort());
    for (const file of RUNTIME_FILES) expect([...entries[file]]).toEqual([...read(file)]);
    expect(createHash('sha256').update(zip).digest('hex')).toBe(readFileSync(`${path}.sha256`, 'utf8').split(' ')[0]);
    packageExtension({ root });
    expect(readFileSync(path)).toEqual(zip);
    expect(readdirSync(join(root, 'releases')).sort()).toEqual([filename, `${filename}.sha256`]);
  });

  it('retains the installed development build when manifest preparation fails', () => {
    buildDevelopment({ root });
    const manifest = read('.dev-build/manifest.json');
    const worker = read('.dev-build/background.js');
    writeFileSync(join(root, 'manifest.json'), '{');
    expect(() => buildDevelopment({ root })).toThrow();
    expect(read('.dev-build/manifest.json')).toEqual(manifest);
    expect(read('.dev-build/background.js')).toEqual(worker);
    expect(readdirSync(root).filter((name) => name.startsWith('.shield-build-'))).toEqual([]);
  });

  it('sends the current build on reconnect after edits made while the server was stopped', async () => {
    running = await startDevelopment({ root, port: 0, log: () => {} });
    const previous = read('.dev-build/dev/hot-reload.js');
    const port = running.port;
    await running.close();
    running = null;
    writeFileSync(join(root, 'popup.js'), '// saved while offline');
    running = await startDevelopment({ root, port, log: () => {} });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/reload`, {
      origin: `chrome-extension://${'a'.repeat(32)}`,
    });
    clients.push(socket);
    const message = await new Promise((done) => socket.once('message', (data) => done(JSON.parse(data))));
    expect(message.type).toBe('built');
    expect(previous.toString()).not.toContain(message.revision);
    expect(read('.dev-build/dev/hot-reload.js').toString()).toContain(message.revision);
    expect(read('.dev-build/popup.js').toString()).toBe('// saved while offline');
  });

  it('watches atomic saves, ignores unrelated files, and retains a good build after failures', async () => {
    const messages = [];
    const failures = [];
    running = await startDevelopment({ root, port: 0, log: () => {}, error: (message) => failures.push(message) });
    const origin = `http://127.0.0.1:${running.port}`;
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/reload', {
      origin: `chrome-extension://${'a'.repeat(32)}`,
    });
    clients.push(socket);
    socket.on('message', (bytes) => messages.push(JSON.parse(bytes)));
    await expect.poll(() => messages.length).toBe(1);
    const initial = messages[0].revision;
    writeFileSync(join(root, 'private.txt'), 'ignore this');
    writeFileSync(join(root, 'popup.js.tmp'), '// first save');
    renameSync(join(root, 'popup.js.tmp'), join(root, 'popup.js'));
    await expect.poll(() => read('.dev-build/popup.js').toString()).toBe('// first save');
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[1].revision).not.toBe(initial);
    rmSync(join(root, 'popup.js'));
    await expect.poll(() => failures.length).toBeGreaterThan(0);
    expect(read('.dev-build/popup.js').toString()).toBe('// first save');
    expect(messages).toHaveLength(2);
    writeFileSync(join(root, 'popup.js'), '// recovered save');
    await expect.poll(() => messages.length).toBe(3);
    expect(read('.dev-build/popup.js').toString()).toBe('// recovered save');
    const health = await (await fetch(origin + '/health')).json();
    expect(health.clients).toBe(1);
    expect(health.revision).toBe(messages[2].revision);
    expect(health.loadedRevisions).toEqual([]);
    socket.send(JSON.stringify({ type: 'ready', revision: messages[2].revision }));
    await expect
      .poll(async () => (await (await fetch(origin + '/health')).json()).loadedRevisions)
      .toEqual([messages[2].revision]);
    expect((await fetch(origin + '/manifest.json')).status).toBe(404);
  });

  it('rejects web-page socket origins and fails on port conflicts without replacing an installed build', async () => {
    running = await startDevelopment({ root, port: 0, log: () => {} });
    const socket = new WebSocket(`ws://127.0.0.1:${running.port}/reload`, { origin: 'https://example.com' });
    const failure = await new Promise((done) => socket.once('error', done));
    expect(failure.message).toContain('403');
    const before = read('.dev-build/manifest.json');
    await expect(startDevelopment({ root, port: running.port, log: () => {} })).rejects.toThrow('EADDRINUSE');
    expect(read('.dev-build/manifest.json')).toEqual(before);
  });
});
