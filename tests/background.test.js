/** Service-worker integration through registered Chrome event callbacks. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
let chrome, onMessage, onCommitted, onRemoved;
const getStats = (tabId) => {
  let result;
  onMessage({ type: 'get_stats', tabId }, {}, (value) => {
    result = value;
  });
  return result;
};
const sendStats = (tabId, total, frameId = 0) =>
  onMessage(
    { type: 'shield_stats', probes: total, total },
    { tab: { id: tabId, url: 'https://www.linkedin.com/feed/' }, frameId },
    () => {},
  );

beforeEach(() => {
  chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => {
          onMessage = fn;
        },
      },
    },
    webNavigation: {
      onCommitted: {
        addListener: (fn) => {
          onCommitted = fn;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (fn) => {
          onRemoved = fn;
        },
      },
    },
    scripting: { executeScript: vi.fn(async () => []) },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
  };
  runInNewContext(source, { chrome, URL });
});

describe('Background tab isolation', () => {
  it('never substitutes another tab when a tab has zero or missing stats', () => {
    sendStats(1, 0);
    sendStats(2, 99);
    expect(getStats(1).total).toBe(0);
    expect(getStats(3).total).toBe(0);
    expect(getStats(2).total).toBe(99);
  });

  it('clears stale stats on navigation and tab close', () => {
    sendStats(1, 99);
    onCommitted({ tabId: 1, frameId: 0, url: 'https://www.linkedin.com/feed/' });
    expect(getStats(1).total).toBe(0);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '', tabId: 1 });
    sendStats(1, 12);
    onRemoved(1);
    expect(getStats(1).total).toBe(0);
  });

  it('injects only into actual LinkedIn hosts and ignores child-frame stats', () => {
    onCommitted({ tabId: 1, frameId: 0, url: 'https://linkedin.com.example.com/' });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    onCommitted({ tabId: 1, frameId: 0, url: 'https://www.linkedin.com/' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    sendStats(1, 12);
    sendStats(1, 99, 1);
    expect(getStats(1).total).toBe(12);
  });
});

describe('Background badge and message behavior', () => {
  it.each([
    [0, '#22c55e'],
    [5, '#22c55e'],
    [10, '#22c55e'],
    [11, '#f59e0b'],
    [50, '#f59e0b'],
    [51, '#ef4444'],
    [100, '#ef4444'],
  ])('renders the badge for %i', (total, color) => {
    sendStats(1, total);
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color, tabId: 1 });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: total ? String(total) : '', tabId: 1 });
  });

  it('preserves all reported fields and context for the requested tab', () => {
    onMessage(
      {
        type: 'shield_stats',
        probes: 10,
        fingerprints: 3,
        trackers: 2,
        total: 15,
        context: { cookieNames: ['df_ts'] },
      },
      { tab: { id: 5, url: 'https://www.linkedin.com/' }, frameId: 0 },
      () => {},
    );
    expect(getStats(5)).toMatchObject({
      probes: 10,
      fingerprints: 3,
      trackers: 2,
      total: 15,
      context: { cookieNames: ['df_ts'] },
    });
  });

  it('defaults missing stats to zero and ignores messages without a tab', () => {
    onMessage({ type: 'shield_stats' }, { tab: { id: 1 } }, () => {});
    expect(getStats(1)).toMatchObject({ probes: 0, fingerprints: 0, trackers: 0, total: 0 });
    chrome.action.setBadgeText.mockClear();
    onMessage({ type: 'shield_stats', total: 100 }, {}, () => {});
    const response = vi.fn();
    onMessage({ type: 'unknown' }, { tab: { id: 1 } }, response);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    expect(response).not.toHaveBeenCalled();
  });
});
