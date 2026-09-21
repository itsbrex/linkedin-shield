import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExtension, ROOT, RUNTIME_FILES } from '../scripts/build.mjs';
import { developmentIcon } from './icon.mjs';

export const PORT = 8396;
export const WATCH_FILES = [...RUNTIME_FILES, 'dev/hot-reload.js'];

export function sourceRevision(root = ROOT) {
  const hash = createHash('sha256');
  for (const file of [...WATCH_FILES, 'dev/build.mjs', 'dev/icon.mjs', 'scripts/build.mjs']) {
    hash.update(file).update(readFileSync(join(root, file)));
  }
  return hash.digest('hex');
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
      // Only the worker opens the socket. Keep remote code and eval forbidden.
      manifest.content_security_policy = {
        ...manifest.content_security_policy,
        extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' ws://127.0.0.1:${port} https://api.anthropic.com https://api.openai.com https://*.aliyuncs.com https://api.deepseek.com`,
      };
      writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      for (const [size, path] of Object.entries(manifest.icons)) {
        writeFileSync(join(staging, path), developmentIcon(Number(size)));
      }
      mkdirSync(join(staging, 'dev'));
      const config = { revision, endpoint: `ws://127.0.0.1:${port}/reload` };
      writeFileSync(
        join(staging, 'dev/hot-reload.js'),
        `globalThis.SHIELD_DEV = ${JSON.stringify(config)};\n${readFileSync(join(root, 'dev/hot-reload.js'), 'utf8')}`,
      );
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
