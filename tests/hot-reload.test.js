import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const client = readFileSync(new URL('../dev/hot-reload.js', import.meta.url), 'utf8');
const revision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const pending = 'shieldDevReloadPending';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function worker(storage = {}, { start = true } = {}) {
  const sockets = [];
  const intervals = [];
  const timeouts = [];
  const alarms = [];
  const installed = [];
  class Socket {
    static OPEN = 1;
    static CLOSING = 2;
    constructor(endpoint) {
      this.endpoint = endpoint;
      this.readyState = 0;
      this.send = vi.fn();
      sockets.push(this);
    }
    open() {
      this.readyState = Socket.OPEN;
      this.onopen();
    }
    message(data) {
      this.onmessage({ data: JSON.stringify(data) });
    }
    close() {
      this.readyState = 3;
      this.onclose();
    }
  }
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...storage })),
        set: vi.fn(async (values) => Object.assign(storage, values)),
        remove: vi.fn(async (key) => delete storage[key]),
      },
    },
    runtime: {
      reload: vi.fn(),
      getURL: (path) => `chrome-extension://${'a'.repeat(32)}/${path}`,
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: (listener) => installed.push(listener) },
    },
    tabs: { query: vi.fn(async () => [{ id: 7 }]), reload: vi.fn(async () => {}), create: vi.fn(async () => {}) },
    alarms: {
      create: vi.fn(async () => {}),
      onAlarm: { addListener: (listener) => alarms.push(listener) },
    },
  };
  const context = {
    SHIELD_DEV: { endpoint: 'ws://127.0.0.1:8396/reload', revision },
    WebSocket: Socket,
    chrome,
    console: { info: vi.fn(), warn: vi.fn() },
    setInterval: (fn, delay) => intervals.push({ fn, delay }),
    clearInterval: vi.fn(),
    setTimeout: (fn, delay) => timeouts.push({ fn, delay }),
    clearTimeout: vi.fn(),
  };
  runInNewContext(client, context);
  // The first connection is scheduled for after the worker script evaluates.
  if (start) timeouts.shift().fn();
  return { ...context, sockets, intervals, timeouts, alarms, installed };
}

describe('Development worker hot reload', () => {
  it('acknowledges its build and keeps the worker alive without reloading unchanged or invalid messages', async () => {
    const state = worker();
    const socket = state.sockets[0];
    expect(socket.endpoint).toBe('ws://127.0.0.1:8396/reload');
    socket.open();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'ready', revision });
    expect(state.intervals[0].delay).toBe(20000);
    state.intervals[0].fn();
    expect(socket.send).toHaveBeenLastCalledWith('keepalive');
    socket.message({ type: 'built', revision });
    socket.message({ type: 'built', revision: 'invalid' });
    socket.message({ type: 'execute', revision: nextRevision });
    socket.message(null);
    socket.onmessage({ data: 'not JSON' });
    await tick();
    expect(state.chrome.runtime.reload).not.toHaveBeenCalled();
    expect(state.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  it('reloads the extension once, then refreshes LinkedIn tabs from the new worker', async () => {
    const storage = {};
    const oldWorker = worker(storage);
    await tick();
    oldWorker.sockets[0].message({ type: 'built', revision: nextRevision });
    oldWorker.sockets[0].message({ type: 'built', revision: nextRevision });
    await tick();
    expect(storage[pending]).toBe(nextRevision);
    expect(oldWorker.chrome.runtime.reload).toHaveBeenCalledTimes(1);
    expect(oldWorker.chrome.tabs.reload).not.toHaveBeenCalled();
    const newWorker = worker(storage);
    await tick();
    expect(newWorker.chrome.storage.local.remove).toHaveBeenCalledWith(pending);
    expect(newWorker.chrome.tabs.query).toHaveBeenCalledWith({ url: ['*://*.linkedin.com/*'] });
    expect(newWorker.chrome.tabs.reload).toHaveBeenCalledExactlyOnceWith(7);
    const laterWorker = worker(storage);
    await tick();
    expect(laterWorker.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  it('connects only after the worker script finishes evaluating', () => {
    const state = worker({}, { start: false });
    expect(state.sockets).toHaveLength(0);
    expect(state.timeouts).toHaveLength(1);
    expect(state.timeouts[0].delay).toBe(0);
    state.timeouts[0].fn();
    expect(state.sockets).toHaveLength(1);
  });

  it('keeps retrying with capped backoff and resets it after connecting', () => {
    const state = worker();
    const delays = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      state.sockets.at(-1).close();
      const retry = state.timeouts.shift();
      delays.push(retry.delay);
      retry.fn();
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    expect(state.sockets).toHaveLength(7);
    state.sockets.at(-1).open();
    state.sockets.at(-1).close();
    expect(state.timeouts.shift().delay).toBe(500);
  });

  it('asks for local network access once when connecting fails right after a reload', () => {
    const state = worker();
    expect(state.installed).toHaveLength(1);
    state.installed[0]({ reason: 'update' });
    state.sockets[0].close();
    expect(state.chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({
      url: `chrome-extension://${'a'.repeat(32)}/dev/dev-connect.html`,
    });
    state.timeouts.shift().fn();
    state.sockets[1].close();
    expect(state.chrome.tabs.create).toHaveBeenCalledTimes(1);

    const connected = worker();
    connected.installed[0]({ reason: 'update' });
    connected.sockets[0].open();
    connected.sockets[0].close();
    connected.timeouts.shift().fn();
    connected.sockets[1].close();
    expect(connected.chrome.tabs.create).not.toHaveBeenCalled();

    const started = worker();
    started.sockets[0].close();
    expect(started.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('reconnects after disconnects and worker suspension without duplicate sockets', () => {
    const state = worker();
    state.sockets[0].open();
    state.sockets[0].close();
    expect(state.clearInterval).toHaveBeenCalledTimes(1);
    expect(state.timeouts[0].delay).toBe(500);
    state.timeouts[0].fn();
    expect(state.sockets).toHaveLength(2);
    expect(state.chrome.alarms.create).toHaveBeenCalledWith('shield-dev-reconnect', { periodInMinutes: 0.5 });
    state.alarms[0]({ name: 'unrelated' });
    state.alarms[0]({ name: 'shield-dev-reconnect' });
    expect(state.sockets).toHaveLength(2);
    state.sockets[1].close();
    state.alarms[0]({ name: 'shield-dev-reconnect' });
    expect(state.sockets).toHaveLength(3);
  });

  it('recovers after a failed reload marker write', async () => {
    const state = worker();
    state.chrome.storage.local.set.mockRejectedValueOnce(new Error('storage unavailable'));
    state.sockets[0].message({ type: 'built', revision: nextRevision });
    await tick();
    expect(state.chrome.runtime.reload).not.toHaveBeenCalled();
    state.sockets[0].message({ type: 'built', revision: nextRevision });
    await tick();
    expect(state.chrome.runtime.reload).toHaveBeenCalledTimes(1);
  });
});
