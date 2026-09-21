# LinkedIn Shield

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buymeacoffee)](https://buymeacoffee.com/qualitymax)

Block LinkedIn's hidden extension scanning, device fingerprinting, and tracker probes.

**Open-source. No tracking. No account required.**

## What the captured script contains

The JavaScript sample analyzed for this project contains **4,934 extension ID /
resource pairs**, device fingerprint collectors, invisible HUMAN frames, and
collection paths including `/platform-telemetry/li/apfcDf` and `/apfc/collect`.
Static code shows possible behavior; it does not prove every collector runs on
every visit or that any targeted extension is installed.

See [source evidence and coverage limits](docs/surveillance-findings.md).
Background reading: [BrowserGate investigation](https://www.bleepingcomputer.com/news/security/linkedin-secretly-scans-for-6-000-plus-chrome-extensions-collects-data/).

## What LinkedIn Shield Does

### Standalone Mode (no LLM needed)

- Blocks extension probing (intercepts `chrome-extension://` URL checks)
- Blocks captured tracker endpoints, APFC collection, and fingerprint loaders
- Removes the `X-Li-Apfc-Data` fingerprint header while preserving the request
- Supplies fixed CPU, memory, and battery values through protected APIs
- Removes hidden tracking iframes
- Shows observed blocks and active API shields with sampled probe resources
- Reports six tracking-cookie names without changing cookies or saving values

### AI Analysis Mode (optional)

- Click "Explain with AI" for a plain-English explanation of aggregate counts
- Settings support Claude (Anthropic), OpenAI, and QMax
- BYOLLM — bring your own API key, stored locally in browser storage

## Install

### From Source (Developer)

Use Node 24 LTS (24.2 or newer). Clone this repo, enter its directory, then run:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions/` → Enable Developer Mode.
2. Click "Load unpacked" → Select **`linkedin-shield/dist/`**.
3. Visit linkedin.com and check the shield badge.

`dist/` contains only the manifest, runtime scripts, popup, rules, four icons,
and license. Source files are copied unchanged; development tools, tests, docs,
dependencies, and local files are excluded. The build needs no bundler.

After editing source files, run `npm run build` again, reload the extension from
the browser's extensions page, then reload LinkedIn. Each build replaces `dist/`
and removes stale files; make edits in source files, not generated output. If you
previously loaded the repository root, disable that copy before using `dist/`.

### Automatic reload during development

Run `npm run dev` (or `npm run watch`). It creates **`.dev-build/`** and watches
extension source files. In your browser's extensions page, disable the `dist/`
copy and load `.dev-build/` once. Look for **[DEV] LinkedIn Shield** with an
**amber code shield** icon. Keep the command running while editing source files.

On each changed build, the extension reloads automatically, then refreshes open
LinkedIn tabs so their content scripts update too. **Save drafts first: these are
full page reloads.** Stop with Ctrl+C; restart the same command to reconnect.
Development mode requires Chromium 120 or newer and uses a loopback-only reload
connection. See [dev/README.md](dev/README.md) for ports and troubleshooting.

### Release ZIP

Run `npm run package` to rebuild `dist/` and create
`releases/linkedin-shield-<manifest-version>.zip` plus a `.zip.sha256` checksum.
The ZIP contains only production extension files, with `manifest.json` at its
root. Development branding, reload code, and loopback permissions are excluded.
Nothing is published or uploaded. Extract the ZIP into a separate directory and
load that directory unpacked to test the actual release artifact.

### Development commands

| Command                                                        | Purpose                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run build`                                                | Rebuild the unpacked extension in `dist/`                               |
| `npm run build:dev`                                            | Create the branded `.dev-build/` once, without watching                 |
| `npm run dev` / `npm run watch`                                | Build `.dev-build/`, watch source changes, and reload automatically     |
| `npm run package`                                              | Rebuild production output and create a versioned ZIP and SHA-256        |
| `npm run verify`                                               | Run tracked-file lint, formatting, runtime syntax checks, and all tests |
| `npm run capture:review -- /path/to/capture.js`                | Generate a static catalog patch and sanitized signal review             |
| `npm test -- tests/build.test.js`                              | Check package contents and rebuild behavior                             |
| `npm test -- tests/dev-build.test.js tests/hot-reload.test.js` | Check watch, reload lifecycle, and ZIP isolation                        |
| `npm run lint` / `npm run format:check`                        | Check the whole source directory, excluding generated builds            |

For browser regressions, run `npm run test:browser`, then choose **Browser
regression tests** in the development popup. See the
[harness guide](dev/README.md#browser-regression-harness) for coverage and limits.

For a new captured script, use the [capture review guide](docs/capture-review.md)
to extract literal probe tables and compare endpoint, cookie, and header
candidates. Review output stays local; the command does not execute the capture
or change runtime rules and catalog integrity expectations.

### Chrome Web Store

Coming soon.

## How It Works

**Layer 1: Declarative Net Request Rules** (`rules.json`)

- Blocks tracking endpoints at the network level before JavaScript runs
- Covers HUMAN frames, APFC collection, `sensorCollect`, `/li/track`, and `spectroscopy`
- Removes only the captured fingerprint header on matching LinkedIn requests

**Layer 2: Content Script** (`content.js`)

- Intercepts `fetch()`, `XMLHttpRequest`, and `sendBeacon()` on matching pages
- Rejects extension fetch probes; a fulfilled HTTP 404 would still reveal a hit
- Filters extension-resource entries from performance timing lookups
- Supplies fixed CPU/RAM values and a full-battery result
- MutationObserver removes hidden iframes as they're injected

**Layer 3: AI Analysis** (optional)

- Popup sends aggregate counts to your configured provider after your click
- Returns a plain-English privacy risk assessment
- Probe IDs, endpoint samples, and cookie names are excluded from AI requests

Popup counts are advisory page reports, not a complete network audit. Static
network-rule matches and child-frame activity are not included. An active API
shield does not prove a collection attempt. Workers, retained native APIs, other
fingerprint surfaces, and DOM-based extension discovery remain coverage gaps.

## Privacy

- Zero telemetry. Zero analytics. Zero tracking.
- AI analysis is opt-in and uses YOUR API key — we never see your data.
- All blocking happens locally in your browser.
- Open-source — audit every line.

## Supported Browsers

- Chrome (Manifest V3)
- Edge (Chromium-based)
- Brave (already blocks some endpoints — this adds extension probe protection)
- Firefox: Manifest V2 port planned

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, contribution standards, evidence
requirements, tests, browser review, and commit guidance. Use Node 24 and `npm ci`,
then run `npm run verify` and `npm run build` for the same checks and build used by CI.

## License

MIT

---

Built by [QualityMax](https://qualitymax.io) — AI-native test automation for engineering teams.
