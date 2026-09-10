/* global KNOWN_EXTENSIONS */
/**
 * LinkedIn Shield — Popup Script v3.0
 * Reads stats directly from page DOM via chrome.scripting
 */

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let isLinkedIn = false;
  try {
    const url = new URL(tab?.url);
    isLinkedIn =
      ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'));
  } catch (_e) {}

  if (!isLinkedIn) {
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('no-linkedin').style.display = 'block';
    return;
  }

  document.getElementById('page-url').textContent = new URL(tab.url).hostname;

  // Page stats are advisory. Never fabricate activity while waiting for a report.
  async function readStats() {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.getAttribute('data-linkedin-shield'),
      });
      const raw = results?.[0]?.result;
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_e) {
      return null;
    }
  }

  function count(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  function strings(value, limit) {
    return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string'))].slice(0, limit) : [];
  }
  function addContextRow(parent, color, boldText, suffix) {
    const row = document.createElement('div');
    row.style.marginBottom = '6px';
    const dot = document.createElement('span');
    dot.style.color = color;
    dot.textContent = '\u25A0 ';
    const strong = document.createElement('strong');
    strong.textContent = boldText;
    row.appendChild(dot);
    row.appendChild(strong);
    if (suffix) row.appendChild(document.createTextNode(suffix));
    parent.appendChild(row);
    return row;
  }

  const details = document.getElementById('context-details');
  function addEvidence(id, title, rows, wasOpen) {
    if (!rows.length) return;
    const disclosure = document.createElement('details');
    disclosure.id = id;
    disclosure.open = wasOpen;
    const summary = document.createElement('summary');
    summary.textContent = `${title} (${rows.length})`;
    disclosure.appendChild(summary);
    const list = document.createElement('ul');
    list.className = 'evidence-list';
    for (const text of rows) {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    }
    disclosure.appendChild(list);
    details.appendChild(disclosure);
  }

  function renderStats(raw) {
    const stats = {
      probes: count(raw?.probes),
      fingerprints: count(raw?.fingerprints),
      trackers: count(raw?.trackers),
    };
    stats.total = stats.probes + stats.fingerprints + stats.trackers;
    for (const key of ['probes', 'fingerprints', 'trackers', 'total']) {
      document.getElementById(`${key}-count`).textContent = stats[key];
    }
    document.getElementById('shield-status').textContent = raw ? 'Shield active' : 'Waiting for page stats';
    document.getElementById('context-section').style.display = 'block';
    const open = new Set([...details.querySelectorAll('details[open]')].map((item) => item.id));
    details.textContent = '';
    addContextRow(details, '#ef4444', `${stats.probes} extension probes blocked`);
    addContextRow(details, '#f59e0b', `${stats.fingerprints} fingerprint APIs protected`);
    addContextRow(details, '#6366f1', `${stats.trackers} tracker requests / frames blocked`);

    const context = raw?.context;
    const targets = strings(context?.extensionIds, 50)
      .filter((id) => /^[a-p]{32}$/.test(id) || /^[a-f0-9-]{36}$/i.test(id))
      .map((id) => {
        const extension = KNOWN_EXTENSIONS[id];
        return extension
          ? `${extension.name} — ${id}${extension.file ? ` — captured resource: ${extension.file}` : ''}`
          : `Unidentified extension — ${id}`;
      });
    addEvidence('extension-evidence', 'Probe targets', targets, open.has('extension-evidence'));
    if (targets.length) addContextRow(details, '#8886a0', 'Targets are not proof of installation.');

    const cookies = strings(context?.cookieNames, 6).filter((name) =>
      ['df_ts', 'li_apfcdc', '_px3', '_pxhd', '_pxvid', 'pxcts'].includes(name),
    );
    addEvidence('cookie-evidence', 'Observed cookie names', cookies, open.has('cookie-evidence'));
    if (cookies.length) addContextRow(details, '#8886a0', 'Cookie values stay private; cookies remain unchanged.');

    const endpoints = [];
    for (const value of strings(context?.blockedUrls, 10)) {
      try {
        const url = new URL(value);
        if (['http:', 'https:'].includes(url.protocol) && /(^|\.)(linkedin\.com|protechts\.net)$/.test(url.hostname)) {
          endpoints.push(url.origin + url.pathname);
        }
      } catch (_e) {}
    }
    addEvidence('endpoint-evidence', 'Blocked endpoints', endpoints, open.has('endpoint-evidence'));
    window._shieldStats = stats;
  }

  renderStats(await readStats());
  const pollInterval = setInterval(async () => renderStats(await readStats()), 3000);

  // AI button
  document.getElementById('ai-analyze-btn').addEventListener('click', async () => {
    const btn = document.getElementById('ai-analyze-btn');
    const result = document.getElementById('ai-result');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    result.style.display = 'block';
    result.textContent = 'Connecting to AI...';

    // Check if API key is configured
    const settings = await chrome.storage.local.get(['ai_api_key', 'ai_provider']);
    if (!settings.ai_api_key) {
      result.textContent = 'No API key configured. Click "Settings" below to add one.';
      btn.disabled = false;
      btn.textContent = 'Explain with AI';
      return;
    }

    try {
      result.textContent = `Calling ${settings.ai_provider || 'anthropic'} API...`;

      // Call AI directly from popup instead of background (avoids message passing issues)
      const provider = settings.ai_provider || 'anthropic';
      const apiKey = settings.ai_api_key;
      const s = window._shieldStats || {};

      const prompt = `LinkedIn Shield reports ${s.probes || 0} blocked extension probes, ${s.fingerprints || 0} active fingerprint API shields, and ${s.trackers || 0} blocked tracker requests or frames. Explain these counts and their privacy implications in 3-4 sentences. Active API shields do not prove collection attempts; probe targets do not prove installed extensions. These advisory page counts exclude static network-rule matches and child-frame activity. Do not infer activity from zero counts.`;

      let text = '';

      if (provider === 'anthropic') {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 250,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const data = await resp.json();
        text = data.content?.[0]?.text || data.error?.message || JSON.stringify(data).substring(0, 200);
      } else {
        const apiBase = (await chrome.storage.local.get('ai_api_base')).ai_api_base || 'https://api.openai.com/v1';
        const model = (await chrome.storage.local.get('ai_model')).ai_model || 'gpt-4o-mini';
        const resp = await fetch(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            max_tokens: 250,
            messages: [
              { role: 'system', content: 'You are a privacy analyst. Be direct.' },
              { role: 'user', content: prompt },
            ],
          }),
        });
        const data = await resp.json();
        text = data.choices?.[0]?.message?.content || data.error?.message || JSON.stringify(data).substring(0, 200);
      }

      result.textContent = text;
    } catch (e) {
      result.textContent = 'Error: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = 'Explain with AI';
  });

  // Share button
  document.getElementById('share-btn').addEventListener('click', () => {
    const s = window._shieldStats || {};
    const probeText = `${s.probes || 0} extension probes blocked`;
    let text = `LinkedIn Shield activity and protection on my last visit:\n\n`;
    text += `🔍 ${probeText}\n`;
    text += `🖥️ ${s.fingerprints || 0} device fingerprint APIs protected\n`;
    text += `🛡️ ${s.trackers || 0} tracker requests / frames blocked\n`;
    text += `\nLinkedIn checks for: job search tools, ad blockers, password managers, VPNs, accessibility aids, developer tools\n`;
    text += `\nOpen-source: github.com/Quality-Max/linkedin-shield`;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('share-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = 'Share Results';
      }, 2000);
    });
  });

  // Settings
  document.getElementById('settings-toggle').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  const saved = await chrome.storage.local.get(['ai_api_key', 'ai_provider']);
  if (saved.ai_api_key) document.getElementById('ai-key').value = '••••••••' + saved.ai_api_key.slice(-4);
  if (saved.ai_provider) document.getElementById('ai-provider').value = saved.ai_provider;

  document.getElementById('save-settings').addEventListener('click', async () => {
    const key = document.getElementById('ai-key').value;
    const provider = document.getElementById('ai-provider').value;
    const toSave = { ai_provider: provider };
    if (key && !key.startsWith('••')) {
      toSave.ai_api_key = key;
      if (provider === 'qwen') {
        toSave.ai_api_base = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
        toSave.ai_model = 'qwen3.5-flash';
      }
    }
    await chrome.storage.local.set(toSave);
    document.getElementById('settings-msg').textContent = 'Saved!';
    setTimeout(() => {
      document.getElementById('settings-msg').textContent = '';
    }, 2000);
  });

  // Clean up polling when popup closes
  window.addEventListener('unload', () => clearInterval(pollInterval));
});
