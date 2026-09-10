# Contributing to LinkedIn Shield

LinkedIn Shield is a small Manifest V3 extension with a copy-only build and no
runtime dependencies. Prefer focused changes that improve privacy without disrupting
normal browsing. This guide records the repository's existing conventions and
the validation expected for new contributions.

## Development setup

Use Git, Node.js 24 (see `.nvmrc`), and npm. If you use nvm:

```sh
nvm install
nvm use
npm ci
git switch -c codex/describe-your-change
npm run verify
npm run build
```

Use a new feature branch based on the intended base branch, normally `master`.
Inspect `git status` first and preserve unrelated work. Use the committed npm
lockfile; do not introduce another package manager's lockfile. `npm ci` installs
development tools and configures the Husky pre-commit hook.

Load `dist/` as an unpacked extension from your Chromium browser's extensions
page. If you previously loaded the repository root, disable that copy to avoid
running two instances. After source changes, run `npm run build`, reload the
extension, and reload the test page. A popup reload alone does not replace an
already injected script.

The build copies only the explicit runtime-file allowlist in `scripts/build.mjs`,
including the license. It preserves file contents and paths without transpiling
or minifying. Development tools, tests, docs, dependencies, and local experiments
are excluded. `dist/` is ignored by Git, ESLint, and Prettier; every rebuild
replaces it and removes stale files. Do not edit it by hand. Missing inputs fail
before the previous build is replaced.

When adding a runtime asset, update the manifest or popup references as needed
and the build allowlist. `tests/build.test.js` checks the generated package against
those entry points, verifies byte-for-byte copying, and exercises rebuild/failure
behavior. Keep paths stable and include only files needed by the extension.

## Architecture and code style

- `rules.json` supplies declarative network protection. `manifest.json` declares
  permissions, scripts, and matching frames.
- `content.js` runs in the page's MAIN world. `bridge.js` relays advisory page
  reports from the ISOLATED world; `background.js` maintains per-tab badges.
- `popup.js` renders local evidence and makes AI calls only after an explicit
  click. `known-extensions.js` is a local reference catalog, not an installed
  extension inventory.
- Use plain JavaScript, existing naming, two-space indentation, single quotes,
  semicolons, trailing commas, and the checked-in ESLint/Prettier configuration.
  Runtime scripts must work in their declared extension context; a Node ESM test
  import alone does not prove that a classic content script loads.
- Avoid new permissions, dependencies, broad URL patterns, and unrelated
  refactors unless necessary. Explain their purpose and cost in the review.

## Evidence and privacy standards

Analyze captured scripts as untrusted data. Do not execute a vendor bundle merely
to extract a literal table. Record source hash, relevant locations, extraction
method, and uncertainty in a focused document such as
[`docs/surveillance-findings.md`](docs/surveillance-findings.md).

Preserve captured extension IDs and relative resource paths exactly. Validate ID
syntax and duplicates; do not guess product names or infer installation from a
probe target. Separate static source capability from observed live behavior.

Use host and path boundaries for endpoint rules, with positive and negative
fixtures. Keep authentication, challenge flows, and ordinary product requests
working. Cookie detection must record allowlisted names only; never save,
display, decode, or transmit cookie values. Preserve native cookie behavior.
Do not commit private browser exports, credentials, response bodies, full vendor
bundles, or personal browsing evidence.

Counts must describe what they measure. API shields are not collection attempts;
missing evidence is not a successful block. State coverage gaps such as workers,
child frames, or network matches unavailable to the popup. AI and sharing must
remain explicit and use aggregate counts only.

## Tests and checks

Add behavior-focused regression coverage through shipped scripts and public
interfaces. Mock Chrome and network boundaries; never use live credentials or
tracking endpoints in automated tests. Include normal allowed behavior and
failure cases, not only the blocking path. Catalog changes must preserve full-set
integrity checks. Update documentation when behavior or coverage changes.

Run focused tests during development, then the same verifier used by CI:

```sh
npm test -- tests/content.test.js tests/rules.test.js
npm run verify
npm run build
```

The verifier checks the current working copies of Git-tracked files, including
new staged files. It runs ESLint, Prettier, runtime syntax checks, and all Vitest
tests. It does not rewrite files. Pass each new untracked file explicitly before
staging it, for example:

```sh
npm run verify -- tests/new-behavior.test.js docs/new-finding.md
```

This scope keeps unrelated untracked experiments out of formatting/lint checks;
the full test suite still runs. `npm run lint` and `npm run format:check` remain
available for whole-directory checks. Review and stage exact paths; Husky runs
lint-staged (including `.mjs` scripts) and all tests on commit. Generated builds
are excluded from source checks. Do not bypass failing checks.

## Browser review

Before release, run `npm run build` and use a Chromium browser with `dist/` loaded:

1. Verify the extension loads without manifest or service-worker errors.
2. Reload a LinkedIn page and confirm navigation/content still work. If testing
   an authenticated session, keep credentials inside the browser.
3. Open the popup. Confirm counts, waiting/active states, evidence disclosures,
   keyboard access, and readable layout. Zero activity is a valid result.
4. Exercise synthetic probes locally and verify blocked requests do not reach
   the network. Never replay captured collection payloads or change account data.
5. Check another tab and navigation away from LinkedIn for stale badges/stats.

Document browser version, whether a logged-in page was tested, and what was
actually verified. Report unavailable checks plainly; mocked tests do not prove
browser network-rule behavior. Avoid screenshots containing private page data.

## Commits and review

Keep commits focused and reviewable. Use gitmoji Conventional Commits, such as
`✨ feat: explain blocked probe targets` or `🐛 fix: clear stale tab statistics`.
Include tests and relevant findings with each behavior change.

Pull requests should explain the problem, resulting behavior, evidence for new
signals, validation performed, privacy/compatibility tradeoffs, and remaining
gaps. Target the appropriate base branch and require passing CI plus human review
of detection scope. Publishing, pushing, and release actions are separate from
local development and must follow the maintainer's authorization.
