/* global SHIELD_DEV */
/**
 * Development-only page script. Fetching the dev server from a page triggers the
 * browser's Local Network Access prompt, which the service worker cannot show.
 */
(() => {
  const status = document.getElementById('status');
  fetch(SHIELD_DEV.grant, { credentials: 'omit' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(() => {
      status.textContent = 'Granted. Dev reload is connected; closing this tab.';
      setTimeout(() => chrome.tabs.getCurrent((tab) => tab && chrome.tabs.remove(tab.id)), 1500);
    })
    .catch((error) => {
      status.textContent = `Not granted yet (${error.message}). Allow local network access for this extension in site settings, or check that npm run dev is running, then reload this page.`;
    });
})();
