# Reading a build's result

`dist/prod/issues.json` is the build's verdict and its diagnostics. Every gate, monitor and fixer reads it, and it can lie to a careless reader in two ways: a crashed build can look clean, and a replayed build can look fresh.

## The shape

```text
{ generatedAt, package, target, buildOk, failure?, warnings, errors, suppressed }
```

- `buildOk` says whether the build reached its end without a terminal failure. `failure` is `{ name?, message }`, present only when `buildOk` is false, with `message` cut to 2000 characters.
- `warnings`, `errors` and `suppressed` hold diagnostics `{ source, level, text, code?, ciFatal?, file?, line?, column? }`, de-duplicated across publish groups. `source` is `tsdown`, `rolldown`, `api-extractor`, `meta` or `config`.
- `package` is the workspace package's name, even under `manifest.set.name`, or `"unknown"` when the build failed before it read the manifest's name (or the manifest has none). The journals key on it, so a watcher filtering by name misses those lines. `target` is `prod`.
- The file is written on both terminal paths, success and failure, by atomic rename, so a reader sees the old artifact or the whole new one. The write is best-effort: a build never fails for want of it, so a failed write leaves the previous build's file in place.
- A refused run exits 2, and may have written nothing. A config that will not decode or load, a plugin that will not load, or a directory with no `package.json` stops before the bundler starts, so the file on disk is a previous build's; only a config the bundler itself rejects writes one, stamped `buildOk: false`.

## The read order

1. **The artifact is this build's.** First the command: an exit of 2 is a refused run, which may have written no artifact, so whatever the file says is unknown. Then `generatedAt`, which must postdate both your last source edit and the start of the build you ran. A turbo cache hit replays the previous run's log verbatim and restores `issues.json` with it, so neither a clean log nor the file's mtime (a restore refreshes it) proves a build ran. An older `generatedAt` means the build never saw the edit, the edited file is not an input of the task, or the run wrote nothing; rebuild to tell which, with `pnpm turbo run build --filter <pkg> --force` or a direct `effected package build`, which has no cache to replay and takes no `--force`. A forced build proves nothing until its own `generatedAt` is on the file.
2. **`buildOk` is `true`.** A crash can leave every bucket empty, byte-shaped like a clean gate, so never read `errors.length` alone. A missing `buildOk`, or a missing file, means unknown: rebuild. `buildOk: false` is one of two cases, and they read differently:
   - **API Extractor failed the build.** `failure.name` is `MetaGenerationError` and `errors` holds `ae-*` entries. The build ran; read `errors`, which name the symbols to fix. Under CI this is how a forgotten export fails. The artifact still lists what a local build of the same tree lists, every warning and every location, with the CI-fatal entries in `errors` instead of `warnings` marked `ciFatal: true`.
   - **Anything else is a crash.** Fix what `failure.message` says and rebuild before reading any bucket; they are not evidence.
3. **No `errors`, and no warning with `ciFatal: true`.** A local build reports `ae-forgotten-export` as a warning marked `ciFatal: true`. Under CI the same message is an error: API Extractor fails, the build ends with `buildOk: false` and `failure.name` `MetaGenerationError`, and the command exits 1. A `ciFatal` warning is a CI failure you can still fix before pushing, with its location and every other warning beside it.
4. **The warnings, by code.** `ae-*` and `tsdoc-*` codes come from API Extractor; fix them per `authoring-tsdoc`, without adding a suppression. `exports-pattern-unmatched` and `exports-built-condition-unmatched` are config warnings ([outputs.md](outputs.md), [workspace-wiring.md](workspace-wiring.md)). A warning with no `code` comes from tsdown or rolldown; read its `text`.
5. **`suppressed`, only to account for it.** It holds what `suppressWarnings` rules absorbed, the `_base` heritage types of Effect's class factories above all; a sibling's source reached through a workspace link (`ae-wrong-input-file-type` for a file outside the package); and tsdown advisory noise such as `TSGO_EXPERIMENTAL` (`source: "tsdown"`). Those never fail a build. To count class-factory bases, count only `source: "api-extractor"` entries: expect at least one `_base` per factory.

```bash
jq '{ generatedAt, buildOk, failure,
      errors:   [.errors[]   | {code, text, file, line}],
      ciFatal:  [.warnings[] | select(.ciFatal == true) | {code, text, file, line}],
      warnings: [.warnings[] | select(.ciFatal != true) | {code, text, file, line}],
      suppressed: (.suppressed | length) }' dist/prod/issues.json
```

## Locating a diagnostic

**A location is a hint; the symbol in `text` is the anchor**, for `ae-*` as much as `tsdoc-*`.

- API Extractor's diagnostics come from a second run over per-module declarations, so `file` is the source file, but `line` and `column` can name a neighbouring declaration: an `ae-missing-release-tag` on one export can be reported at the line of the export above it.
- A diagnostic found only in the bundled rollup carries no location, under CI and locally alike. Find it by the symbol quoted in its `text` (`The symbol "Foo" needs to be exported…`, `"noDocs" is part of the package's API…`).
- A `tsdoc-*` position can land on the declaration after the offending comment. Search for the construct the code names (a wrapped code span, a bare `@`, a `{@link}` target).

## Trustworthy evidence

- Treat the file as evidence only right after **your own** build of that package, with nothing else building it. `dist/` has no lock, and two sessions building one package, or a `rm -rf dist` racing a build, leave torn artifacts.
- Kill only your own build process, by PID. A `pkill -f` on a shared build-tool pattern kills other sessions' builds.
- After mutating source to prove a fix is load-bearing, rebuild, so the artifact describes a tree you actually have.

## The command and the MCP tool

`effected package build` exits 0 on success, 1 when the build ran and failed (a crash, or an error recorded), 2 when it could not start (an `effected.toml` that will not decode, a plugin that will not load, no readable `package.json`, a `ConfigValidationError`), 3 when it could not finish (a file it could not read or write), and 64 on a usage error. `--format=json` prints one `BuildRunResult` (`package`, `verdict`, `issues`, `report`, `config.sources`) on stdout. The `package_build` MCP tool answers the same result: exits 0 and 1 arrive as `verdict` `"ok"` or `"failed"`, and an exit-2 or exit-3 condition is a refusal whose hint names the path to check.

## The journals

Each finished build appends to two files under the workspace root, keyed by the package name as each line's `scope`:

| File | Event | One line per |
| --- | --- | --- |
| `.cache/effected/issues.jsonl` | `issue` | error and warning, in that order |
| `.cache/effected/build.jsonl` | `build` | finished build: `package`, `cwd`, `generatedAt`, `buildOk`, `failure?`, the three counts, `issuesPath` |

The build's line goes last, so a watcher that sees it finds that build's issues already written. A cache hit, a run refused before the build finishes, and an action build add no line. The journals are a watcher's view; `issues.json` stays what a reader trusts for one package.
