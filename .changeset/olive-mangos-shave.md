---
"@effected/lockfiles": patch
---

## Bug Fixes

`Lockfile.parse` treated a lockfile file as a single YAML document. pnpm 11 writes `pnpm-lock.yaml` as **two** documents when the workspace uses `configDependencies` — a config-dependencies preamble, then the lockfile — so parsing silently read the preamble and returned a successfully-parsed `Lockfile` with one package, zero workspace importers and zero catalogs. It did not fail; it reported an **empty workspace**, which any consumer would read as "this monorepo has no packages" rather than "parsing went wrong".

Parsing now reads the YAML *stream* and locates the lockfile with a **deterministic** rule rather than a heuristic: the lockfile is the **last** document. That is pnpm's own writer contract — `writeEnvLockfile` composes the preamble as a prefix (`${env}---${main}`) and `extractMainDocument` reads back everything after the first separator. Both documents declare `lockfileVersion`, `importers` and `packages`, so position is the only thing that distinguishes them; no key-sniffing heuristic would be sound.

## Features

New `LockfileFramingError` — a typed failure for content that parses as text but carries no locatable lockfile document. It carries typed fields (`format`, `documents`, `reason`) rather than a `cause`, because there is no foreign throwable to wrap. `reason` is one of:

* `"noLockfileDocument"` — the stream carries no lockfile document. An env-only `pnpm-lock.yaml` (a preamble and nothing after it, which pnpm writes when there is no main lockfile yet) reads this way, as does empty content. pnpm itself treats such a file as having no lockfile; parsing never falls back to the preamble.
* `"noImporters"` — the located document declares no importers, so it describes no workspace. pnpm always records at least the root importer.
* `"unexpectedDocuments"` — multi-document input to a format that defines no document framing.

The governing invariant: an unlocatable lockfile **fails typed and never returns an empty `Lockfile`**. An empty result is indistinguishable from a genuinely empty workspace, which is precisely what kept this bug invisible.

`yarn.lock` shared the single-document assumption (it is also YAML). yarn defines no document framing, so a multi-document `yarn.lock` now fails with `unexpectedDocuments` instead of being silently truncated to its first document — parsing refuses to guess where the format states no rule. npm and bun never shared the assumption: a second top-level value is a syntax error in both `JSON.parse` and `Jsonc.parse`, and the suite now pins that rather than assuming it.

`Lockfile.parse`'s error channel widens from `LockfileParseError` to `LockfileParseError | LockfileFramingError`. Callers matching exhaustively on the error tag will need a `LockfileFramingError` arm. Well-formed single-document lockfiles in every format parse exactly as before.
