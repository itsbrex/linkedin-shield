# Reviewing a captured script

Use the static importer to compare a new JavaScript capture with the current
extension catalog and, optionally, a previous capture report. It uses the pinned
[Acorn parser](https://github.com/acornjs/acorn/tree/master/acorn), never executes
the capture, and makes no network requests. Acorn is a development dependency;
it is not included in either extension build.

## Generate a review

After `npm ci`, run from the repository root:

```sh
npm run capture:review -- /path/to/capture.js
```

The default output is `.capture-reviews/<source-sha256-prefix>/`, ignored by Git,
ESLint, and Prettier. Inputs must be regular files no larger than 16 MiB. Output
directories must be new: an existing directory, file, or symlink is never replaced.
Use `--out .capture-reviews/descriptive-name` for another review of the same capture.
Custom output locations are not automatically ignored.

The command finds a nonempty literal `const o` array containing `{id, file}`
objects. Unrelated variables named `o` are ignored. Multiple possible tables
fail instead of silently choosing one. Select another identifier or an exact
one-based declaration line when necessary:

```sh
npm run capture:review -- /path/to/capture.js --table probes --line 42
```

Every entry must contain exactly two literal string properties. Getters, spreads,
computed properties, executable expressions, missing fields, duplicate IDs, and
unsafe resource paths fail before artifacts are written. Chrome IDs must contain
32 letters from `a` through `p`. Relative resource paths retain their spelling,
case, Unicode, spaces, and bracketed font names; traversal, control characters,
queries, and fragments are rejected. Unsupported table formats require a reviewed
parser change rather than execution of the captured bundle.

## Review the artifacts

- `report.json`: source SHA-256 and size, table location, sorted-pair SHA-256,
  complete catalog additions/removals/resource changes, static signal candidates,
  and optional signal deltas. It omits the source filename, absolute input path,
  and raw bundle. Identical inputs and catalog produce identical reports.
- `review.md`: readable counts, source locations, signal changes, and limitations.
- `catalog.patch`: an ordinary Git patch for `known-extensions.js`. It preserves
  curated names/categories and updates the captured table and provenance comments.
  An unchanged capture and catalog produce an empty patch.

An extension ID is a probe target, not evidence of installation. Resource names
do not establish product identity. Catalog removals are shown explicitly; decide
whether the new capture should replace or supplement the current snapshot.

To compare endpoints, cookies, and headers with a prior capture:

```sh
npm run capture:review -- /path/to/new-capture.js \
  --baseline .capture-reviews/earlier/report.json \
  --out .capture-reviews/new-review
```

Without `--baseline`, candidates are listed without claiming they are newly
introduced. Deltas compare normalized values, not source line changes. Absolute
HTTP(S) URLs, protocol-relative URLs, and root-relative paths remain distinct.
Credentials, queries, and fragments are removed. Relative paths have no inferred
hostname. Up to five source locations are retained per candidate, with the full
occurrence count.

Cookie/header extraction emits names, omitting literal value arguments and header
object values. Recognized patterns include known cookie-name literals,
`getCookie`/`setCookie`-style calls, `document.cookie` assignments,
`setRequestHeader`, and `headers` object keys. Those names remain candidates;
helper identities are not resolved and no runtime cookie allowlist changes.

Static strings are not proof of a request, a tracker, or a successful block. The
importer does not resolve variable aliases, computed expressions, encrypted
payloads, or runtime configuration. URL paths can still contain sensitive data;
review artifacts before sharing them. Never commit a private capture or browser
export. Keep authentication and challenge flows working.

## Apply only reviewed changes

The importer does not change the catalog, rules, or test expectations. After
reviewing a nonempty patch:

```sh
git apply --check .capture-reviews/new-review/catalog.patch
git apply .capture-reviews/new-review/catalog.patch
```

Inspect the resulting diff. Independently confirm the source table, count, and
sorted-pair hash before updating `tests/known-extensions.test.js`. Record findings
in `docs/surveillance-findings.md` or a focused capture note. Endpoint candidates
need call-site evidence, host/path boundaries, and positive/negative fixtures
before any change to `rules.json` or `content.js`.

```sh
npm test -- tests/capture-review.test.js tests/known-extensions.test.js
npm run verify
npm run build
npm run build:dev
npm run package
```

Use the [browser harness](../dev/README.md#browser-regression-harness) after any
rule or popup change. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for privacy,
documentation, testing, and review requirements.
