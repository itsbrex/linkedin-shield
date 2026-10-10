/** Execute the shipped MAIN-world script against public browser APIs. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const probe = 'chrome-extension://aaaeoelkococjpgngfokhbkkfiiegolp/icon/16.png';
const trackerPaths = [
  '/platform-telemetry/li/apfcDf',
  '/apfc/collect',
  '/li/track',
  '/sensorCollect',
  '/to11ysim2l0rlGBsG',
  '/to11ysim2l0rlGBsG?batch=synthetic',
];
let dom, win, nativeFetch, nativeOpen, nativeBeacon, timers, entries;

function start() {
  win.eval(source + '\n//# sourceURL=chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/content.js');
}
function stats() {
  for (const callback of timers) callback();
  return JSON.parse(win.document.documentElement.getAttribute('data-linkedin-shield'));
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.linkedin.com/feed/',
    runScripts: 'outside-only',
  });
  win = dom.window;
  timers = [];
  entries = [];
  win.setInterval = vi.fn((callback) => {
    timers.push(callback);
    return timers.length;
  });
  win.setTimeout = vi.fn((callback) => {
    timers.push(callback);
    return timers.length;
  });
  win.postMessage = vi.fn();
  win.Response = Response;
  nativeFetch = win.fetch = vi.fn(async () => ({ status: 200 }));
  nativeOpen = vi.fn();
  win.XMLHttpRequest = class {
    open(...args) {
      return nativeOpen(...args);
    }
    abort() {
      this.aborted = true;
    }
  };
  nativeBeacon = win.navigator.sendBeacon = vi.fn(() => true);
  Object.defineProperty(win.navigator, 'deviceMemory', { configurable: true, value: 16 });
  win.navigator.getBattery = vi.fn();
  win.performance.getEntries = vi.fn(() => entries);
  win.performance.getEntriesByType = vi.fn(() => entries);
  win.performance.getEntriesByName = vi.fn((name) => entries.filter((entry) => entry.name === String(name)));
});
afterEach(() => dom.window.close());

describe('Blocked error privacy', () => {
  it('rejects with a TypeError without exposing any extension in collected exception fields', async () => {
    start();
    win.eval(`
      const wrappedFetch = window.fetch;
      window.fetch = function (...args) { return wrappedFetch(...args); };
      //# sourceURL=chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-save-bridge.js
    `);
    const [{ status, reason }] = await Promise.allSettled([win.fetch(probe)]);
    expect(status).toBe('rejected');
    expect(reason).toBeInstanceOf(win.TypeError);
    expect(reason.message).toBe('Failed to fetch');
    const telemetry = JSON.stringify({ name: reason.name, message: reason.message, stack: reason.stack });
    expect(telemetry).not.toMatch(/chrome-extension:|moz-extension:|LinkedIn Shield|content\.js|native-save-bridge/);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('throws a neutral XHR NetworkError without exposing extension names or locations', () => {
    start();
    const xhr = new win.XMLHttpRequest();
    let failure;
    try {
      xhr.open('POST', probe);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(win.DOMException);
    expect(failure.name).toBe('NetworkError');
    const telemetry = JSON.stringify({ message: String(failure), stack: failure.stack });
    expect(telemetry).not.toMatch(/chrome-extension:|moz-extension:|LinkedIn Shield|content\.js/);
    expect(xhr.aborted).toBe(true);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it('preserves native errors from allowed requests, including their diagnostic stacks', async () => {
    const failure = new win.TypeError('Native failure');
    const stack = failure.stack;
    nativeFetch.mockRejectedValueOnce(failure);
    nativeOpen.mockImplementationOnce(() => {
      throw failure;
    });
    start();
    await expect(win.fetch('/voyager/api/me')).rejects.toBe(failure);
    expect(() => new win.XMLHttpRequest().open('GET', '/voyager/api/me')).toThrow(failure);
    expect(failure.stack).toBe(stack);
  });
});

describe('Extension probe protection', () => {
  it('rejects inaccessible extensions instead of fulfilling with HTTP 404', async () => {
    start();
    await expect(win.fetch(probe)).rejects.toThrow('Failed to fetch');
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(stats().probes).toBe(1);
    expect(stats().context.extensionIds).toEqual(['aaaeoelkococjpgngfokhbkkfiiegolp']);
  });

  it('defeats both Promise.allSettled and serial truthy-response detection', async () => {
    start();
    const results = await Promise.allSettled([win.fetch(probe), win.fetch(new win.URL(probe))]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    const hits = [];
    try {
      if (await win.fetch({ url: probe })) hits.push(probe);
    } catch {
      /* expected network failure */
    }
    expect(hits).toEqual([]);
    expect(stats().probes).toBe(3);
    expect(stats().context.extensionIds).toHaveLength(1);
  });

  it('blocks Firefox probes and invalid Chrome probes without reporting invalid IDs', async () => {
    start();
    await expect(win.fetch('moz-extension://12345678-1234-1234-1234-123456789012/icon.png')).rejects.toThrow();
    await expect(win.fetch('chrome-extension://invalid/icon.png')).rejects.toThrow();
    expect(stats().probes).toBe(2);
    expect(stats().context.extensionIds).toEqual(['12345678-1234-1234-1234-123456789012']);
  });

  it('preserves ordinary requests and does not match extension URLs embedded in query strings', async () => {
    start();
    const url = 'https://www.linkedin.com/search/?q=' + probe;
    const options = { method: 'POST', body: 'ordinary request' };
    await win.fetch(url, options);
    expect(nativeFetch).toHaveBeenCalledWith(url, options);
    expect(stats().probes).toBe(0);
  });

  it('caps unique samples but keeps counting all attempts', async () => {
    start();
    for (let i = 0; i < 60; i++) {
      const id = 'a'.repeat(30) + String.fromCharCode(97 + Math.floor(i / 16), 97 + (i % 16));
      await win.fetch(`chrome-extension://${id}/icon.png`).catch(() => {});
    }
    expect(stats().probes).toBe(60);
    expect(stats().context.extensionIds).toHaveLength(50);
  });

  it('aborts reused XHRs and fails before native open for blocked requests', () => {
    start();
    const xhr = new win.XMLHttpRequest();
    xhr.open('GET', '/voyager/api/me', false);
    expect(nativeOpen).toHaveBeenCalledWith('GET', '/voyager/api/me', false);
    expect(() => xhr.open('GET', new win.URL(probe))).toThrow();
    expect(xhr.aborted).toBe(true);
    expect(nativeOpen).toHaveBeenCalledTimes(1);
    expect(stats().probes).toBe(1);
  });

  it('filters extension timing entries without inflating blocked request counts', () => {
    entries = [{ name: probe }, { name: 'moz-extension://123/icon.png' }, { name: 'https://www.linkedin.com/feed/' }];
    start();
    expect(win.performance.getEntriesByName(probe)).toEqual([]);
    expect(win.performance.getEntriesByType('resource')).toEqual([entries[2]]);
    expect(win.performance.getEntries()).toEqual([entries[2]]);
    expect(stats().probes).toBe(0);
  });

  it('is idempotent and also protects LinkedIn child frames', async () => {
    dom.reconfigure({ windowTop: {} });
    start();
    const firstFetch = win.fetch;
    start();
    expect(win.fetch).toBe(firstFetch);
    await expect(win.fetch(probe)).rejects.toThrow();
    expect(win.postMessage).not.toHaveBeenCalled();
  });
});

