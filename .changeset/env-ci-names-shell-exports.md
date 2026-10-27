---
"@effected/env": minor
---

## Breaking Changes

* `CiName` now names 40 CI providers (GitLab, Buildkite, CircleCI, Azure Pipelines, Jenkins, Travis, Vercel, Netlify and more) instead of `github-actions` and `generic`. An exhaustive `switch` or a `Record<CiName, …>` stops compiling, and a snapshot that names a new provider cannot be decoded by a 0.5.0 reader.
* Detection follows std-env, so a single provider variable is enough to read as CI. Runtime hosts (Cloud Run, Render, Railway, Deno Deploy and similar) are deliberately not CI unless `CI=true` is also set.
* `CI=false`, `0`, `off` or `no`, and a provider marker set to one of those, still mean not CI. This departs from std-env on purpose so `CI=false` keeps restoring interactive output.

## Features

* `RuntimeEnv` gains `session` (terminal or multiplexer session identity), `ciRun` (provider-neutral run id, attempt, job, sha, ref and runner coordinates, `Some` exactly when `ci` is) and `termProgram` (the raw `TERM_PROGRAM` and version). Existing `RuntimeEnv.make` calls still compile and old encoded values still decode.
* `ShellExports` parses and writes files of literal `export NAME=VALUE` lines with `parse`, `parseResult`, `parseBytesResult` and `format`. It is a strict dialect, not a shell interpreter: any expansion or unknown statement rejects the whole file with a located `ShellExportsError`. Read files through `parseBytesResult`, which decodes each `$'…'` as UTF-8 on its own.
