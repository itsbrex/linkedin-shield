/**
 * LinkedIn Shield — Content Script (MAIN world)
 *
 * Combined approach:
 * - Proxy on window.fetch for live probe counting (worked in v2.4)
 * - Fingerprint spoofing
 * - DOM attribute for popup to read
 * - Periodic stats updates
 */

(function () {
  'use strict';

  const SHIELD_KEY = Symbol.for('__linkedinShieldActive');
  if (window[SHIELD_KEY]) return;
  Object.defineProperty(window, SHIELD_KEY, { value: true, writable: false, configurable: false });

  // ── 0. Suppress LinkedIn's noisy console spam ───────────────────────
  const nativeWarn = console.warn;
  const nativeError = console.error;
  const linkedInNoise =
    /BooleanExpression with operator|Attribute .* could not be converted to a proto|Minified React error|VIDEOJS: WARN|Highcharts warning|^network error$/i;
  function isLinkedInNoise(args) {
    const first = args[0];
    if (typeof first === 'string' && linkedInNoise.test(first)) return true;
    if (first instanceof Error && linkedInNoise.test(first.message)) return true;
    // Check if error originates from LinkedIn's bundled scripts
    if (first instanceof Error && first.stack && /licdn\.com|aero-v1/.test(first.stack)) return true;
    return false;
  }
  console.warn = function (...args) {
    if (isLinkedInNoise(args)) return;
    return nativeWarn.apply(console, args);
  };
  console.error = function (...args) {
    if (isLinkedInNoise(args)) return;
    return nativeError.apply(console, args);
  };

  let probeCount = 0;
  let trackerRequests = 0;
  let iframesRemoved = 0;
  const probedExtensions = new Set();
  const blockedUrls = new Set();
  const cookieNames = new Set();
  const watchedCookies = new Set(['df_ts', 'li_apfcdc', '_px3', '_pxhd', '_pxvid', 'pxcts']);

  function parseUrl(input) {
    try {
      return new URL(
        typeof input === 'string' ? input : (input?.url ?? input?.href ?? String(input)),
        document.baseURI,
      );
    } catch (_e) {
      return null;
    }
  }

  function isExtensionUrl(url) {
    return url?.protocol === 'chrome-extension:' || url?.protocol === 'moz-extension:';
  }

  function isDomain(host, domain) {
    return host === domain || host.endsWith('.' + domain);
  }

  function isTrackerUrl(url) {
    if (!url || !['http:', 'https:'].includes(url.protocol)) return false;
    if (isDomain(url.hostname, 'protechts.net')) return true;
    if (url.hostname === 'merchantpool1.linkedin.com' && url.pathname === '/mdt.js') return true;
    return (
      isDomain(url.hostname, 'linkedin.com') &&
      /^\/(?:platform-telemetry\/li\/apfcDf|apfc\/collect|li\/track|(?:li\/)?sensorCollect|spectroscopy|browser-id|fingerprintjs)(?:\/|$)/i.test(
        url.pathname,
      )
    );
  }

  function shouldBlock(input) {
    const url = parseUrl(input);
    if (isExtensionUrl(url)) {
      probeCount++;
      const validId =
        url.protocol === 'chrome-extension:' ? /^[a-p]{32}$/.test(url.hostname) : /^[a-f0-9-]{36}$/i.test(url.hostname);
      if (validId && probedExtensions.size < 50) probedExtensions.add(url.hostname);
      return true;
    }
    if (isTrackerUrl(url)) {
      trackerRequests++;
      // Store endpoint identity only, never query values, fragments, or credentials.
      if (blockedUrls.size < 10) blockedUrls.add(url.origin + url.pathname);
      return true;
    }
    return false;
  }

  // A fulfilled 404 is an installed-extension signal to the captured scanner.
  // Match fetch's network-failure contract instead, including URL and Request input.
  const nativeFetch = window.fetch;
  const fetchProxy = new Proxy(nativeFetch, {
    apply(target, thisArg, args) {
      if (shouldBlock(args[0])) return Promise.reject(new TypeError('Failed to fetch'));
      return Reflect.apply(target, thisArg, args);
    },
  });
  Object.defineProperty(window, 'fetch', { value: fetchProxy, writable: true, configurable: true });

  // Do not leave a reused XHR pointing at its previous URL when a new open is blocked.
  const nativeXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (shouldBlock(url)) {
      this.abort();
      throw new window.DOMException('Blocked by LinkedIn Shield', 'NetworkError');
    }
    return nativeXHROpen.call(this, method, url, ...rest);
  };

  if (typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      if (shouldBlock(url)) return false;
      return nativeBeacon.call(this, url, data);
    };
  }

  // Hide extension resource timing without counting observed entries as blocked requests.
  for (const method of ['getEntries', 'getEntriesByType', 'getEntriesByName']) {
    const nativeMethod = performance[method];
    if (typeof nativeMethod !== 'function') continue;
    try {
      performance[method] = function (...args) {
        return nativeMethod.apply(this, args).filter((entry) => !isExtensionUrl(parseUrl(entry.name)));
      };
    } catch (_e) {}
  }

  // Observe known cookie names only. Forward native access unchanged: df_ts limits
  // collection frequency, and deleting it could trigger additional fingerprinting.
  function observeCookieName(value) {
    const name = value.split('=', 1)[0].trim();
    if (watchedCookies.has(name)) cookieNames.add(name);
  }
  function observeCookies() {
    try {
      for (const cookie of document.cookie.split(';')) observeCookieName(cookie);
    } catch (_e) {}
  }
  observeCookies();
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window.Document.prototype, 'cookie');
    if (descriptor?.get && descriptor?.set) {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          const text = String(value);
          descriptor.set.call(this, text);
          observeCookieName(text);
        },
      });
    }
  } catch (_e) {}

  // ── 3. Fingerprint spoofing ─────────────────────────────────────────
  let fingerprintCount = 0;
  const spoofedApis = [];
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    fingerprintCount++;
    spoofedApis.push('navigator.hardwareConcurrency');
  } catch (_e) {}
  try {
    if ('deviceMemory' in navigator) {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      fingerprintCount++;
      spoofedApis.push('navigator.deviceMemory');
    }
  } catch (_e) {}
  try {
    if ('getBattery' in navigator) {
      navigator.getBattery = () =>
        Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1.0,
          addEventListener: () => {},
        });
      fingerprintCount++;
      spoofedApis.push('navigator.getBattery()');
    }
  } catch (_e) {}

  // Remove existing iframes, nested insertions, and later src changes.
  // DNR is the pre-request barrier; MutationObserver is DOM cleanup, not proof
  // that the browser never attempted a network request.
  function removeTrackerFrames(root) {
    const frames = root.tagName === 'IFRAME' ? [root] : root.querySelectorAll?.('iframe') || [];
    for (const frame of frames) {
      const url = parseUrl(frame.src);
      if (
        frame.isConnected &&
        url &&
        ['http:', 'https:'].includes(url.protocol) &&
        isDomain(url.hostname, 'protechts.net')
      ) {
        frame.remove();
        iframesRemoved++;
      }
    }
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') removeTrackerFrames(mutation.target);
      for (const node of mutation.addedNodes) removeTrackerFrames(node);
    }
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  removeTrackerFrames(document);

  // ── 5. Write stats to DOM + postMessage every 3s ────────────────────
  function writeStats() {
    if (window !== window.top || !document.documentElement) return;
    observeCookies();
    const trackerCount = trackerRequests + iframesRemoved;
    const data = {
      probes: probeCount,
      fingerprints: fingerprintCount,
      trackers: trackerCount,
      total: probeCount + fingerprintCount + trackerCount,
      context: {
        extensionIds: [...probedExtensions],
        blockedUrls: [...blockedUrls],
        cookieNames: [...cookieNames],
        fingerprintApis: spoofedApis,
        iframesRemoved: iframesRemoved,
        detectionMethod: probeCount > 0 ? 'live' : 'passive',
      },
    };
    document.documentElement.setAttribute('data-linkedin-shield', JSON.stringify(data));
    window.postMessage({ type: 'linkedin_shield_stats', ...data }, window.location.origin);
  }

  writeStats();
  setInterval(writeStats, 3000);
  setTimeout(writeStats, 2000);
  setTimeout(writeStats, 5000);
})();
