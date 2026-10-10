# Surveillance findings and contribution record

## Scope and evidence

Static analysis of the user-supplied `4j642gxwgan928vnbx21s18k0.js`, inspected on
2026-09-10. The bundle was parsed as data, never executed. Its presence is evidence
of available code paths, not proof that every path runs on every LinkedIn visit.

- Size: 2,669,775 bytes; 13,240 lines.
- SHA-256: `f5bb9da5de585dd9d0f412636e273fbcc0135265c3ad9de0b90043dec73b61c0`.
- The `const o` array starts on line 9536, byte range `[1745281, 2070363)`.
- It contains **4,934** entries, each with one `id` and one `file`; no duplicate
  IDs. Every captured ID matches Chrome's 32-character `[a-p]` alphabet.
- Sorted `[id, file]` pairs, encoded with compact JSON, have SHA-256
  `2b1825e71d31f243283623d96e7d7ac04a281bd91fe8ff01bace34c6de50820b`.
- Extraction walked quoted strings before finding the closing array bracket,
  quoted only the `id`/`file` keys, then used JSON parsing. A naive first-`]`
  search truncates `assets/fonts/vazir/Vazirmatn[wght].woff2`.
- The source contains no extension names or categories. New records therefore
  remain **Unidentified extension / Unclassified**. Existing research labels
  remain separate from captured file evidence. An old 33-character Google Docs
  Offline ID was removed as invalid, without guessing a replacement.

The baseline README's 6,236 figure came from its linked historical investigation;
the README now identifies this supplied sample's count. Catalog membership does not prove
installation, nor does a blocked probe prove that a targeted extension exists.

## Repository map

| Area                                  | Responsibility                                                  | Baseline observation                                                        |
| ------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `manifest.json`, `rules.json`         | Manifest V3 permissions and declarative blocking                | No build step; static rules run independently of page hooks                 |
| `content.js`                          | MAIN-world fetch/XHR hooks, fingerprints, iframe removal, stats | Top frame only; synthetic 404 probes incorrectly fulfill detection promises |
| `bridge.js`                           | ISOLATED-world relay to extension runtime                       | Page-provided statistics are advisory, not trusted attestation              |
| `background.js`                       | Early injection, per-tab badges, optional DNR debug counts      | Debug events need feedback permission; fallback can mix tabs                |
| `popup.html`, `popup.js`              | Live stats, explicit AI analysis, local settings                | AI calls originate in popup; some fallbacks invent nonzero counts           |
| `known-extensions.js`                 | Local ID/name/category/resource reference                       | Previously 34 hand-labeled entries; loaded by popup HTML but unused by UI   |
| `tests/`, ESLint, Prettier, Husky, CI | npm-based validation                                            | Several tests duplicate implementation instead of loading runtime files     |

No `CONTRIBUTING.md` existed at baseline. Existing conventions: ESM JavaScript,
two-space indentation, single quotes, semicolons, trailing commas, 120-column
Prettier formatting, ESLint recommended rules, Vitest, lockfile installs, and
pre-commit lint-staged plus full tests. CI targets pull requests to `master`.

## Development baseline

- Branch: `codex/surveillance-detection`, based on `a16693b`.
- Local Node `24.19.0`, npm `11.17.0`; `npm ci` completed.
- Baseline: 7 test files / 102 tests passed. Tracked-file formatting passed.
- Existing uncommitted plan viewer files and `package.json`'s `plans` script were
  preserved. Whole-tree lint found five errors in that untracked script;
  whole-tree format also found pre-existing plan/agent-file differences.
- No runtime dependencies, bundler, or production credentials are required.

## Logical commit checklist

- [x] Import exact extension ID/file evidence and validate the full captured set.
- [x] Expand protections for confirmed probe and surveillance paths.
- [x] Make live reporting useful and truthful, including cookie-name detection.
- [x] Document contributor setup and provide repeatable checks.

## Detection contract