describe('Surveillance endpoints', () => {
  it.each([
    'https://example.com/to11ysim2l0rlGBsG',
    'https://www.linkedin.com.example.com/to11ysim2l0rlGBsG',
    'https://linkedin.com/to11ysim2l0rlGBsG',
    'https://www.linkedin.com:8443/to11ysim2l0rlGBsG',
    '/to11ysim2l0rlGBsG-extra',
    '/to11ysim2l0rlGBsG/other',
    '/to11ysim2l0rlgbsg',
    '/voyager/api/me?next=/to11ysim2l0rlGBsG',
  ])('preserves requests outside the observed telemetry origin and path: %s', async (url) => {
    start();
    await win.fetch(url);
    new win.XMLHttpRequest().open('POST', url);
    expect(win.navigator.sendBeacon(url, 'synthetic')).toBe(true);
    expect(nativeFetch).toHaveBeenCalledWith(url);
    expect(nativeOpen).toHaveBeenCalledWith('POST', url);
    expect(nativeBeacon).toHaveBeenCalledWith(url, 'synthetic');
    expect(stats().trackers).toBe(0);
  });

  it.each(trackerPaths)('blocks fetch, XHR and beacon to %s', async (path) => {
    start();
    await expect(win.fetch(new win.URL(path, win.location.href))).rejects.toThrow();
    expect(() => new win.XMLHttpRequest().open('POST', path)).toThrow();
    expect(win.navigator.sendBeacon(path, 'private payload')).toBe(false);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(nativeBeacon).not.toHaveBeenCalled();
    expect(stats().trackers).toBe(3);
  });

  it('blocks HUMAN and merchant fingerprint loaders', async () => {
    start();
    await expect(win.fetch('https://li.protechts.net/index_stg.html')).rejects.toThrow();
    await expect(win.fetch('https://merchantpool1.linkedin.com/mdt.js?session_id=secret')).rejects.toThrow();
    expect(stats().trackers).toBe(2);
  });

  it('preserves lookalike hosts, ordinary APIs, authentication, and unrelated beacons', async () => {
    start();
    for (const url of [
      'https://example.com/apfc/collect',
      'https://linkedin.com.example.com/li/track',
      'https://example.com/?q=protechts.net',
      '/voyager/api/me',
      '/checkpoint/challenge',
      '/apfc/collector',
    ]) {
      await win.fetch(url);
    }
    expect(nativeFetch).toHaveBeenCalledTimes(6);
    expect(win.navigator.sendBeacon('/voyager/api/seen', 'ok')).toBe(true);
    expect(stats().trackers).toBe(0);
  });

  it('redacts query values and counts beyond the bounded URL sample', async () => {
    start();
    for (let i = 0; i < 15; i++) {
      await win.fetch(`https://www.linkedin.com/apfc/collect?session_id=secret-${i}#private`).catch(() => {});
    }
    expect(stats().trackers).toBe(15);
    expect(stats().context.blockedUrls).toEqual(['https://www.linkedin.com/apfc/collect']);
    expect(JSON.stringify(stats())).not.toContain('secret');
    expect(JSON.stringify(win.postMessage.mock.calls)).not.toContain('secret');
  });

  it('removes existing, nested, and retargeted HUMAN iframes only', async () => {
    win.document.body.innerHTML = '<iframe src="https://li.protechts.net/index.html"></iframe>';
    start();
    expect(win.document.querySelector('iframe')).toBeNull();
    const wrapper = win.document.createElement('div');
    wrapper.innerHTML =
      '<iframe src="https://li.protechts.net/index_stg.html"></iframe><iframe src="https://example.com/?q=protechts.net"></iframe>';
    win.document.body.append(wrapper);
    await Promise.resolve();
    expect(wrapper.querySelectorAll('iframe')).toHaveLength(1);
    wrapper.querySelector('iframe').src = 'https://li.protechts.net/index.html';
    await Promise.resolve();
    expect(wrapper.querySelector('iframe')).toBeNull();
    expect(stats().context.iframesRemoved).toBe(3);
  });
});

