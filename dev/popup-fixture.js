/** Runs only in a generated dev fixture. Never reads real Chrome data. */
(() => {
  const scenario = new URL(window.location.href).searchParams.get('scenario');
  const stats =
    scenario === 'evidence'
      ? {
          probes: 3,
          fingerprints: 2,
          trackers: 1,
          context: {
            extensionIds: ['aaaeoelkococjpgngfokhbkkfiiegolp'],
            cookieNames: ['df_ts'],
            blockedUrls: ['https://www.linkedin.com/apfc/collect?private=synthetic-secret'],
          },
        }
      : null;
  const state = { ready: false, networkCalls: 0, error: null };
  window.shieldFixture = state;
  const fakeChrome = {
    tabs: {
      query: async () => [
        { id: 1, url: scenario === 'foreign' ? 'https://linkedin.com.example.com/' : 'https://www.linkedin.com/feed/' },
      ],
    },
    scripting: { executeScript: async () => [{ result: stats ? JSON.stringify(stats) : null }] },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {
          throw new Error('Fixture settings are read-only.');
        },
      },
    },
  };
  Object.defineProperty(window, 'chrome', { value: fakeChrome, configurable: true });
  window.fetch = async () => {
    state.networkCalls++;
    throw new Error('Network calls are forbidden in popup fixtures.');
  };
  window.setInterval = () => 0;
  async function script(path) {
    await new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = path;
      element.onload = resolve;
      element.onerror = () => reject(new Error('Fixture script failed to load.'));
      document.body.appendChild(element);
    });
  }
  document.addEventListener(
    'DOMContentLoaded',
    async () => {
      try {
        if (window.chrome !== fakeChrome) throw new Error('Chrome API isolation failed.');
        await script('../known-extensions.js');
        await script('../popup.js');
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        state.ready = true;
      } catch (error) {
        state.error = error.message;
      }
    },
    { once: true },
  );
})();
