import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBrowserFixtures } from '../scripts/browser-fixtures.mjs';
import { browserCheckIds } from '../dev/network-cases.js';

let server, origin, base, onReport;
beforeEach(async () => {
  onReport = vi.fn();
  server = await startBrowserFixtures({ port: 0, onReport });
  origin = `http://127.0.0.1:${server.port}`;
  base = (await (await fetch(origin + '/session')).json()).base;
});
afterEach(async () => server.close());

describe('Browser fixture server', () => {
  it('records synthetic header presence without retaining values or credentials', async () => {
    const response = await fetch(base + '/control', {
      headers: {
        'X-Li-Apfc-Data': 'synthetic-apfc',
        'X-Shield-Control': 'synthetic-control',
        Cookie: 'private=do-not-store',
        Authorization: 'Bearer do-not-store',
      },
    });
    expect(await response.json()).toEqual({ path: '/control', apfc: true, control: true });
    const text = await (await fetch(base + '/state')).text();
    expect(text).not.toContain('do-not-store');
    expect(text).not.toContain('synthetic-apfc');
    expect(JSON.parse(text).hits).toHaveLength(1);
  });

  it('rejects website origins and serves no repository files', async () => {
    expect((await fetch(origin + '/session', { headers: { Origin: 'https://example.com' } })).status).toBe(403);
    expect((await fetch(origin + '/package.json')).status).toBe(404);
    expect((await fetch(origin + '/run/invalid/control')).status).toBe(404);
    const extension = `chrome-extension://${'a'.repeat(32)}`;
    const response = await fetch(origin + '/session', { headers: { Origin: extension } });
    expect(response.headers.get('access-control-allow-origin')).toBe(extension);
  });

  it('rejects incomplete, duplicate, and oversized reports', async () => {
    const send = (body) => fetch(base + '/report', { method: 'POST', body });
    expect((await send(JSON.stringify({ tests: [] }))).status).toBe(400);
    expect(
      (await send(JSON.stringify({ tests: browserCheckIds.map(() => ({ id: browserCheckIds[0], passed: true })) })))
        .status,
    ).toBe(400);
    expect((await send('x'.repeat(8193))).status).toBe(413);
    expect(onReport).not.toHaveBeenCalled();
  });

  it('accepts a complete report while stripping unrecognized fields', async () => {
    const tests = browserCheckIds.map((id) => ({ id, passed: true, ignored: 'do-not-store' }));
    const response = await fetch(base + '/report', { method: 'POST', body: JSON.stringify({ tests }) });
    expect(response.status).toBe(200);
    expect(onReport).toHaveBeenCalledExactlyOnceWith({ tests: tests.map(({ id, passed }) => ({ id, passed })) });
  });
});
