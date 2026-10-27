# Upgrade this project to the kit-ports release of `@effected/*`

You are moving this repository onto the `@effected/*` release built on branch `feat/kit-ports`. It is a breaking `0.x` round. Most of it is new API: generic code that downstream projects had hand-rolled has moved into the kit. There are a few real breaks, listed first.

Work in this order:

1. Fix the breaks in step 2.
2. Find hand-rolled code the kit now covers (step 3) and replace it where it fits.
3. Run the verification at the end.

Check every API claim against the **installed** `.d.ts`, never against this document or memory. This ledger names shapes, not exact signatures.

## 1. Bump the catalog plugin, then fix peer declarations

Your `@effected/*` versions come from `@effected/pnpm-plugin-effect` through `configDependencies` and `catalog:effected`. You do not edit `@effected/*` ranges by hand.

1. **Bump the plugin.** Move `@effected/pnpm-plugin-effect` in `pnpm-workspace.yaml`'s `configDependencies` to the release built on this round. Version and `+sha512` integrity move together: `pnpm view @effected/pnpm-plugin-effect@<version> dist.integrity`. That release's catalog names every touched `@effected` package at its new `0.x` minor.
2. **Reinstall from scratch:** `pnpm clean --lockfile && pnpm install`.
   - Dropping the lockfile is required. A plain install reports "Lockfile is up to date" and keeps the old versions, even after the plugin bump.
   - Check the lockfile diff: platform binaries (turbo, biome, tsgo) must still be present.
3. **Check peer declarations. This is the part you do by hand.** Peer policy is unchanged: each of your packages declares the full required peer closure of every `@effected` package it uses, recursively, as `catalog:effected` entries. This round moves that closure:
   - **`@effected/app`:** `@effected/memfs` becomes an **optional** peer (see 2.1). Drop memfs from your peers if you only declared it for `app`. Add it as a **devDependency** wherever tests use `AppTest`, because optional peers are not auto-installed.
   - **`@effected/cli`:** now depends on `@effected/engine` and `@effected/commands` as **regular** dependencies, so you don't declare them for cli. `engine` and `commands` have no `@effected` peers of their own, so cli's peer closure (env, config-file, walker, glob, github-commands) is unchanged.
   - **Every other touched package:** compare its published `peerDependencies` (`pnpm view @effected/<pkg>@<version> peerDependencies`) against what you declare. Add whatever is newly required, and remove any peer you declared only for an edge that is gone.
4. **`pnpm peers check` must come back clean,** apart from the documented toolchain occupant. Any other warning is a missing or stale peer declaration to fix in your manifests. Never silence it.

If a package pins an `@effected/*` range directly, outside `catalog:effected`, bump it by hand. On `0.x`, a caret pins the minor: `^0.14.0` does not accept `0.15.0`. Prefer moving it onto the catalog.

## 2. Breaking changes

### 2.1 `@effected/app`: the test layer moved to `@effected/app/testing`

`App.layerTest` and its option and service types left the root entry. The root no longer loads `@effected/memfs`.

```ts
// before
import { App } from "@effected/app";
App.layerTest({ ... });

// after
import { AppTest } from "@effected/app/testing";
AppTest.layer({ ... });
```

- Add `@effected/memfs` to your **devDependencies**. It is now an optional peer, so nothing installs it for you.
- `AppTest.layer`'s error channel narrowed from `AppError` to `StoreError | StoreMigrationError | CacheError`. If you named the type explicitly, update the annotation.
- The root entry now exports exactly `App`, `AppCache`, `AppConfig` and `AppStore` as runtime values.
- Find call sites: `git grep -n "App.layerTest"`.

### 2.2 `@effected/env`: `RuntimeEnv` grew, and `CiName` widened

