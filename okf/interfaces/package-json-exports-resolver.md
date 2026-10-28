---
type: Interface
title: The package-json exports resolver
description: "PackageExports implements Node's PACKAGE_EXPORTS_RESOLVE / PACKAGE_IMPORTS_RESOLVE pure over a structural manifest, adds TypeScript's types reading and enumeration, confines every answer to the package, and leaves the one filesystem step, pattern expansion, to PackageJsonFile.exportedFiles."
status: stable
kind: api
resource: ../../packages/package-json/src/PackageExports.ts
tags:
  - dx
  - security
sources:
  - id: exports-facade
    resource: ../../packages/package-json/src/PackageExports.ts
  - id: exports-engine
    resource: ../../packages/package-json/src/internal/exports.ts
  - id: exports-test
    resource: ../../packages/package-json/__test__/PackageExports.test.ts
  - id: exported-files-test
    resource: ../../packages/package-json/__test__/ExportedFiles.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-28T20:28:13Z
integrity:
  generated:
    body: 41c05bf28be660d3
---

# The package-json exports resolver

## What stays stable

`PackageExports` answers "which file serves this subpath?" for any
subpath, where `resolveEntryPoint` answers it for `"."` alone. Every
static is a sync `*Result` primitive with an `Effect` twin behind a named
span, and each is a transcription of a named step of Node's resolver
algorithm specification:[^exports-engine]

- `resolveResult(manifest, subpath, options?)` — PACKAGE_EXPORTS_RESOLVE,
  with PACKAGE_IMPORTS_EXPORTS_RESOLVE, PATTERN_KEY_COMPARE and
  PACKAGE_TARGET_RESOLVE beneath it; the legacy `main` / bare-subpath
  reading when `exports` is absent.
- `resolveImportResult(manifest, specifier, options?)` —
  PACKAGE_IMPORTS_RESOLVE, answering a package file or another package's
  bare specifier.
- `resolveTypesResult(manifest, subpath, options?)` — TypeScript's
  reading: `types`, `default` and `types@<range>` conditions, extension
  substitution into an ordered `candidates` list, and `typesVersions`
  only when `exports` is absent.
- `entriesResult` / `typesEntriesResult` — every subpath the map
  declares, a pattern key as one template entry.
- `splitSpecifier(specifier)` — Node's package-name parsing, which is the
  path-boundary rule (`pkg2/x` names `pkg2`, never `pkg` plus `2/x`).

The input is the structural `PackageExportsManifest`, so a manifest
fetched from a registry or CDN resolves with nothing else
validated.[^exports-facade]

## The condition set is not a priority list

`options.conditions` is a SET. A conditions object is walked in the
manifest's own key order and the first key the environment matches wins,
as Node and TypeScript both do. That is the opposite of
`resolveEntryPoint`, whose list is an ordered policy, and the two must not
be "harmonized": following the caller's order here answers a file Node
would never load. The visible consequence is the `types` position rule — a
`types` key written after `import` or `default` is never reached.

## Every answer stays inside the package

The security property, pinned by an adversarial test per rule:[^exports-test]

- A target must start with `./` and carry no `""`, `.`, `..` or
  `node_modules` segment after the first, split on `/` or `\`,
  case-insensitively and percent-decoded.
- A `*` pattern match is held to the same rule, including a match that
  starts mid-segment (`"./pre*"` against `./pre..`), and the substituted
  target is checked again whole: the template and the match can each pass
  alone while the join spells `..` (`"./%2*"` with `e%2e` is `./%2e%2e`).
- "Percent-decoded" means every decoding, not one: each escape decodes on
  its own and the string is re-decoded until it settles, so `%252e` and
  `%%32%65` are both seen as `.`. A string still changing after four
  rounds is refused outright.
- Five checks are stricter than Node, because a pure resolver returns a
  string its caller decodes or follows: an encoded `/` or `\` is refused
  outright; an `imports` bare target must be a package name (npm's
  characters, no leading `.` or `_`, no backslash or `%`) plus a subpath
  with no forbidden segment, checked again after `*` substitution, and
  refused as Node's PACKAGE_RESOLVE refuses one (`invalidModuleSpecifier`,
  which ends an array fallback);
  `main`, `types` and `typesVersions` targets are confined; and a request
  ending in `/` is refused (`invalidModuleSpecifier`). Node refuses that
  last one for `imports`, but for `exports` it still resolves it through a
  pattern under the DEP0155 deprecation warning: `pkg/a/` under
  `"./*": "./dist/*.js"` names a file literally called `.js` in `dist/a/`.
  Probed against Node, and kept refused on purpose.
- Confining `main`, `types` and `typesVersions` does not mean refusing
  every `..`. A literal `..` that stays inside the package is resolved as
  Node's URL parsing resolves it: `./lib/../index.js` answers
  `./index.js`, which Node loads too, and the confinement checks then run
  on the resolved path. A `..` that climbs out (`./lib/../../x.js`) is
  refused, and so is any `..` path that also carries a `\`, a tab or
  newline, or a segment that is a dot segment or an encoded separator
  under any percent-decoding (`lib/%2e%2e/../x.js`), because Node reads
  those as separators and dot segments too and a lexical resolution of the
  written form would name a different file.
- A `*` match is substituted as literal text, never through
  `String.prototype.replace`, which would read `$&`, `$$`, `` $` `` and
  `$'` in the match as replacement patterns (a request `./a$&b` once
  answered `./dist/a*b.js`). `exports`, `imports` and
  `PackageJsonFile.exportedFiles` replace every `*`; `typesVersions`
  replaces the first only, as TypeScript does.