The sample's parallel probe path treats any fulfilled fetch as a hit; its serial
path also treats any response object as a hit. HTTP status is never checked.
Returning a synthetic 404 therefore reports a false positive to the scanner.
Blocked extension fetches must reject like an inaccessible extension resource.
Regression coverage must reproduce both serial and `Promise.allSettled` callers.

## Additional captured signals

Line references below refer to the original supplied bundle, not the generated catalog.

| Evidence                                                                                             | Location                 | Interpretation and treatment                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/platform-telemetry/li/apfcDf`, `/apfc/collect`                                                     | 9473–9475                | Encrypted fingerprint upload and combined payload collection; block exact path families on LinkedIn                                                        |
| `https://merchantpool1.linkedin.com/mdt.js`                                                          | 9496–9498                | Device-fingerprint script initialized with browser-cookie-derived session ID; block this loader                                                            |
| `/li/track`, `AedEvent`, `SpectroscopyEvent`                                                         | 1982, 9539–9553          | General event transport; extension enumeration and DOM-discovered extension IDs use tracking events; block transport, accepting loss of ordinary analytics |
| `X-Li-Apfc-Data`                                                                                     | 9471–9472                | Alternate fingerprint header on ordinary requests; remove only this header on LinkedIn XHR/fetch, preserve request and authentication headers              |
| `li.protechts.net/index.html`, `index_stg.html`                                                      | 9501–9518                | Invisible HUMAN frames with browser hash, request ID, timestamp, and app ID; DNR blocks network, observer cleans DOM                                       |
| `df_ts`                                                                                              | 9490–9493                | Sampling timestamp; observe name only, never delete or rewrite                                                                                             |
| `li_apfcdc`                                                                                          | 9526–9532                | Base64 collection context with tracking/member/session identifiers; observe name only, never decode or persist value                                       |
| `_px3`, `_pxhd`, `_pxvid`, `pxcts`                                                                   | 9515–9518                | HUMAN cookies relayed through `getHSCookiesResponse` and `cookie` messages; observe names only                                                             |
| `bcookie`, `JSESSIONID`                                                                              | 2328, 123                | Browser identity and CSRF/session context; preserve these cookies and authentication                                                                       |
| `DNA_ENCRYPTED`, `DFP_JS_PLAINTEXT`, `HUMAN_JS_PLAINTEXT`, reCAPTCHA payload labels                  | 9472                     | Payload aggregation includes multiple collectors; header removal closes one alternate route                                                                |
| Canvas, WebGL, fonts, audio, media devices, screen, storage availability, timezone, network, battery | 2216 onward, 9570 onward | Broad fingerprint surface; retain existing CPU/RAM/battery shields, document remaining surface rather than spoof everything                                |
| DOM traversal of text and element attributes for `chrome-extension://`                               | 9547–9553                | Passive extension discovery remains possible; do not hide arbitrary DOM content and break the site                                                         |

Storage references in the fingerprint component check storage API availability;
they do not prove collection of every stored key/value. reCAPTCHA Enterprise and
challenge/login paths remain intact. Blocking privacy-related APFC requests or
headers may still affect LinkedIn risk checks; authenticated smoke testing remains
necessary before release.

## Protection and measurement boundaries

- `fetch` rejects blocked probes and tracker requests; `sendBeacon` returns false.
  Blocked `XMLHttpRequest.open` aborts any previous request and throws `NetworkError`
  before native open, preventing accidental reuse of a prior URL.
- Timing lookups hide extension-resource entries without claiming that an observed
  request was blocked. A page retaining original APIs or using workers can bypass
  MAIN-world hooks; DNR still covers the explicitly listed HTTP endpoints.
- Shields run in matching child frames. Only the top frame publishes stats; child
  frame activity and static DNR matches are not included in popup totals.
