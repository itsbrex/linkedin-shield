import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtension, ROOT, RUNTIME_FILES } from '../scripts/build.mjs';
import { developmentIcon } from './icon.mjs';

export const PORT = 8396;
export const DEV_FILES = [
  'dev/hot-reload.js',
  'dev/dev-connect.html',
  'dev/dev-connect.js',
  'dev/browser-tests.html',
  'dev/browser-tests.js',
  'dev/popup-fixture.js',
  'dev/network-cases.js',
];
export const WATCH_FILES = [...RUNTIME_FILES, ...DEV_FILES];
export const TOOLING_FILES = ['dev/build.mjs', 'dev/icon.mjs', 'scripts/build.mjs'];

export function sourceRevision(root = ROOT, files = [...WATCH_FILES, ...TOOLING_FILES]) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file).update(readFileSync(join(root, file)));
  }
  return hash.digest('hex');
}

/**
 * The manifest has no "key", so Chrome derives the unpacked development build's
 * id from the absolute path it was loaded from: sha256(path), first 32 hex
 * digits mapped 0-f -> a-p. The server accepts only this origin.
 */
export function extensionOrigin(root = ROOT) {
  const hex = createHash('sha256')
    .update(join(realpathSync(root), '.dev-build'))
    .digest('hex')
    .slice(0, 32);
  return `chrome-extension://${[...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join('')}`;
}

export function buildDevelopment({ root = ROOT, port = PORT } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid development port.');
  const revision = sourceRevision(root);
  const output = buildExtension({
    root,
    outputName: '.dev-build',
    prepare(staging) {
      const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'));
      manifest.name = `[DEV] ${manifest.name}`;
      manifest.action.default_title = manifest.name;
      manifest.minimum_chrome_version = String(Math.max(120, Number.parseInt(manifest.minimum_chrome_version || '0')));
      manifest.permissions = [...new Set([...manifest.permissions, 'alarms'])];
      manifest.host_permissions = [...new Set([...manifest.host_permissions, 'http://127.0.0.1/*'])];
      // Only the worker opens the socket; dev/dev-connect.html fetches the HTTP
      // origin to ask for local network access. Keep remote code and eval forbidden.
      manifest.content_security_policy = {
        ...manifest.content_security_policy,
        extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' ws://127.0.0.1:${port} http://127.0.0.1:${port} http://127.0.0.1:8397 https://api.anthropic.com https://api.openai.com https://*.aliyuncs.com https://api.deepseek.com`,
      };
      writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      for (const [size, path] of Object.entries(manifest.icons)) {
        writeFileSync(join(staging, path), developmentIcon(Number(size)));
      }
      mkdirSync(join(staging, 'dev'));
      for (const file of DEV_FILES) copyFileSync(join(root, file), join(staging, file));
      const popup = readFileSync(join(staging, 'popup.html'), 'utf8');
      const fixtures = popup
        .replace(/<script src="(?:known-extensions|popup)\.js"><\/script>/g, '')
        .replace('</head>', '<script src="popup-fixture.js"></script></head>');
      if (fixtures.includes('src="popup.js"') || fixtures.includes('src="known-extensions.js"')) {
        throw new Error('Popup fixture isolation failed.');
      }
      writeFileSync(join(staging, 'dev/popup-fixture.html'), fixtures);
      writeFileSync(
        join(staging, 'popup.html'),
        popup.replace(
          '</body>',
          '<p style="padding: 0 18px"><a href="dev/browser-tests.html" target="_blank" rel="noopener">Browser regression tests</a></p></body>',
        ),
      );
      const config = {
        revision,
        endpoint: `ws://127.0.0.1:${port}/reload`,
        grant: `http://127.0.0.1:${port}/grant`,
      };
      for (const file of ['dev/hot-reload.js', 'dev/dev-connect.js']) {
        writeFileSync(
          join(staging, file),
          `globalThis.SHIELD_DEV = ${JSON.stringify(config)};\n${readFileSync(join(root, file), 'utf8')}`,
        );
      }
      const worker = join(staging, manifest.background.service_worker);
      writeFileSync(worker, `importScripts('dev/hot-reload.js');\n${readFileSync(worker, 'utf8')}`);
    },
  });
  return { output, revision };
}

if (import.meta.main) {
  try {
    console.log(`Built [DEV] LinkedIn Shield in ${buildDevelopment().output}`);
  } catch (error) {
    console.error(`Development build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
