# Development build validation — 2026-09-20

Branch: `codex/dev-hot-reload`. Implementation commits: `f427a88` (development
watcher and release ZIP) and `4fdd20b` (CLI entry-point regression fix).

## Delivered workflow

- `npm run dev` / `npm run watch` builds `.dev-build/`, watches runtime sources,
  and signals extension reload after successful builds. The development copy has
  a `[DEV]` name and amber code-shield icons.
- The reloaded worker refreshes LinkedIn tabs. Development-only loopback access,
  an alarm, and a hash-only WebSocket client support reconnects and suspended MV3
  workers. Production source files do not receive those changes.
- `npm run package` produces a fresh production ZIP and SHA-256 checksum under
  `releases/`, named from the extension manifest version. README, contribution
  guidance, development documentation, convenience commands, and CI cover both
  build modes.

## Automated and artifact evidence

The shared verifier passed with **136 tests across 11 files**, plus ESLint,
Prettier, and runtime syntax checks. The pre-commit hook also passed. A clean
detached checkout of `4fdd20b` passed `npm ci`, `npm run verify`,
`npm run build:dev`, and `npm run package`, and remained clean afterward.
Validation used Node 24.19.0 and the committed npm lockfile.

Regression coverage includes atomic editor saves, missing files, invalid
development manifest preparation, prior-build preservation, reconnect after
offline edits, duplicate/invalid reload messages, worker restart ordering,
port conflicts, and rejection of web-page WebSocket origins.