describe('Cookie observations and fingerprints', () => {
  it('records only allowlisted names, including transient cookie writes, without altering cookies', () => {
    win.document.cookie = 'df_ts=private-timestamp; path=/';
    win.document.cookie = 'li_at=private-auth; path=/';
    start();
    for (const name of ['li_apfcdc', '_px3', '_pxhd', '_pxvid', 'pxcts']) {
      win.document.cookie = `${name}=private-value; path=/`;
      win.document.cookie = `${name}=; Max-Age=0; path=/`;
    }
    expect(stats().context.cookieNames.sort()).toEqual(['_px3', '_pxhd', '_pxvid', 'df_ts', 'li_apfcdc', 'pxcts']);
    expect(stats().trackers).toBe(0);
    expect(win.document.cookie).toContain('df_ts=private-timestamp');
    expect(win.document.cookie).toContain('li_at=private-auth');
    expect(JSON.stringify(stats())).not.toContain('private');
  });

  it('reports only successfully installed fingerprint shields', async () => {
    start();
    expect(win.navigator.hardwareConcurrency).toBe(4);
    expect(win.navigator.deviceMemory).toBe(8);
    expect((await win.navigator.getBattery()).level).toBe(1);
    expect(stats().fingerprints).toBe(3);
    expect(stats().total).toBe(3);
  });

  it('does not invent unavailable APIs or tracker activity', () => {
    delete win.navigator.getBattery;
    delete win.navigator.deviceMemory;
    start();
    expect(stats().fingerprints).toBe(1);
    expect(stats().trackers).toBe(0);
    expect(stats().context.detectionMethod).toBe('passive');
  });

  it('keeps reporting when an existing fingerprint API cannot be replaced', () => {
    Object.defineProperty(win.navigator, 'getBattery', { writable: false });
    start();
    expect(stats().fingerprints).toBe(2);
    expect(stats().context.fingerprintApis).not.toContain('navigator.getBattery()');
  });
});
