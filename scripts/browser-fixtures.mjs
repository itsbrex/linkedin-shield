#!/usr/bin/env node
/** Loopback-only synthetic request sink; never records cookies or header values. */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { browserCheckIds } from '../dev/network-cases.js';

export async function startBrowserFixtures({ port = 8397, onReport = () => {} } = {}) {
  const token = randomBytes(16).toString('hex');
  const prefix = `/run/${token}`;
  const hits = [];
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.host !== `127.0.0.1:${port}` || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
      send(403, { error: 'Expected a local extension test request.' });
      return;
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Li-Apfc-Data, X-Shield-Control');
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/session') {
      send(200, { base: `http://127.0.0.1:${port}${prefix}` });
    } else if (request.method === 'GET' && request.url === `${prefix}/state`) {
      send(200, { hits });
    } else if (
      request.method === 'GET' &&
      ['control', 'blocked', 'headers'].some((name) => request.url === `${prefix}/${name}`)
    ) {
      if (hits.length >= 100) {
        send(429, { error: 'Restart the fixture server.' });
        return;
      }
      const hit = {
        path: request.url.slice(prefix.length),
        apfc: request.headers['x-li-apfc-data'] === 'synthetic-apfc',
        control: request.headers['x-shield-control'] === 'synthetic-control',
      };
      hits.push(hit);
      send(200, hit);
    } else if (request.method === 'POST' && request.url === `${prefix}/report`) {
      let body = '';
      try {
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 8192) {
            send(413, { error: 'Report too large.' });
            return;
          }
        }
        const input = JSON.parse(body);
        const tests = input.tests;
        if (
          !Array.isArray(tests) ||
          tests.length !== browserCheckIds.length ||
          new Set(tests.map((test) => test.id)).size !== browserCheckIds.length ||
          tests.some((test) => !browserCheckIds.includes(test.id) || typeof test.passed !== 'boolean')
        ) {
          throw new Error('Incomplete test report.');
        }
        const report = { tests: tests.map(({ id, passed }) => ({ id, passed })) };
        send(200, { accepted: true });
        onReport(report);
      } catch {
        send(400, { error: 'Expected a complete bounded test report.' });
      }
    } else send(404, { error: 'No fixture at this path.' });
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  port = server.address().port;
  return { port, close: () => new Promise((done) => server.close(done)) };
}

if (import.meta.main) {
  let timer;
  let fixture;
  startBrowserFixtures({
    onReport({ tests }) {
      for (const test of tests) console.log(`${test.passed ? 'PASS' : 'FAIL'} ${test.id}`);
      process.exitCode = tests.every((test) => test.passed) ? 0 : 1;
      clearTimeout(timer);
      fixture.close();
    },
  })
    .then((server) => {
      fixture = server;
      console.log('In the [DEV] Shield popup, open Browser regression tests and click Run tests.');
      console.log('Synthetic fixture server: http://127.0.0.1:8397 — waiting up to 3 minutes.');
      timer = setTimeout(() => {
        console.error('No complete browser report received. No browser pass is claimed.');
        process.exitCode = 1;
        server.close();
      }, 180000);
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => {
          clearTimeout(timer);
          server.close();
        });
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
