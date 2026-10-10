# Development build and automatic reload

Use Node 24 LTS (24.2 or newer), `npm ci`, and Chromium 120 or newer. Source stays at the repository
root; generated builds contain only extension assets.

## Install once

1. Run `npm run dev` from this repository. `npm run watch` does the same thing.
2. Open your browser's extensions page and enable Developer Mode.
3. Disable any other LinkedIn Shield copy, including one loaded from `dist/`.
4. Choose **Load unpacked** and select this repository's **`.dev-build/`** folder.
   In the macOS folder picker, use Cmd+Shift+G and enter the absolute path to show
   this hidden folder.
5. Confirm the name **[DEV] LinkedIn Shield** and **amber shield with code brackets**.
6. Refresh LinkedIn once after the first install. Keep the terminal running while
   editing source. Save page drafts before changing files.

You only need to select the folder once. Later development sessions start with
`npm run dev`; an already loaded development extension reconnects automatically.
Ctrl+C stops the watcher. The extension remains installed and continues operating.

## What reload means

The watcher debounces runtime-file changes, builds into a staging directory,
replaces `.dev-build/`, and sends a build hash over a local WebSocket. The old
worker saves a reload marker and calls `chrome.runtime.reload()`. The new worker
consumes the marker and refreshes open LinkedIn tabs, replacing scripts that were
injected at `document_start`. This is full extension and page reload, not in-place
module replacement. Unsaved drafts, scroll position, and page state can be lost.

Runtime files from `scripts/build.mjs` and development assets listed in `DEV_FILES`
in `dev/build.mjs` are watched. Parent
directories are watched so atomic editor saves still work. Unrelated docs,
dependencies, generated outputs, and local experiments do not trigger rebuilds.
One-second hash polling backs up native notifications when the operating system
drops events. Unchanged content never triggers a reload. Changed build tooling
produces one restart notice and preserves the previous build.
Failed builds retain the previous output and send no reload signal. Restart the
command after editing build/server/icon tooling or changing dependencies.

The worker sends a heartbeat every 20 seconds. Retries start at 500 ms and back
off to a 5-second cap for as long as the worker lives, so restarting `npm run dev`
reconnects within seconds; a 30-second development-only alarm can wake a
suspended MV3 worker after the server returns. The client connects only after the
worker script finishes evaluating, and registers `chrome.runtime.onInstalled` so
Chrome restarts the worker right after each `chrome.runtime.reload()`. A
reconnect compares the installed hash to the current build, so changes made while
disconnected are picked up. Browser extensions disabled by the user must still be
enabled manually.

Keep Developer Mode on. With it off, Chrome and Comet disable an unpacked
extension that reloads itself (`unsupportedDeveloperExtension`), and the worker
never returns.

Chromium's Local Network Access rules let a worker reach `127.0.0.1` only after
the extension's origin holds that permission, and a worker cannot show the
prompt. If the first connection after an install or reload fails, the worker
opens `dev/dev-connect.html` once. That page requests `/grant` from the server,
which can trigger the browser prompt; allow it, and the tab closes itself on
success.

## Port and diagnostics

The default server binds only to `127.0.0.1:8396`. It does not serve source files,
accept commands, or load remote JavaScript. WebSocket upgrades require this
checkout's development extension Origin (its id is derived from the real path of
`.dev-build/`) and the expected loopback Host; other origins get 403. Messages
carry build hashes only. Loading `.dev-build/` from a copy or another path changes
the id, so the server refuses it; load this checkout's folder. This is a local
development aid, not an authentication boundary against local processes. Stop it
when not developing.

```sh
npm run build:dev                      # Build once without starting the server
SHIELD_DEV_PORT=8397 npm run dev        # Use another port if 8396 is occupied
curl http://127.0.0.1:8396/health        # Build hash, clients, acknowledged hashes
```

After changing ports, manually reload the dev extension once so it reads the new
endpoint. A port conflict fails before replacing the installed build. With the
default port, the health response's `loadedRevisions` should contain `revision`
after a worker connects. This acknowledges worker code; it does not prove popup
rendering, page protection, or declarative network blocking.

The terminal logs `[dev] extension connected, running build <hash>` and
`[dev] extension disconnected`, so you can see which build the browser runs.

