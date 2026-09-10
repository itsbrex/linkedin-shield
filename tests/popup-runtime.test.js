/** Popup behavior through the shipped HTML/script, with Chrome APIs mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../known-extensions.js', import.meta.url), 'utf8');
let dom, win, raw, poll, storage, tabUrl, executeScript;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const byId = (id) => win.document.getElementById(id);
async function start() {
  // Await jsdom's own DOMContentLoaded before installing the extension listener.
  await tick();
  new Script(catalog).runInContext(dom.getInternalVMContext());
  new Script(source).runInContext(dom.getInternalVMContext());
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  await tick();
}

beforeEach(() => {
  dom = new JSDOM(html, { url: 'https://shield.test/popup.html', runScripts: 'outside-only' });
  win = dom.window;
  raw = null;
  storage = {};
  tabUrl = 'https://www.linkedin.com/feed/';
  win.setInterval = vi.fn((callback) => {
    poll = callback;
    return 1;
  });
  win.clearInterval = vi.fn();
  win.navigator.clipboard = { writeText: vi.fn(async () => {}) };
  win.fetch = vi.fn();
  executeScript = vi.fn(async () => [{ result: raw }]);
  win.chrome = {
    tabs: { query: async () => [{ id: 1, url: tabUrl }] },
    scripting: { executeScript },
    storage: {
      local: {
        get: async () => storage,
        set: vi.fn(async (value) => Object.assign(storage, value)),
      },
    },
  };
});
afterEach(() => dom.window.close());

describe('Popup live evidence', () => {
  it('shows zero counts and waiting state before page evidence arrives', async () => {
    await start();
    expect(byId('total-count').textContent).toBe('0');
    expect(byId('shield-status').textContent).toContain('Waiting');
    expect(win.fetch).not.toHaveBeenCalled();
  });

  it('accepts only actual LinkedIn hosts', async () => {
    tabUrl = 'https://linkedin.com.example.com/?q=linkedin.com';
    await start();
    expect(byId('no-linkedin').style.display).toBe('block');
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('renders captured resources and observed cookie names without claiming installation', async () => {
    raw = JSON.stringify({
      probes: 3,
      fingerprints: 2,
      trackers: 1,
      total: 6,
      context: {
        extensionIds: ['aaaeoelkococjpgngfokhbkkfiiegolp'],
        cookieNames: ['df_ts', '_px3'],
        blockedUrls: ['https://www.linkedin.com/apfc/collect?session=secret'],
      },
    });
    await start();
    const text = byId('context-details').textContent;
    expect(text).toContain('aaaeoelkococjpgngfokhbkkfiiegolp');
    expect(text).toContain('icon/16.png');
    expect(text).toContain('df_ts');
    expect(text).toContain('not proof of installation');
    expect(text).not.toContain('secret');
    expect(byId('total-count').textContent).toBe('6');
  });

  it('refreshes all counts, descriptions and cookie-only changes, including zeros', async () => {
    raw = JSON.stringify({ probes: 5, fingerprints: 3, trackers: 2, total: 10 });
    await start();
    raw = JSON.stringify({
      probes: 0,
      fingerprints: 0,
      trackers: 0,
      total: 0,
      context: { cookieNames: ['li_apfcdc'] },
    });
    await poll();
    expect(byId('probes-count').textContent).toBe('0');
    expect(byId('fingerprints-count').textContent).toBe('0');
    expect(byId('trackers-count').textContent).toBe('0');
    expect(byId('context-details').textContent).toContain('li_apfcdc');
    expect(byId('context-details').textContent).not.toContain('5 extension probes');
    expect(win._shieldStats.total).toBe(0);
  });

  it('keeps expanded evidence open across polls', async () => {
    raw = JSON.stringify({ probes: 1, context: { extensionIds: ['aaaeoelkococjpgngfokhbkkfiiegolp'] } });
    await start();
    byId('extension-evidence').open = true;
    await poll();
    expect(byId('extension-evidence').open).toBe(true);
  });

  it('handles malformed/null stats and rejects invalid count values', async () => {
    raw = 'not json';
    await start();
    expect(byId('total-count').textContent).toBe('0');
    raw = JSON.stringify({ probes: -10, fingerprints: 'secret', trackers: 2, total: 9999 });
    await poll();
    expect(byId('total-count').textContent).toBe('2');
    raw = null;
    await poll();
    expect(byId('total-count').textContent).toBe('0');
  });

  it('shares accurate zeros and excludes detailed evidence', async () => {
    raw = JSON.stringify({ probes: 0, fingerprints: 0, trackers: 0, context: { cookieNames: ['df_ts'] } });
    await start();
    byId('share-btn').click();
    await tick();
    const text = win.navigator.clipboard.writeText.mock.calls[0][0];
    expect(text).toContain('0 device');
    expect(text).toContain('0 tracker');
    expect(text).not.toContain('df_ts');
  });

  it('requires explicit AI click and configured key, sending aggregate counts only', async () => {
    raw = JSON.stringify({ probes: 2, fingerprints: 1, trackers: 3, context: { cookieNames: ['df_ts'] } });
    storage = { ai_provider: 'anthropic', ai_api_key: 'synthetic-test-key' };
    win.fetch.mockResolvedValue({ json: async () => ({ content: [{ text: 'Synthetic analysis' }] }) });
    await start();
    expect(win.fetch).not.toHaveBeenCalled();
    byId('ai-analyze-btn').click();
    await tick();
    expect(win.fetch).toHaveBeenCalledTimes(1);
    expect(win.fetch.mock.calls[0][1].body).not.toContain('df_ts');
    expect(byId('ai-result').textContent).toBe('Synthetic analysis');
  });
});