- Cookie observations are distinct from blocked requests. Native reads/writes are
  forwarded unchanged; only six allowlisted names enter stats. HttpOnly cookies,
  pre-injection transient cookies, and the Cookie Store API are outside this observer.
- Counts continue after sample limits: up to 50 unique extension IDs, ten unique
  endpoint URLs, and six cookie names. URLs omit credentials, queries and fragments.
- DOM cleanup cannot prove that a frame made no request; DNR supplies the network
  barrier. MAIN-world stats remain page-modifiable and are advisory.

References: [Chrome DNR rules and URL matching](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest),
[fetch network-failure behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch).

## Reporting improvements

The popup now shows sampled target IDs and captured resource paths, allowlisted
cookie names, and sanitized endpoint paths in keyboard-accessible disclosures.
It refreshes all fields, including zero counts and cookie-only changes, and
preserves open disclosures. Missing reports show zero and a waiting state.
Active API shields are labeled separately from blocked attempts. AI requests
and clipboard summaries contain aggregate counts only; AI calls remain explicit.

Background state is scoped to the exact tab and cleared on top-level navigation,
including navigation away from LinkedIn. Child-frame messages cannot overwrite
the top-frame report. Runtime tests exercise shipped scripts with mocked Chrome
APIs, including tab isolation, navigation reset, host lookalikes, missing reports,
sanitization, live refresh, and explicit aggregate-only AI calls.

Popup readability fixes address low-contrast text, small labels, missing input
labels, and long evidence strings. The local design detector reports no remaining
findings; no suppressions were added. Browser rendering still needs live review.

## Contributor workflow

`CONTRIBUTING.md` now documents the setup, architecture, evidence and privacy
standards, public-seam regression tests, review expectations, and browser checks.
`.nvmrc` and CI both select Node 24. `node scripts/verify.mjs` runs lint, format,
runtime syntax checks, and the full test suite against tracked working files plus
explicitly named new files. It avoids sweeping unrelated untracked experiments
into lint/format checks. The README now describes actual fixed API values, popup
AI requests, captured sample size, cookie-name observations, and coverage gaps.

## Validation record

- Feature commits: `dad0274` (catalog), `dc42942` (protections), `9b1ffea`
  (reporting), and `0be0eb2` (contributor workflow).
- The shared verifier passed in the working tree and a clean detached checkout
  of `0be0eb2` after a fresh lockfile install: ESLint, Prettier, five runtime
  syntax checks, and **121 tests across eight files**. The checkout remained clean.
- Each behavior commit passed the repository's pre-commit checks. The popup
  design detector passed without suppressions. Rendering is not verified by a
  static design detector or jsdom.
- Original plan-viewer files matched saved SHA-256 hashes, and the original
  `package.json` patch matched byte-for-byte. They remain outside these commits.
- CodeDB MCP continued serving a stale baseline snapshot after reindexing. The
  CodeDB CLI rebuilt the index, resolved the current `isTrackerUrl` definition
  and caller, and passed the required refresh probe. Current source and tests
  were checked directly where MCP results were stale.
- Comet was identified from its running application and matching open tabs; its
  local selector pin was refreshed. The browser automation connection then
  disappeared before a live Shield smoke test completed. Reconnection is needed
  to verify authenticated browsing, actual network rules, and popup rendering.
  No logged-in browser validation or remote CI result is claimed.

## Exception telemetry disclosure (2026-09-25)

A user-supplied request to `https://www.linkedin.com/to11ysim2l0rlGBsG`
contained an `OtelPilotClientTraceEvent`. Offline base64 decoding reproduced the
supplied JSON exactly. Its `exception.stacktrace` included Shield's `content.js`
fetch proxy and another extension's `native-save-bridge.js`, including both
extension IDs. Authentication cookies accompanied the request, so `memberId: 0`
does not establish anonymity. Private request data and identifiers are not copied
into this repository; the captured request was never replayed.