If reload stops: check terminal errors, confirm the dev extension is enabled and
Developer Mode is on, open `dev/dev-connect.html` from the extension if no
`extension connected` line appears, wait up to 30 seconds for its reconnect
alarm, then inspect its service worker
from the extensions page. Opening DevTools can keep a worker alive; also test
reconnection with DevTools closed. Permission changes may require browser approval
and a manual reload. If a file goes missing during an editor save, restore it and
save again; the watcher will retry on the next relevant event.

## Production and packaging

`npm run build` writes `dist/` with the normal name and green icon.
`npm run package` rebuilds that production output and writes
`releases/linkedin-shield-<manifest-version>.zip` and `.zip.sha256`. Both exclude
reload code and development permissions. Extract the ZIP into a separate folder
and load it unpacked for browser release review; disable the dev copy first.
Run `shasum -a 256 -c linkedin-shield-<manifest-version>.zip.sha256` from `releases/`
to verify the archive. Neither command publishes anything.

## Browser regression harness

With `.dev-build/` installed in Comet (or your chosen Chromium browser):

1. Keep `npm run dev` running so the development build is current.
2. Run `npm run test:browser` in another terminal. It binds a synthetic fixture
   server to `127.0.0.1:8397` and waits up to three minutes for a full report.
3. Open the development Shield popup and choose **Browser regression tests**.
4. Click **Run tests**. The page and terminal report each result. The command
   exits successfully only when all 31 checks report a pass; missing reports and
   failures exit nonzero. Restart the command before another run.

The harness has three distinct kinds of evidence:

- **Nineteen static-rule checks:** Chrome's `testMatchOutcome` evaluates the
  installed production rules against hypothetical URLs and initiators, including
  APFC, HUMAN, the observed exception-telemetry route, host/path/case boundaries,
  normal API requests, and challenge pages.
  These URLs are not fetched. No feedback permission is added.
- **Two error-privacy checks:** the shipped content script runs in the synthetic
  extension test page. Blocked fetch and XHR calls must preserve their failure
  types without exposing extension names or URLs in exception fields. These do
  not establish authenticated-page behavior or hide errors created by other code.
- **Four wire checks:** temporary session rules copy the production block and
  header-removal actions onto exact loopback fixture URLs, limited to this
  extension's initiator. The server proves control headers arrive, a blocked
  request never arrives, and `X-Li-Apfc-Data` is removed while a control header
  survives. Cleanup is checked. These verify actual Chrome action behavior on
  synthetic traffic, not production traffic interception.
- **Six popup checks:** generated frames load the shipped HTML, catalog, and
  popup script in a real browser. Chrome APIs return synthetic fixtures; network
  calls are forbidden. Checks cover waiting/zero state, sanitized evidence,
  400px layout, operable disclosures, missing-key guidance, and lookalike hosts.
  They do not inspect an authenticated user's popup data.

Keep the test page open until completion so its temporary session rules can be
removed. If reserved IDs 900001/900002 are already in use, the harness fails
without replacing them. All test URLs have a per-server random path; leftover
test rules cannot affect LinkedIn or other production traffic. The fixture
server keeps only synthetic header-presence booleans and reports IDs/pass flags,
never cookie values, authorization values, or response bodies from websites.

The harness adds assets and a launch link only to `.dev-build/`. Production
`dist/` and release ZIPs contain no tests or extra permissions. Browser execution
is opt-in; CI runs fixture-server and build-isolation tests without claiming a
live browser pass. Complete an authenticated Comet smoke review separately.

## Validation

```sh
npm test -- tests/build.test.js tests/dev-build.test.js tests/hot-reload.test.js
npm run verify
npm run build:dev
npm run package
```

Tests check generated identity and icons, production byte parity, exact ZIP
contents and repeatability, real loopback WebSocket updates, atomic saves, failed
build recovery, Origin rejection, port conflicts, and worker reload ordering.
Worker tests mock Chrome APIs; they do not replace browser review.

In the target browser, verify initial installation, a source save with a new
acknowledged hash, LinkedIn tab refresh after the extension reloads, disconnect
and reconnect with DevTools closed, and separate release ZIP loading. Keep
credentials and private page content inside the browser.

The design follows the separate `.dev-build` workflow used by ClaudeSync. Chrome's
[WebSocket service-worker guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)
and [alarms reference](https://developer.chrome.com/docs/extensions/reference/api/alarms)
explain the heartbeat and Chromium 120 requirement. The
[runtime reference](https://developer.chrome.com/docs/extensions/reference/api/runtime)
documents extension reload behavior.
