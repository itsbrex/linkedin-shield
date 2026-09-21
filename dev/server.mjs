#!/usr/bin/env node
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ROOT } from '../scripts/build.mjs';
import { buildDevelopment, PORT, sourceRevision, WATCH_FILES } from './build.mjs';

export async function startDevelopment({ root = ROOT, port = PORT, log = console.log, error = console.error } = {}) {
  let current;
  let timer;
  let watchers = [];
  let closed = false;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health' || request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(
      JSON.stringify({
        name: 'LinkedIn Shield DEV',
        revision: current?.revision,
        clients: sockets.clients.size,
        loadedRevisions: [...new Set([...sockets.clients].map((client) => client.revision).filter(Boolean))],
      }),
    );
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (
      request.url !== '/reload' ||
      request.headers.host !== `127.0.0.1:${port}` ||
      !/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin || '')
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client));
  });
  sockets.on('connection', (client) => {
    client.on('error', () => {});
    client.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message?.type !== 'ready' || !/^[a-f0-9]{64}$/.test(message.revision)) return;
      client.revision = message.revision;
      log(`[dev] extension running ${message.revision.slice(0, 12)}`);
    });
    client.send(JSON.stringify({ type: 'built', revision: current.revision }));
    log('[dev] extension connected');
  });

  function rebuild() {
    if (closed) return;
    try {
      if (sourceRevision(root) === current.revision) return;
      current = buildDevelopment({ root, port });
      for (const client of sockets.clients) {
        if (client.readyState === WebSocket.OPEN)
          client.send(JSON.stringify({ type: 'built', revision: current.revision }));
      }
      log('[dev] rebuilt; reload signaled');
    } catch (failure) {
      error(`[dev] rebuild failed; previous build kept: ${failure.message}`);
    }
  }

  function close() {
    closed = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    for (const client of sockets.clients) client.terminate();
    sockets.close();
    return new Promise((done) => server.close(done));
  }

  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', done);
    });
    port = server.address().port;
    current = buildDevelopment({ root, port });
    const watched = new Set(WATCH_FILES);
    // Watch parent directories so editor atomic-save/rename operations remain visible.
    watchers = [...new Set(WATCH_FILES.map((file) => dirname(file)))].map((directory) => {
      const watcher = watch(join(root, directory), (_event, filename) => {
        if (!filename) return;
        const relative = join(directory, String(filename)).split(sep).join('/');
        if (!watched.has(relative)) return;
        clearTimeout(timer);
        timer = setTimeout(rebuild, 120);
      });
      watcher.on('error', (failure) => error(`[dev] watcher failed: ${failure.message}`));
      return watcher;
    });
    log(`[dev] load ${current.output} once; watching on 127.0.0.1:${port}`);
    return { close, port, output: current.output };
  } catch (failure) {
    await close();
    throw failure;
  }
}

if (import.meta.main) {
  startDevelopment({ port: Number(process.env.SHIELD_DEV_PORT || PORT) }).then(
    (server) => {
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
    },
    (failure) => {
      console.error(`[dev] ${failure.message}`);
      process.exitCode = 1;
    },
  );
}