The immediate source was the `TypeError` created by Shield when rejecting a
blocked fetch. Its JavaScript stack was page-readable. The XHR block also exposed
an extension URL and the explicit message `Blocked by LinkedIn Shield`.

Shield-generated failures now retain their `TypeError` / `NetworkError` contracts
with neutral messages and a stack containing only the error name and message.
The stack is replaced without reading it, removing all caller frames rather than
only Shield's frame. Native errors from allowed requests remain unchanged; global
error constructors and prototypes are not modified.

Rule 13 and the page hooks block the exact observed HTTPS origin and case-sensitive
path, including its query string. The network rule covers XHR/fetch, beacon and
other background requests initiated by LinkedIn. Similar paths, unrelated hosts,
nonstandard ports, normal APIs, challenge pages and top-level navigation remain
outside this rule. Blocking this transport can suppress ordinary analytics sent
through the same endpoint. No generic opaque-path block or request-body inspection
was added. A direct read of the referenced public metrics bundle returned HTTP
403, so endpoint rotation and other uses were not established from that source.

This closes the observed Shield-generated exception channel, not every way to
detect an extension. A renamed telemetry endpoint, errors independently created by
other extensions, page-visible Shield markers, and intentional hook inspection
remain coverage limits. Browser verification must distinguish synthetic Chrome
rule/error checks from fresh authenticated network observations.

Regression tests first reproduced both exception leaks and the unblocked captured
endpoint. Updated tests cover rejection semantics, second-extension caller frames,
native error preservation, all three hooked transports, and URL boundaries. The
installed-browser harness adds seven real rule-engine cases and two error-privacy
checks using the shipped script without sending captured data.

References: [V8 stack traces](https://v8.dev/docs/stack-trace-api),
[Chrome declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

### Verification for this change

- `npm run verify` passed in the original workspace: ESLint, formatting, syntax,
  and 188 tests across 13 files. The isolated checkout also passed its verifier;
  the original workspace retains a pre-existing additional fixture regression.
- BrowserOS JP / Chrome 151.0.8162.137 ran the installed development extension:
  **31/31 browser checks passed**, including rule 13 URL boundaries, fetch/XHR
  exception privacy, loopback wire blocks/header removal/cleanup, and popup checks.
- A fresh authenticated `/feed/` tab was observed for 30 seconds via CDP. Across
  158 HTTP(S) requests and all four available request bodies, no extension schemes
  or either captured extension ID were found in the inspected URLs/bodies. No body
  was missing, oversized, or opaque. Fifteen product requests received 2xx responses.
  Direct synthetic extension probes in that tab produced neutral `TypeError` and
  `NetworkError` values with no extension identity in their exception fields.
- The captured telemetry route did not occur during that observation, so this is
  not evidence of its live server-side receipt or retention. Its blocking was
  checked independently with Chrome's installed rule engine. Separate workers and
  out-of-process frames were outside the network capture. Comet / Chrome 152 was
  not used for this live check.
- The development server reported three clients acknowledging the new revision;
  generated runtime files matched source. This acknowledgment alone is not a
  browser privacy test. Unrelated modified files retained their original hashes.
- The capture retained aggregate results only. No cookies, request bodies, private
  page content, or vendor bundle were added to the repository. CDP network
  observation was disabled and its session detached after the check.

## Ranked follow-up opportunities

1. Add a reproducible, data-only capture importer that previews catalog and
   endpoint changes, preserves researched labels, and updates provenance checks.
2. Add an extension-loaded browser regression harness for DNR/header behavior,
   iframe timing, popup rendering, and synthetic normal-page compatibility.
3. Separate network-rule blocks, API shields, and per-frame observations into
   explicit counters, with document/navigation identity and no double counting.
4. Investigate remaining worker/native-API and DOM-based discovery paths using
   isolated fixtures before adding broader hooks or permissions.
5. Bind each AI provider's endpoint, model, and key settings together so provider
   switching cannot reuse stale configuration; add a clear local-only explanation.