- Hostile shape is bounded: conditions and fallback arrays nest at most
  32 deep, a pattern target carries at most 16 `*`, and pattern keys are
  matched by prefix and suffix after a sort — nothing is compiled to a
  regular expression, so thousands of `*` keys cost a scan. Membership
  uses own keys only, so a `__proto__` key is an ordinary key and an
  inherited name is no key.

The one deliberate divergence from the specification text: an array
fallback passes over a `null` entry, as Node's implementation does,
where the prose reads as returning it.

## A resolved path is the decoded file

`PackageFileTarget.path` and `ExportEntry.path` are decoded, `./`-prefixed,
`/`-separated package-relative filesystem paths: the file Node's
resolution names, not the target string as written. Node resolves a
target as `new URL(target, packageURL)` and reads it through
`fileURLToPath`, and the resolver repeats both steps — URL parsing (a raw
space or non-ASCII character encoded, a `\` turned into `/`, a tab or
newline dropped) and then POSIX percent-decoding, one round — so
`"./dist/a%20b.js"` is `./dist/a b.js`, `%25` is a literal `%`
(`%2541` is the file `%41`, never `A`), `+` stays `+`, and `%C3%A9` is
`é`. Callers relying on the old as-written form see a behaviour change.

Decoding runs only after every check above has passed, and a last guard
holds the decoded path to the same rule — non-empty, no `.`, `..` or
`node_modules` segment, no NUL — failing closed with the existing reason.
An encoded `..` is refused before decoding matters: decoding
`./dist/%2e%2e/index.js` would land on `./index.js`, still inside the
package, so only the validation ahead of it refuses it. A target that does
not decode fails `invalidPackageTarget`, or `invalidModuleSpecifier` when
the request's `*` match was substituted into it, and does not fall back to
the next array entry, as Node finalizes only the target it picked:

- an invalid UTF-8 escape (`%FF`, `%C3`, an encoded surrogate, an overlong
  `%C0%AE`) or a `%` starting no escape — Node rejects these too;
- a raw `?` or `#`, which Node reads as a URL query or fragment and so
  answers a truncated file (`./dist/a#b.js` is `./dist/a`) — stricter
  than Node; encoded as `%3F` / `%23` they are ordinary characters;
- a decoded NUL, which Node hands to the filesystem — stricter than Node.

The TypeScript statics do not decode. TypeScript reads an `exports`,
`types` or `main` target as a literal file name — `tsc` 6 and 7 both
resolve `"./dist/a%20b.d.ts"` to the file `a%20b.d.ts` — so a
`TypesTarget`'s `target` and `candidates` keep the written form.

Enumeration decodes a pattern template run by run between its `*`s; a
template whose runs do not each decode, or decode to a `*`, names no set
of files and fails the enumeration naming its key.

## The filesystem step lives in `PackageJsonFile`

Which files a pattern reaches is a question about the package on disk, so
`PackageJsonFile.exportedFiles(directory, manifest, options?)` answers it,
keeping the package's rule that all IO lives in that module. It walks the
directory a pattern's target fixes, never into `node_modules` and never
through a symlink: every path is `lstat`ed component by component from the
package root, so a linked concrete target, a linked parent directory and a
linked parent of a pattern's base all contribute nothing. It resolves each candidate subpath back through
`resolveResult`, keeping it only when it lands on the same file — so `null`
exclusions and more specific keys decide exactly as they do for one
request. Because every path is decoded, the walk compares decoded file
names, and the subpath it reports for a pattern match re-encodes `%`,
`?`, `#` and control characters (the file `dist/100%.js` is the subpath
`./100%25`) so it resolves back to the same file.[^exported-files-test]

[^exports-facade]: `packages/package-json/src/PackageExports.ts` — the
    facade, the TypeScript rules and `PackageExportsError`.
[^exports-engine]: `packages/package-json/src/internal/exports.ts` — the
    step-by-step transcription and the stricter-than-Node sites.
[^exports-test]: `packages/package-json/__test__/PackageExports.test.ts` —
    the "a resolved target stays inside the package" and "hostile
    manifests" groups.
[^exported-files-test]: `packages/package-json/__test__/ExportedFiles.test.ts`
    — pattern expansion over `@effected/memfs`.
