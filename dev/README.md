# Development build and automatic reload

Use Node 24, `npm ci`, and Chromium 120 or newer. Source stays at the repository
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

Runtime files from `scripts/build.mjs` and `dev/hot-reload.js` are watched. Parent
directories are watched so atomic editor saves still work. Unrelated docs,
dependencies, generated outputs, and local experiments do not trigger rebuilds.
Failed builds retain the previous output and send no reload signal. Restart the
command after editing build/server/icon tooling or changing dependencies.

The worker sends a heartbeat every 20 seconds. A two-second retry handles brief
disconnects; a 30-second development-only alarm can wake a suspended MV3 worker
after the server returns. A reconnect compares the installed hash to the current
build, so changes made while disconnected are picked up. Browser extensions
disabled by the user must still be enabled manually.

## Port and diagnostics

The default server binds only to `127.0.0.1:8396`. It does not serve source files,
accept commands, or load remote JavaScript. WebSocket upgrades require a Chrome
extension Origin and the expected loopback Host; messages carry build hashes only.
This is a local development aid, not an authentication boundary against other
installed extensions or local processes. Stop it when not developing.

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

If reload stops: check terminal errors, confirm the dev extension is enabled,
wait up to 30 seconds for its reconnect alarm, then inspect its service worker
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