- **`CiName` now names 40 providers.** Besides `github-actions` and `generic`, it covers std-env's CI provider set: GitLab, Buildkite, CircleCI, Azure Pipelines, Jenkins, Bitbucket, Travis, AppVeyor, Drone, TeamCity, CodeBuild, Vercel, Netlify and others. Check the installed `.d.ts` for the exact list. Names are std-env's, lower-cased with `-` (`circleci`, not std-env's `circle`).
  - **Runtime hosts are deliberately not CI.** Cloud Run, Render, Railway, Deno Deploy, StackBlitz, Stormkit, Zeabur, Codesphere and Firebase App Hosting set their marker variable in the _serving_ process, so a production server would otherwise read as CI. On those hosts `ci` is `None` unless `CI=true` is also set, in which case it is `generic`.
  - **Detection otherwise follows std-env.** One variable is enough, so a stray `JENKINS_URL` in a developer's shell reads as `jenkins`, and the audience becomes `ci`.
  - **One deliberate departure from std-env:** `CI=false`, `0`, `off` or `no` means _not_ CI, and so does a provider's own marker set to one of those (e.g. `GITHUB_ACTIONS=false`). std-env counts any non-empty value as CI. The kit keeps 0.5.0's reading so that `CI=false` still restores interactive output.
  - GitHub Actions is still checked first.
  - An exhaustive `switch`, or a `Record<CiName, …>`, stops compiling. Add the new cases, or a default.
  - A CI that used to read `generic` may now read its own name. If you persisted the value, decide whether old rows need mapping.
- **New `RuntimeEnv` fields:**
  - `session`: terminal or multiplexer session identity. It holds the source, the matched variable name, the raw id, and the tmux or screen multiplexer value.
  - `ciRun`: provider-neutral run coordinates (run id, attempt, job id, sha, ref name, runner os and arch), as raw strings.
  - `termProgram`: the raw `TERM_PROGRAM` / `TERM_PROGRAM_VERSION`, independent of the normalized `terminal.name`.

  `ciRun` is `Some` exactly when `ci` is. Coordinates come from each provider's documented variables, and every coordinate is `None` for `generic`. `runner.arch` is itself an `Option`, because some providers expose only the OS.

  Old encoded `RuntimeEnv` values still decode. The encoder now always writes the new keys, in this absent form: `"session":null,"ciRun":null,"termProgram":{"name":null,"version":null}`. So a snapshot written by the new version that names a new provider cannot be decoded by an **older** reader.
- **Existing `RuntimeEnv.make({ agent, ci, terminal })` calls still compile.** The new fields default to absent in the constructor. `layerTest` overrides accept `session`, `ciRun` and `termProgram`.
- `Option.contains(env.ci, "github-actions")` checks keep working unchanged.

### 2.3 `@effected/cli`: behaviour fixes you may see in output

- **More terminal escapes are recognized:** two-byte escapes (`ESC c`, `ESC 7`, `ESC 8`, `ESC =`, `ESC ( B`) and DCS/SOS/PM/APC strings. `Fmt.width`, `Fmt.truncate` and `Fmt.sanitize` used to count or keep a stray character there. Snapshot tests over such text can change. A lone `ESC` followed by an ordinary lowercase letter is still left alone.
- **`env.displayPath` now reaches all output:** `Doc.print`, live-view frames (`DocView`), a live view's `final` document and `CliUi.context`, not only the failure report. If you passed `displayPath` and expected it to affect the failure report alone, paths in normal output now change too. `UiContextValue` gains an optional `displayPath`.
- **`FailureDetails` gained a required `exitCode`.** This is a type break for any code that builds a `FailureDetails` object literal itself (usually only tests). A `render` hook that needs the error's tag reads `_tag` off the `error` argument it already receives.
- **A failure whose `_tag` getter throws is now drawn as a failure with no tag,** instead of throwing out of `CliFailure.toDoc`.
- **cli now depends on engine.** `MainOptions.distribution` provides engine's `CurrentDistribution` around the program.

## 3. New API: replace hand-rolled code

For each item, search your repo for the hand-rolled pattern. Replace it only where the kit's semantics match, and keep a local version wherever you persisted a value the kit would now compute differently.

### `@effected/env`

- **`ShellExports.parseResult(text)` → `Result<Record<string, string>, ShellExportsError>`**, with the Effect form `ShellExports.parse(text)` and the writer `ShellExports.format(vars)`. Parse a file of literal `export NAME=VALUE` lines, the form `printf 'export %s=%q\n'` writes. Use it for files like Claude Code's session-env, and for anything written by `format`. Sync callers, such as Vitest `globalSetup`, use `parseResult`.
  - **What it accepts:**
    - blank lines and `#` comment lines;
    - one `export NAME=WORD` per statement;
    - values built from literal text, `\x` escapes, `'…'`, `"…"` (with no `$` or backtick inside) and `$'…'` ANSI-C escapes, with UTF-8 byte escapes decoded.
  - **Anything else rejects the whole file**, with `ShellExportsError { line, column, reason }` pointing at the first offending character. You get no partial variables. That includes:
    - any expansion or glob;
    - `eval`, a conditional, `unset`, `declare`, `A+=`;
    - a raw control character such as a CR (so a CRLF file is rejected);
    - a `\u` escape;
    - a bash special or readonly variable (`UID`, `RANDOM`, `_`, `PWD`, `IFS`, `BASH_*`, …).

    It is not a shell interpreter, and that is deliberate: once an unknown statement exists, no earlier variable can be trusted.
  - `format` emits exactly this dialect. It throws a `RangeError` on a NUL, a lone surrogate, an invalid name or a special variable.
  - **Reading a file? Use `ShellExports.parseBytesResult(bytes)`.** macOS `/bin/bash` 3.2's `%q` writes raw UTF-8 bytes mixed with octal escapes inside `$'…'`. Decoding that file to a string first breaks those characters. Each `$'…'` must decode as UTF-8 on its own.
  - bash 3.2 writes `~` unquoted, and bash itself expands it, so such a value is rejected.
  - Search: `export` line parsers, `session-env`, hand-written `unquote`.
- **`RuntimeEnv.session`, `ciRun`, `termProgram`** (see 2.2). Search: reads of `TMUX_PANE`, `WT_SESSION`, `KITTY_WINDOW_ID`, `TERM_SESSION_ID`, `GITHUB_RUN_ID`, `BUILDKITE_*`, `CIRCLE_*`, `CI_JOB_ID`, `TERM_PROGRAM`.
- The GitHub step-summary path stays in `@effected/github-actions` (`ActionOutputs.summary`). env does not own it.

### `@effected/git`

- **`Git.treeIdentity(cwd)` → `Option<TreeIdentity>`:** the physical toplevel plus the common dir, in one git call. `TreeIdentity.relation(a, b)` returns `"same-tree" | "sibling-worktree" | "different-repo"`. Search: hand-paired `repoRoot` + `commonDir`, worktree-mismatch checks.
  - **Drop any `realpath` over git's path output.** git already answers physical, case-correct paths. Mixing Node realpath output with git output is wrong on Windows.
- **`Git.upstream(cwd)` → `Option<UpstreamBranch>`:** fields `ref`, `name`, `gone`, `ahead` and `behind`. `name` is byte-identical to `rev-parse --abbrev-ref @{upstream}`. A deleted upstream reports `gone: true` instead of failing as an unknown ref. Search: `@{upstream}` spawns.
- **`GitRemote.parse(raw)` → `Option<GitRemoteForm>`:** a pure parser into four forms, `GitRemoteUrl | GitRemoteScp | GitRemotePath | GitRemoteTransport`. It returns `None` only for blank input.
  - **Verbatim parts.** It does no lowercasing, no shorthand expansion and no trimming, so trim first if your source might carry whitespace (`Git.remoteUrl` already trims).
  - **Classification follows git 2.56**, checked by probe:
    - `<helper>::<address>` (for example `persistent::https://…`) is a `GitRemoteTransport`, with its address parsed once;
    - any `://` makes a URL;
    - otherwise a `:` before any `/` makes scp, so a Windows drive letter like `C:/x` parses as scp.
  - **Password contract.** A URL's password is never retained, in any form. URL userinfo runs to the **last** `@`, which is deliberately stricter than git's own credential parser, so a password containing `/`, `@` or `?` cannot leak. The cost: an `@` in a URL path moves the text before it into `user`.
  - **Not safe to log as-is.** Credentials in other positions are kept verbatim: a token used as the URL user, a token in a query string, and anything git itself reads as an scp path. Log `GitRemote.format(GitRemote.redact(form))`. `redact` masks the user and the query.
  - **Helpers:** `GitRemote.format` re-renders the parts, and for password-free input `format(parse(x)) === x`. `GitRemote.repositoryPath` strips the leading `/`, a trailing `/` and `.git`.
  - **Redaction in `GitCommand`:** git commands' redacted argument lists now go through the same parser. A URL such as `https://host:8080/a@b` is over-redacted to `https://<redacted>@b`, and a query string in a URL argument is masked. Search: remote-URL regexes, `canonicalizeGitUrl`-style helpers. **If you derive a persisted key from a remote URL,** compose it from the parts and compare it against your stored keys before switching.
- `Git.currentBranch` returns `None` on a detached HEAD. This was already the contract; it is now stated explicitly.

### `@effected/config-file`

- **`ConfigResolver.upwardWalk({ ceiling })`:** an optional physical ceiling (`string`) that goes through `Walker.ascendWithin`. It can't be combined with `stopAt`, whose lexical meaning is unchanged. If you pass neither, the walk goes to the filesystem root. Use `ceiling` when the bound comes from git, for example a repo root read with `git.repoRoot(cwd)`. Search: hand-rolled upward config searches bounded by a repo root.

### `@effected/store`

- **`Store.fromMigratorRecord(record)`:** converts an effect/sql `Migrator.fromRecord`-style record (`"0001_initial"` keys) into `StoreMigration`s, with key parsing identical to core's.
- **`Store.migrateOnce(options)`:** one migration run per database per process, shared across independent runtimes. It is keyed on the real path of the parent directory plus the migration set. A failed run is not cached, so the next call retries.
  - **It deduplicates; it is not a lock.** A success stays cached for the life of the process, even if the database file is deleted and recreated. Concurrent openers in other processes are already safe through the store's per-migration transaction re-check.
  - `:memory:` and `file:` URIs are wiring errors (defects). Search: process-global "migration promise" caches.
- **`Store.layerSqlite({ onConnect })` runs once per connection,** which is once per layer build. Move per-connection pragmas (`busy_timeout`, `foreign_keys`) out of migrations and into it.

### `@effected/xdg`

- **`Xdg.layerFromEnv(record)`:** an Xdg layer built from an env record. It is fresh per call, so two in one graph do not share a build. If you have a `ConfigProvider` instead, provide it beneath `Xdg.layer`: `Layer.provide(Xdg.layer, ConfigProvider.layer(p))`. Search: `Xdg.layer.pipe(Layer.provide(ConfigProvider.layer(...)))`. That pattern memoizes the first build.
- **`AppDirs.segment(name)` → `Result<string, AppDirsSegmentError>`:** a filesystem-safe path segment. It maps `@org/pkg` to `@org__pkg` and rejects `""`, `.` and `..`. Use it for any runtime-supplied name that becomes a directory. Search: hand-written workspace-key normalizers, and `join(dataRoot, userValue)`.
- The kit does **not** substitute `USERPROFILE` for an empty `HOME` on posix. On win32 it already reads `USERPROFILE` first.

### `@effected/commands`

- **`PrebuiltBinary.resolveSync(spec, host)` → `Result<ResolvedPrebuilt, PrebuiltBinaryError>`:** resolves the platform-specific package from `optionalDependencies`, in the esbuild, biome and turbo style.
  - **Lookup:** candidate keys are tried in order (the musl or glibc key first, then the generic one), and the first that resolves wins.
  - **Failure reasons:** `unsupportedTarget`, `notInstalled`, `binaryMissing` (the package is installed but the binary path is absent) and `unresolvable`.
  - **Node host:** `./node-sync` provides `nodePrebuiltHost(import.meta.url)`. The anchor must be the module of the package that declares the optionalDependencies.
- **`RunOnce`:** a cross-process run-once lock.
  - It has two drivers: a sync one (`runSync` / `commandSync`, with hosts from `./node-sync`) and an Effect one (`RunOnce.run`). The Effect driver needs `FileSystem` and `ProcessLiveness` in `R`, provided as `ProcessLiveness.layerFrom(nodeProcessLiveness)`.
  - The lock holds the owner's pid, hostname and nonce. Stale-owner takeover goes through a breaker file.
  - A "done" marker is trusted only by waiters that saw that run hold the lock. A re-run started after the previous one finished always runs again.
  - A wait timeout falls through to running without the lock (`RanUnserialized`).
  - Builds run from an argv, not a shell string, and output is captured through files, so a chatty build never hits ENOBUFS.
  - **Locks on a shared filesystem:** for a lock shared across hosts, `staleMs` must exceed your longest run.
  - Search: lockfile helpers around a pre-build step in `globalSetup`.
- **`LocalExec.parse(argv)` → `Option<{ launcher, kind, binary, rest }>`:** the inverse of `LocalExec.prefixes`. It recognizes `npx --no --`, `bun x --no-install`, `pnpm exec`, `dlx` and the rest. Tokenizing a command string is your job. Search: regexes that match `npx|pnpx|bunx … <tool>`.
- **`ModuleResolution` (`./node-sync`):** resolves a package from a given root's `node_modules` instead of the caller's own (`resolve(specifier, { from })`), detects a stale install (`isStale`), and loads through an injectable importer (`load`). Search: `createRequire(join(root, "x.js"))`.

### `@effected/walker`

- **`boundaries` option:** marker file names, such as `package.json`, that stop descent into nested packages.
- **`descendEntries`:** walk results that carry the stat info the walk already read, at no extra syscall cost.
- **Sync walker binding:** `descendSync` / `descendEntriesSync` share the Effect form's result types (`DescendResult`, `DescendEntry`), and an entry's stat lives on `info`. Node bindings come from `@effected/walker/node-sync`. A memfs handle satisfies the sync port directly; memfs's sync interface gained `realPath`.
- **Brace patterns now match.** A pattern whose only magic is a brace group (`src/{a,b}.test.ts`) used to return nothing. Each brace alternative is now walked from its own root (`GlobPattern.enumerationRoots`), so `packages/{a,b}/src/*.ts` reads only the two `src` directories.
- **Symlinks (behaviour change):** with `followSymlinks` off (the default), no symlinked directory is entered, and that now includes a symlinked walk base and a symlinked directory on a literal pattern's path. Both used to be entered. A literal pattern that is itself a symlink to a file still matches. With `followSymlinks: true`, a cycle guard stops link loops.

### `@effected/cli`

- **`Fmt`:** new `pad` (width-aware, so colour-safe), `stripAnsi`, `isEscapeOnly`, `ranges` (`[1,2,3,5]` → `"1-3,5"`), `describe` (any value to a string, never throws) and `causeMessage`.
- **`CliUi.routeStream`:** routes a foreign stream (a child's stderr, a test runner's output) line by line above a live view.
- **`CliUi.liveDetached`:** hosts a live view from code that is not built on Effect, such as a reporter or a bundler plugin. Only call `PubSub.shutdown` after `close()` resolves.
  - `render` may be an Effect that produces the render function. It runs under the same env layer, so it can read `CliLinks` or `TerminalEnv` without building that layer twice.
- **`CliLog.parseLevel(text)` → `Option<LogLevel>`:** the parser behind the log-level env var.
  - An inherited key such as `constructor` is now rejected, where it used to return a bogus level.
- **`CliFailure.toDoc` never throws.** An error whose `stack`, `message`, `cause` or `issue` getter throws renders with that part missing.
- **`CliRuntime.main`:**
  - `exitCodes` maps an error tag to an exit code.
  - `distribution` appends the carrier to `--version` without replacing a coloured or custom formatter, and provides `CurrentDistribution`. For a hand-wired program, engine exports `withDistribution(d)` and `withDistributionVersion(d)(formatVersion)`.
  - `displayPath: { relativeTo: root }`.
- **`CliFormat`:** a shared `--format` flag paired with `Doc.print`.

### `@effected/mcp` and `@effected/engine`

- **`@effected/mcp/node` `StdioCapture`:** keeps an in-process library's stdout off the JSON-RPC wire for one async context. Writes from callbacks registered outside the capture still escape.
- **`ToolOutcome`:** the expected-failure envelope `{ ok: false, error: { _tag, message, remediation, … } }`, plus `catchAsEnvelope`. It complements `ToolRefusal`, which stays for wrong calls.
- **`ToolReplay.wrap`:** idempotent replay over core `KeyValueStore`, which you provide in `R`. It never caches an `ok: false` result.
  - Build each replayable success member with `ToolReplay.success(schema)`, so the replay marker is declared. That drops the struct's own `.check()` refinements, so apply your checks to the result.
  - The key must identify the whole request. A hit compares neither params nor schema version, so include a digest of any params that can vary.
  - `ToolOutcome.isFailure(value)` tests for the `ok: false` envelope.
  - **Bring your own store:** pass `store: { get, set }` to `wrap`, and `KeyValueStore` leaves `R`. A `KeyValueStore` value satisfies that port as-is.
- **`ToolOutcome.envelope(success, errors, { identifier, description })`:** `identifier` names the failure member, which is then served under `$defs/<identifier>`. The envelope's fields now carry default descriptions in the served JSON Schema, an additive change to every `outputSchema` that uses these helpers.
- **`StdioCapture.nullWritable()`:** a real null `Writable` that can be a pipe target and accepts `setMaxListeners`. `StdioCapture.discard` is write-only and can't stand in for one.
- **`Exclusive.promise({ try, catch, abandon: true })`:** use `abandon: true` for a promise that ignores its abort signal. The default awaits the promise after aborting, which hangs forever on such a promise.
- **`InjectCrash`** names `McpGuard.parseInjectCrash`'s return type.
- **engine `Exclusive`:** a one-permit, uninterruptible-once-started handler with a required timeout. **`ProcessScope.chdir` / `.env`** restore process state on every exit.
- **`LaunchContext.usable` / `resolve`:** the shared guard that rejects empty and unsubstituted `${…}` values.

## 4. Verify

1. `pnpm install` from scratch resolves every `@effected/*` package to the plugin catalog's new minors, with no `file:` overrides left. Verify this by resolution, not by reading a manifest: the installed package exports a new symbol.
2. Typecheck every package (`tsc --noEmit` or the repo's `types:check`).
3. Build, then run the full test suite.
4. `pnpm peers check` is clean.
5. For every value you persist and now compute through a kit API, compare new output against stored data before you ship.

Update READMEs, docs and agent context files that show the old shapes. Leave CHANGELOGs alone.
