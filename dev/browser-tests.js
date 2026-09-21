import { networkCases, browserCheckIds } from './network-cases.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const status = document.getElementById('status');
const button = document.getElementById('run');
const results = document.getElementById('results');
const preview = document.getElementById('preview');

async function popup(scenario) {
  const frame = document.createElement('iframe');
  frame.title = `Synthetic popup: ${scenario}`;
  frame.src = `popup-fixture.html?scenario=${scenario}`;
  preview.appendChild(frame);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = frame.contentWindow.shieldFixture;
    if (state?.error) throw new Error(state.error);
    if (state?.ready) return frame;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Popup fixture did not become ready.');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  results.replaceChildren();
  preview.replaceChildren();
  status.textContent = 'Running…';
  const report = [];
  const check = async (id, run) => {
    const row = document.createElement('li');
    try {
      await run();
      report.push({ id, passed: true });
      row.textContent = `PASS ${id}`;
    } catch (error) {
      report.push({ id, passed: false });
      row.textContent = `FAIL ${id}: ${error.message}`;
    }
    results.appendChild(row);
  };
  try {
    await navigator.locks.request('shield-browser-regression', async () => {
      const rules = await (await fetch('../rules.json')).json();
      const blockers = new Set(rules.filter((rule) => rule.action.type === 'block').map((rule) => rule.id));
      for (const test of networkCases)
        await check(test.id, async () => {
          const result = await chrome.declarativeNetRequest.testMatchOutcome({
            url: test.url,
            initiator: test.initiator || 'https://www.linkedin.com/',
            type: test.type || 'xmlhttprequest',
          });
          const matched = result.matchedRules
            .filter((rule) => rule.rulesetId === 'linkedin_blocklist')
            .map((rule) => rule.ruleId);
          if (test.rule) assert(matched.includes(test.rule), `Expected rule ${test.rule}.`);
          if (test.block === false)
            assert(!matched.some((id) => blockers.has(id)), 'Ordinary request would be blocked.');
          if (test.header !== undefined) assert(matched.includes(12) === test.header, 'Header rule scope differs.');
        });
      const response = await fetch('http://127.0.0.1:8397/session', { credentials: 'omit' });
      assert(response.ok, 'Start npm run test:browser first.');
      const { base } = await response.json();
      assert(/^http:\/\/127\.0\.0\.1:8397\/run\/[a-f0-9]{32}$/.test(base), 'Invalid fixture server address.');
      const request = (path) =>
        fetch(`${base}/${path}`, {
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'X-Li-Apfc-Data': 'synthetic-apfc', 'X-Shield-Control': 'synthetic-control' },
        });
      const existing = new Set((await chrome.declarativeNetRequest.getSessionRules()).map((rule) => rule.id));
      const ids = [900001, 900002];
      assert(
        ids.every((id) => !existing.has(id)),
        'Test rule IDs already in use; no rules were changed.',
      );
      const path = new URL(base).pathname;
      const condition = (suffix) => ({
        regexFilter: `^http://127\\.0\\.0\\.1:8397${path}/${suffix}$`,
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ['xmlhttprequest'],
      });
      const clean = () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
      const onClose = () => {
        clean().catch(() => {});
      };
      window.addEventListener('pagehide', onClose, { once: true });
      try {
        await check('wire-control', async () => {
          const value = await (await request('control')).json();
          assert(value.apfc && value.control, 'Control headers did not reach fixture server.');
        });
        await chrome.declarativeNetRequest.updateSessionRules({
          addRules: [
            {
              id: ids[0],
              priority: 1,
              action: rules.find((rule) => rule.id === 9).action,
              condition: condition('blocked'),
            },
            {
              id: ids[1],
              priority: 1,
              action: rules.find((rule) => rule.id === 12).action,
              condition: condition('headers'),
            },
          ],
        });
        await check('wire-block', async () => {
          let rejected = false;
          try {
            await request('blocked');
          } catch {
            rejected = true;
          }
          const state = await (await fetch(`${base}/state`, { credentials: 'omit' })).json();
          assert(
            rejected && !state.hits.some((hit) => hit.path === '/blocked'),
            'Blocked request reached server or resolved.',
          );
        });
        await check('wire-header-removal', async () => {
          const value = await (await request('headers')).json();
          assert(!value.apfc && value.control, 'APFC header was not removed or control header was lost.');
        });
      } finally {
        await clean();
        window.removeEventListener('pagehide', onClose);
      }
      await check('wire-cleanup', async () => {
        assert(
          !(await chrome.declarativeNetRequest.getSessionRules()).some((rule) => ids.includes(rule.id)),
          'Temporary rules remain.',
        );
      });
      let empty, evidence, foreign;
      await check('popup-waiting', async () => {
        empty = await popup('empty');
        assert(empty.contentDocument.getElementById('total-count').textContent === '0', 'Waiting count is not zero.');
        assert(
          empty.contentDocument.getElementById('shield-status').textContent.includes('Waiting'),
          'Waiting state missing.',
        );
      });
      await check('popup-evidence', async () => {
        evidence = await popup('evidence');
        const doc = evidence.contentDocument;
        assert(doc.getElementById('total-count').textContent === '6', 'Counts differ from fixture.');
        assert(doc.getElementById('context-details').textContent.includes('df_ts'), 'Cookie name missing.');
        assert(!doc.body.textContent.includes('synthetic-secret'), 'Query value leaked.');
        assert(evidence.contentWindow.shieldFixture.networkCalls === 0, 'Popup made an unsolicited request.');
      });
      await check('popup-layout', async () => {
        assert(
          evidence.contentDocument.documentElement.scrollWidth <= evidence.clientWidth,
          'Popup overflows at 400px.',
        );
      });
      await check('popup-disclosure', async () => {
        const details = evidence.contentDocument.getElementById('cookie-evidence');
        const summary = details.querySelector('summary');
        summary.focus();
        summary.click();
        assert(
          details.open && evidence.contentDocument.activeElement === summary,
          'Disclosure is not focusable and operable.',
        );
      });
      await check('popup-no-key', async () => {
        const doc = evidence.contentDocument;
        doc.getElementById('ai-analyze-btn').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert(
          doc.getElementById('ai-result').textContent.includes('No API key configured'),
          'Missing-key guidance absent.',
        );
        assert(evidence.contentWindow.shieldFixture.networkCalls === 0, 'Missing-key click sent a request.');
      });
      await check('popup-host-boundary', async () => {
        foreign = await popup('foreign');
        assert(
          foreign.contentWindow.getComputedStyle(foreign.contentDocument.getElementById('no-linkedin')).display !==
            'none',
          'Lookalike host accepted.',
        );
      });
      const submitted = await fetch(`${base}/report`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tests: report }),
      });
      assert(submitted.ok, 'Fixture server rejected the report.');
    });
    status.textContent = `${report.filter((test) => test.passed).length}/${browserCheckIds.length} checks passed.`;
  } catch (error) {
    status.textContent = `Incomplete: ${error.message} No full browser pass is claimed.`;
  } finally {
    button.disabled = false;
  }
});