CLI tests run outside the repository and import the build module from stdin.
These caught two entry-point problems: macOS `/var` versus `/private/var` paths
and treating stdin's `-` as a filesystem path. The scripts now use Node's
[`import.meta.main`](https://nodejs.org/api/esm.html#importmetamain) API; documented
minimum Node version is 24.2 within the Node 24 LTS line.

The production ZIP contains **13 files, 151,547 bytes**. Python's independent ZIP
reader verified archive integrity and byte parity with every source file; the
SHA-256 sidecar matched. Tests also verify deterministic archive bytes and the
absence of development code, permissions, branding, and unrelated local files.
The generated amber icon was inspected visually.

## Live Comet evidence and remaining gaps

The user confirmed loading `.dev-build/` in Comet. The Comet plugin's local
diagnostic identified installed, running Comet **152.0.7977.197** and an available
Computer Use runtime. That prerequisite check alone does not prove UI control.

The actual development worker connected to the loopback watcher and acknowledged
build `1e4776508d6b…`. A temporary source comment triggered a rebuild, automatic
extension reload, and acknowledgement of `6f0f374a3bf6…`. The temporary comment
was removed. After the command runner's five-minute foreground limit stopped the
watcher, it was restarted in a detached process; the worker reconnected and
acknowledged final source revision `4d26d2607a4f…`. The health response reported
one client with an acknowledged revision matching the server's current build.
These checks prove worker reload and reconnect behavior through the live client.

Comet's native Computer Use entry point, `cua.getApp('ai.perplexity.comet')`,
repeatedly timed out before returning window state. At that stage, popup rendering,
authenticated page behavior, actual LinkedIn tab refresh, declarative network
blocking, and loading the extracted release ZIP were unverified in Comet.
The browser regression follow-up below records subsequent synthetic checks.
No different browser was substituted. Browser cookies, credentials, and private
page content were not extracted. Complete those UI checks when control reconnects.

## Tooling and scope notes

- `npm audit` reports eight existing development-tool dependency findings:
  three moderate and five high. Existing dependency versions were unchanged;
  the two added pinned packages (`ws` and `fflate`) were not audit findings.
  Neither dependency is included in extension output. Dependency updates remain
  a separate follow-up.
- CodeDB MCP's symbol lookup did not resolve the new `buildDevelopment` function
  after a CLI index refresh. Direct source inspection supplied that context.
  The CLI indexed 49 files, and the required refresh probe succeeded.
- The unrelated package `plans` command and untracked plan-viewer files remain
  outside these commits. No push, PR, publication, or remote CI run was performed.

For installation and manual review steps, see [dev/README.md](../dev/README.md)
and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Dependency remediation — 2026-09-20

The follow-up on `codex/development-quality` resolved all eight reported audit
findings using compatible updates within the existing dependency ranges. No
forced major upgrade, dependency override, or install-script approval was added.
The lockfile now selects `@humanfs/node` 0.16.8, Vitest and its mocker 4.1.11,
`brace-expansion` 5.0.12, `nanoid` 3.3.19, PostCSS 8.5.28, Undici 7.29.1, and
Vite 8.3.0, with their compatible dependency updates.

`npm audit` reports **zero vulnerabilities**. The shared verifier passes all
**136 tests**, lint, formatting, and syntax checks with the updated toolchain.
Production extension files and permissions are unchanged. npm leaves the
optional macOS `fsevents` install script unapproved; the repository's watcher
uses Node's built-in `fs.watch` and does not require that script.

## Browser regression follow-up — 2026-09-20

`npm run test:browser` provides a loopback-only fixture server for the dev build's
22-check browser suite. The suite exercises installed rule matching, local wire
blocking and header removal, cleanup, and shipped popup rendering with synthetic
Chrome API responses. Test assets and launch link are excluded from production
output. It adds no extension permissions. See the
[coverage guide](../dev/README.md#browser-regression-harness) for the distinctions
between those kinds of evidence.

The shared verifier passes **140 tests across 12 files**, including fixture-server
privacy/report validation and dev-build isolation. A direct filesystem experiment
observed dropped or delayed native watch events for newly created macOS test
directories. A one-second source-hash poll now backs up native events, deduplicates
failure notices, and requires a restart after builder changes. Regression tests
disable native notifications entirely and verify save, failure, and recovery.

Comet's dev worker acknowledged the updated build. Native Computer Use still
times out before returning window state. The user ran `npm run test:browser`,
started the installed development build's suite in Comet, and supplied complete
terminal output with **all 22 checks passing**: 12 installed rule-matching checks,
four loopback wire/cleanup checks, and six popup checks. This is user-run Comet
evidence, not an automated Computer Use run. The first agent-started fixture
server timed out before execution and was not counted as a pass.

Authenticated LinkedIn page behavior, actual LinkedIn tab refresh, and loading
the extracted release ZIP remain unverified. Matching hypothetical production
URLs plus synthetic wire tests does not establish observation of real production
traffic. No different browser was substituted.

## Static capture review follow-up — 2026-09-20

`npm run capture:review` uses pinned Acorn 8.18.0 to parse a vendor bundle without
executing it. It writes a local JSON report, Markdown review, and applicable Git
patch. Existing output paths are refused. The catalog, detection rules, and
integrity expectations remain unchanged until a maintainer reviews the evidence.
See the [capture review guide](capture-review.md).

The supplied 2,669,775-byte capture has SHA-256
`f5bb9da5de585dd9d0f412636e273fbcc0135265c3ad9de0b90043dec73b61c0`.
The literal `const o` table starts at line 9536, column 450 (the variable name).
Extraction returns exactly **4,934 pairs**, with sorted-pair SHA-256
`2b1825e71d31f243283623d96e7d7ac04a281bd91fe8ff01bace34c6de50820b`,
matching the existing independently calculated integrity fixture. The generated
catalog patch is empty: no additions, removals, or changed resources.

The report contains **65 static endpoint candidates, seven cookie-name
candidates, and eight header-name candidates**. These include normal API,
identity, and CSRF context; classification requires call-site review. No new runtime
blocking or cookie handling was added from these candidates. A second run
against the first report produces zero signal deltas. Reports retain source
locations, strip URL credentials/query/fragment fields, and omit cookie/header
literal values. Private captures and generated reports are not committed.

Thirty-three new tests cover static extraction without execution, malformed and
ambiguous tables, Unicode/bracketed paths, duplicate IDs, unsafe paths, signal
redaction, applicable catalog patches, preserved labels, repeatable reports,
baseline validation, bounded input, and refusal to overwrite files or symlinks.
An initial unrestricted parallel run hit three five-second timeouts in the
catalog, ZIP, and importer suites while other analysis was running. With
[two test workers](https://vitest.dev/config/maxworkers), all **173 tests across
13 files** passed. The shared configuration now uses that worker limit; existing
assertions and timeouts were not weakened. `npm ci` succeeds with the updated
lockfile, and `npm audit` still reports **zero vulnerabilities**.

The full shared verifier then passed with the committed worker configuration:
173 tests, ESLint, Prettier, and runtime syntax checks. `npm run build`,
`npm run build:dev`, and `npm run package` succeeded. An independent Python ZIP
check confirmed 13 entries, matching source/dist bytes, and the same production
archive SHA-256 as before these development-tool changes:
`4fd7ef6e7abbdccd4c57a98b1b3f0c83e5d8636b3728b131cabc4d877496d6a6`.
The live dev watcher still reports a connected client acknowledging its current
build revision. No private capture, review output, or plan-viewer WIP is staged.
