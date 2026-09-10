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

The existing README's 6,236 figure comes from its linked historical investigation;
it is not the count in this supplied sample. Catalog membership does not prove
installation, nor does a blocked probe prove that a targeted extension exists.

## Repository map

| Area                                  | Responsibility                                                  | Baseline observation                                                        |
| ------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `manifest.json`, `rules.json`         | Manifest V3 permissions and declarative blocking                | No build step; static rules run independently of page hooks                 |
| `content.js`                          | MAIN-world fetch/XHR hooks, fingerprints, iframe removal, stats | Top frame only; synthetic 404 probes incorrectly fulfill detection promises |
| `bridge.js`                           | ISOLATED-world relay to extension runtime                       | Page-provided statistics are advisory, not trusted attestation              |
| `background.js`                       | Early injection, per-tab badges, optional DNR debug counts      | Debug events need feedback permission; fallback can mix tabs                |
| `popup.html`, `popup.js`              | Live stats, explicit AI analysis, local settings                | AI calls originate in popup; some fallbacks invent nonzero counts           |
| `known-extensions.js`                 | Local ID/name/category/resource reference                       | Previously 34 hand-labeled entries; not loaded by popup                     |
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
- [ ] Expand protections for confirmed probe and surveillance paths.
- [ ] Make live reporting useful and truthful, including cookie-name detection.
- [ ] Document contributor setup and provide repeatable checks.

## Detection contract

The sample's parallel probe path treats any fulfilled fetch as a hit; its serial
path also treats any response object as a hit. HTTP status is never checked.
Returning a synthetic 404 therefore reports a false positive to the scanner.
Blocked extension fetches must reject like an inaccessible extension resource.
Regression coverage must reproduce both serial and `Promise.allSettled` callers.
