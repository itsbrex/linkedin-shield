/* global SHIELD_DEV, WebSocket */
/** Development-only worker client. Messages contain build hashes, never code. */
(() => {
  const ALARM = 'shield-dev-reconnect';
  const PENDING = 'shieldDevReloadPending';
  const MATCHES = ['*://*.linkedin.com/*'];
  let socket;
  let retry;
  let reloading = false;
  let delay = 500;
  let installed = false;
  let helped = false;

  async function reloadExtension(revision) {
    if (reloading) return;
    reloading = true;
    // A storage marker survives runtime.reload. Refresh pages from the new worker
    // so document_start scripts come from the completed new build.
    await chrome.storage.local.set({ [PENDING]: revision });
    chrome.runtime.reload();
  }

  async function refreshPagesAfterReload() {
    const state = await chrome.storage.local.get(PENDING);
    if (!state[PENDING]) return;
    await chrome.storage.local.remove(PENDING);
    const tabs = await chrome.tabs.query({ url: MATCHES });
    await Promise.allSettled(tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => chrome.tabs.reload(tab.id)));
  }

  function connect() {
    if (reloading || (socket && socket.readyState < WebSocket.CLOSING)) return;
    clearTimeout(retry);
    socket = new WebSocket(SHIELD_DEV.endpoint);
    const connection = socket;
    let heartbeat;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      helped = true; // connected, so local network access is not what's failing
      delay = 500;
      connection.send(JSON.stringify({ type: 'ready', revision: SHIELD_DEV.revision }));
      heartbeat = setInterval(() => {
        if (connection.readyState === WebSocket.OPEN) connection.send('keepalive');
      }, 20000);
      console.info('[Shield DEV] hot reload connected');
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      if (
        message?.type === 'built' &&
        /^[a-f0-9]{64}$/.test(message.revision) &&
        message.revision !== SHIELD_DEV.revision
      ) {
        reloadExtension(message.revision).catch((error) => {
          reloading = false;
          console.warn('[Shield DEV] reload failed:', error.message);
        });
      }
    };
    socket.onerror = () => connection.close();
    socket.onclose = () => {
      clearInterval(heartbeat);
      if (socket === connection) socket = null;
      // Just installed or reloaded and still can't connect: the browser may be
      // blocking the worker's local network access (workers cannot show that
      // prompt). dev/dev-connect.html asks from a page; it closes itself on success.
      if (!opened && installed && !helped) {
        helped = true;
        chrome.tabs.create({ url: chrome.runtime.getURL('dev/dev-connect.html') });
      }
      // Keep trying while the worker lives (capped backoff).
      if (!reloading) {
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 5000);
      }
    };
  }

  // Registering onInstalled also makes Chrome start the worker right after each
  // runtime.reload() (MV3 starts workers only for events they listen to).
  chrome.runtime.onInstalled.addListener(() => {
    installed = true;
  });
  // Timers alone cannot wake a suspended MV3 worker after the server restarts.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) connect();
  });
  chrome.runtime.onStartup.addListener(connect);
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }).catch(() => {});
  refreshPagesAfterReload().catch((error) => console.warn('[Shield DEV] page refresh failed:', error.message));
  // Connect after the worker script finishes evaluating.
  setTimeout(connect, 0);
})();
