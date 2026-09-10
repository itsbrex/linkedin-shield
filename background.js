/**
 * LinkedIn Shield — Background Service Worker
 * Tracks blocked probes, updates badge, handles AI analysis mode.
 */

// Per-tab stats never fall back to activity from a different page.
const tabStats = {};

// ── Early injection: inject content.js into MAIN world before page scripts ──
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (details.frameId !== 0) return;
  delete tabStats[details.tabId];
  chrome.action.setBadgeText({ text: '', tabId: details.tabId });
  try {
    const url = new URL(details.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com')) return;
    chrome.scripting
      .executeScript({
        target: { tabId: details.tabId },
        files: ['content.js'],
        world: 'MAIN',
        injectImmediately: true,
      })
      .catch(() => {}); // Ignore errors on restricted pages
  } catch (_e) {}
});

// Listen for stats from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'shield_stats' && sender.tab && (sender.frameId ?? 0) === 0) {
    const tabId = sender.tab.id;
    tabStats[tabId] = {
      probes: msg.probes || 0,
      fingerprints: msg.fingerprints || 0,
      trackers: msg.trackers || 0,
      total: msg.total || 0,
      url: sender.tab.url,
      timestamp: Date.now(),
      context: msg.context || null,
    };

    // Update badge and tooltip
    const total = msg.total || 0;
    chrome.action.setBadgeText({ text: total > 0 ? String(total) : '', tabId });
    chrome.action.setBadgeBackgroundColor({
      color: total > 50 ? '#ef4444' : total > 10 ? '#f59e0b' : '#22c55e',
      tabId,
    });
    chrome.action.setTitle({
      title: `LinkedIn Shield — ${total} blocked\n${msg.probes || 0} extension probes\n${msg.fingerprints || 0} fingerprint APIs spoofed\n${msg.trackers || 0} trackers blocked`,
      tabId,
    });
  }

  if (msg.type === 'get_stats') {
    const result = tabStats[msg.tabId];
    sendResponse(result || { probes: 0, fingerprints: 0, trackers: 0, total: 0 });
    return true;
  }
});

// Track blocked requests via declarativeNetRequest (only in dev mode with Feedback permission)
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  try {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      const tabId = info.request.tabId;
      if (tabId > 0) {
        if (!tabStats[tabId]) {
          tabStats[tabId] = { probes: 0, fingerprints: 0, trackers: 0, total: 0, timestamp: Date.now() };
        }
        tabStats[tabId].trackers++;
        tabStats[tabId].total++;
        const total = tabStats[tabId].total;
        chrome.action.setBadgeText({ text: total > 0 ? String(total) : '', tabId });
        chrome.action.setBadgeBackgroundColor({
          color: total > 50 ? '#ef4444' : total > 10 ? '#f59e0b' : '#22c55e',
          tabId,
        });
      }
    });
  } catch (_e) {
    /* Feedback permission not granted — debug listener unavailable */
  }
}

// Clean up tab stats when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStats[tabId];
});
