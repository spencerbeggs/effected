# Upgrade this project to Effect 4.0.7 and the 1.0 backlog drain of `@effected`

You are moving this repository to Effect `4.0.7`, from `4.0.6` or earlier. You are also moving to the `@effected/*` release built on it, which carries two bodies of work: the Effect 4.0.7 advance (effected PR #1145) and the 1.0 backlog drain (the effected PR that releases this round). Every kit package takes a `0.x` minor, and one new package, `@effected/source`, ships for the first time.

It is a breaking round. Effect 4.0.7 changes behaviour your own code may depend on, and so does `@effected/cli`'s handling of it. On top of that, the drain changes API or behaviour in about a third of the kit: `walker`, `cli`, `config-file`, `github`, `github-actions`, `npm`, `runtimes`, `jwt`, `package-json`, `markdown`, `memfs`, `mcp`, `lsp` and `yaml`, plus position fixes in `jsonc` and `toml`. Most of those are typed breaks the compiler finds. The rest are behaviour changes, several of them security fixes, that only your tests will show. The remaining packages carry the Effect advance alone.

Work in this order:

1. Repin vendored Effect source, install `@effected/pnpm-plugin-effect@0.19.0` and reinstall (steps 1–2). The plugin is how you get the new versions: it carries every `@effected/*` minor and Effect 4.0.7 in its catalogs, so installing it is the whole bump.
2. Find the Effect 4.0.7 changes in your code (step 3), then the kit's from the advance (step 4) and from the drain (step 5). Step 6 lists the security fixes, so you know what changes under you.
3. Get the build and the full test suite green (step 8).
4. **Only then**, adopt the new surfaces in step 7, adopt the fixes your own tracking tickets wait on (step 9), and align your code on the kit and on Effect (step 10).
5. Run the verification again.

Check every API claim against the **installed** `.d.ts` or the vendored Effect source, never against this document or memory. This ledger names shapes, not exact signatures. Where it states a behaviour, that behaviour was probed on both 4.0.6 and 4.0.7, but your code is the authority on what you depend on: probe before you rely on it.

## Versions in this release

Every package takes a minor. Confirm each with `pnpm view @effected/<pkg> version` before you rely on it.

| Minor (every package) |
| --- |
| app 0.29.0, cli 0.24.0, commands 0.18.0, config-file 0.22.0, crypto 0.3.0, engine 0.10.0, env 0.7.0, git 0.27.0, github 0.26.0, github-actions 0.29.0, github-commands 0.7.0, github-references 0.12.0, glob 0.16.0, images 0.7.0, jsonc 0.21.0, jsonl 0.16.0, jwt 0.7.0, lockfiles 0.20.0, lsp 0.6.0, markdown 0.24.0, mcp 0.11.0, memfs 0.21.0, npm 0.28.0, oidc 0.2.0, package-json 0.27.0, runtimes 0.16.0, sbom 0.18.0, schema-org 0.12.0, schemastore 0.27.0, schemastore-cli 0.27.0, semver 0.19.0, spdx 0.17.0, store 0.21.0, templates 0.15.0, toml 0.17.0, tsconfig-json 0.18.0, walker 0.22.0, webhooks 0.2.0, workspaces 0.40.0, xdg 0.17.0, yaml 0.26.0 |

| New package |
| --- |
| source 0.1.0 |

The catalog plugin `@effected/pnpm-plugin-effect` is 0.19.0. The effected agent plugin (`@effected/ai-plugin`) is 0.44.0; its skills now describe 4.0.7 behaviour, so update it too.

## 1. Repin vendored Effect source

If this repository vendors Effect source (usually `.repos/effect`), repin it before you touch code. It is the authority on what v4 exports, and it must agree with the installed version:

```bash
savvy repos pin effect effect@4.0.7
```

Or use the `repos_manage` MCP tool with `action: "pin"`, `name: "effect"`, `ref: "effect@4.0.7"`. Review any `staleNoteIds` it reports. Commit the pin together with the lockfile move in step 2, never separately. Never write under `.repos/` by hand, and never run git there. If the project does not vendor Effect, skip this step.

## 2. Bump the catalog plugin and reinstall

**Install `@effected/pnpm-plugin-effect@0.19.0` to get the new versions.** Nothing else moves them: your `@effected/*` versions come from `@effected/pnpm-plugin-effect` through `configDependencies` and `catalog:effected`, and so do `catalog:effect`'s Effect versions. You do not edit those ranges by hand.

1. **Bump the plugin** in `pnpm-workspace.yaml`'s `configDependencies` to 0.19.0. Version and `+sha512` integrity move together: `pnpm view @effected/pnpm-plugin-effect@0.19.0 dist.integrity`.
   - Its `effect` catalog names `effect` and every `@effect/*` package at `^4.0.7`.
   - It derives one override per Effect family member that pins `effect` and every satellite to `4.0.7` across your whole graph. Never hand-write those pins; they move with the catalog.
   - **Coming from an older plugin, your `@effected` versions jump several minors at once.** Every intermediate release's breaks apply too: read each package's CHANGELOG between your old version and the new one, and the earlier upgrade prompts beside this one.
2. **Reinstall from scratch:** `pnpm clean --lockfile && pnpm install`. A plain install reports "Lockfile is up to date" and keeps the old versions.
   - A fresh Effect release can be refused by a release-age gate (pnpm `minimumReleaseAge`, yarn berry `npmMinimalAgeGate`). Add `effect` and `@effect/*` to the exclude list, or wait it out.
3. **Check the lockfile diff:**
   - `effect@4.0.7` is the only `effect` your importers resolve.
   - Platform binaries (turbo, biome, tsgo) are still present. Count them before and after: `grep -cE "^  '?@?(turbo|biomejs/cli|typescript/native-preview)[^:]*(darwin|linux|win32)" pnpm-lock.yaml`.
4. **New package and new edges.** `@effected/source` is new: source-text positions as plain values, with no runtime dependencies. Several packages gained a **regular** dependency on a kit package, so you declare nothing for them:
   - `npm`, `runtimes`, `jwt` and `github` depend on `@effected/crypto`.
   - `jsonc`, `toml`, `yaml` and `markdown` depend on `@effected/source`. `yaml` and `markdown` re-export `LineIndex`, `SourceIndex` and the position shapes, so you need no second import to name them there.

   Add `@effected/source` (through `catalog:effected`) only where your own code imports it directly.
5. **Peers.** No kit package's peer closure moves this round; the edges above are regular dependencies. Still compare each package you use (`pnpm view @effected/<pkg>@<version> peerDependencies`) against what you declare, and run `pnpm peers check`. It must come back clean apart from the documented toolchain occupant. Never silence a warning.

If a package pins an `@effected/*` range directly, outside `catalog:effected`, bump it by hand: on `0.x` a caret pins the minor, so `^0.23.0` does not accept `0.24.0`. Prefer moving it onto the catalog.

## 3. Find the Effect 4.0.7 changes in your code

None of these is a rename a regex can make safely. Find the call sites, then judge each one against the vendored source and a probe.

```bash
git grep -nE 'Exit\.has(Fails|Dies|Interrupts)|AsyncResult\.isInterrupted|withFallbackPrompt|CliError\.userMessage|Schedule\.fibonacci|Schema\.Record|MutableRef|Ref\.make|ArrayBuffer|toStandardJSONSchemaV1|fromJsonString|toJsonSchemaDocument'
```

### Type and runtime changes

- **`Exit.hasFails`, `hasDies`, `hasInterrupts` and `AsyncResult.isInterrupted` no longer narrow.** They return a plain `boolean`, like the matching `Cause` checks. Runtime answers are unchanged; code that relied on the narrowing in an `else` branch stops compiling. Use `Exit.isFailure` and friends where you need a type guard.
- **`Ref` and `MutableRef` compare by reference.** Two distinct refs with equal contents are no longer `Equal.equals`, and no longer share a `HashSet` or `HashMap` key. Code that deduplicated refs by content gets every instance.
- **`ArrayBuffer` and `SharedArrayBuffer` compare and hash by their bytes.** Before, any two buffers of the same length were equal.
- **`Schedule.fibonacci` repeats its initial delay.** For a 100 ms base the delays are 100, 100, 200, 300, 500 ms, not 100, 200, 300, 500, 800. Every retry after the first comes sooner. Recheck any timing test or total-backoff budget built on it.
- **`Schema.Record` with an optional value throws at construction.** `Schema.Record(Schema.String, Schema.optional(X))` (or `optionalKey`) is rejected when the schema is built, and the message says to use `Schema.UndefinedOr`. Because it throws at module load, your test run will find every site. `Schema.Record` with literal keys and an optional value still works.
- **`Schema.Record` accepts `Schema.Enum` keys.** Each member value becomes a required property. Before, this threw at construction.
- **`Stream.run`, `Stream.peel` and `Stream.aggregate`/`aggregateWithin` keep upstream failures out of sink error handlers.** An upstream failure now reaches the caller unchanged instead of being caught or remapped by the sink. Recheck any sink whose error handler was quietly recovering upstream failures.
- **`Stream.groupBy`/`groupByKey` groups end when the upstream ends or fails, and `Stream.grouped`/`rechunk` no longer drop buffered elements on an upstream failure.**
- **`Effect.sync` and `Effect.suspend` defects keep their throw location.** `Cause.pretty` now prints the throwing frame, and V8 shows the thunk's frame anonymously (`at file:L:C`, no parentheses). Exact-text and snapshot tests over a rendered cause, or a regex that expects `(file:L:C)`, change.
- **`ChildProcessSpawner` helpers no longer hang when a command fills a pipe they don't read.** `exitCode` drains stdout and stderr, and `string`/`lines`/`stream*` drain the stream they don't return. If you drained a pipe by hand only to avoid that hang, it is now redundant. On a raw handle, an output sink only receives data while that stream is consumed, so keep reading both pipes concurrently there.

### `effect/cli`

- **`withFallbackPrompt` skips the fallback entirely when `TerminalCapabilities.canPrompt` is `false`.** It then fails with the original missing-parameter error, exit 64. `canPrompt` defaults to a read of `process` (stdin and stdout both TTYs). So a hand-wired CLI whose fallback returns a default for a non-interactive run (a piped agent or CI run) **no longer gets that default**. Under `@effected/cli` this is handled for you (step 4). In a CLI that doesn't use the kit's layers, provide `TerminalCapabilities` yourself, or move the default to `Flag.withDefault`.
- **A repeated single-valued flag is a usage error.** `--tag a --tag b` on a `Flag.String` fails with an invalid-value error ("2 occurrences"), where it used to keep the first. Use `Flag.atLeast`, `atMost` or `between` for a flag that may repeat.
- **Core renders a handler failure that carries a string `[CliError.userMessage]`.** `Command.runWith` prints the message, marks the error `Runtime.errorReported: false`, and re-fails with it, tag kept. Under `@effected/cli` see step 4; a hand-wired reporter now double-prints such errors.
- **An invalid global flag value shows the command's help** instead of a raw parse error.

### JSON Schema output: check what you publish

If you publish, commit or snapshot JSON Schema generated from Effect schemas, regenerate it and diff it before you ship:

- **`Schema.fromJsonString(S)` adds a `contentSchema`** beside `contentMediaType`.
- **`Schema.toStandardJSONSchemaV1` adds the root `$schema`** for draft-07 and 2020-12.
- **`Schema.toJsonSchemaDocument` no longer throws on named template-literal segments**, and emits corrected schemas for segment checks, exclusive unions and empty unions.

### `effect/ai` MCP servers

- **`@effect/rpc/*` methods from a client are ordinary JSON-RPC.** A notification such as `@effect/rpc/Eof` is ignored and no longer stops a stdio server; a request with that method is answered `-32601` (`Method not found: @effect/rpc/Eof`). The server writes no `@effect/rpc/Pong` to stdout. If you filtered these frames off stdin yourself, that filter is now redundant.
- **Method-not-found, invalid-params and invalid-request errors no longer carry an internal `_tag`.** Strict clients rejected those responses before. Update any test that asserted the old shape.

### Smaller fixes that can change output

- `HttpClientError` reasons no longer expose request headers, query parameters or bodies when serialized or inspected, and `HttpServerError` messages carry only the request path. Logs and snapshots of those errors change.
- AWS SigV4 query parameters (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`) are redacted by default.
- `Data.taggedEnum` constructors emit smaller declarations (`Data.TaggedEnum.Constructor`). API reports over them change.

## 4. The kit's changes from the Effect advance

### `@effected/cli`

- **Fallback prompts answer `otherwise` again in non-interactive runs.** Because of the core change above, `CliPrompt.fallback` and `CliUi.fallback` would never have run in a piped run. `CliInteractive.layer` and `CliInteractive.layerTest` now hold core's `canPrompt` open, because the kit's own interactivity decision governs (and `CliPrompt.gateTerminal` still quits any prompt instantly when no one can answer). `CliEnv.layer` installs core's `TerminalCapabilities` from the kit's `TerminalEnv`.
  - **If you worked around this** on a pre-release build by providing `TerminalCapabilities` yourself, remove it.
  - **A `TerminalCapabilities` with `canPrompt: false` provided inside your program bypasses the kit's fallbacks**, and they fail as missing.
  - **Providing `CliInteractive` with a raw `Effect.provideService`**, without `CliInteractive.layer` or `layerTest`, keeps core's gate, and a piped run fails as missing. Use the layers.
- **Core's own help colour follows the kit's colour rule** under `CliEnv.layer`, where `FORCE_COLOR` beats `NO_COLOR`. It only matters when no `CliOutput.Formatter` is installed; under `CliRuntime.main` with `env` the kit's formatter already governs.
- **A handler failure carrying `[CliError.userMessage]` is reported once.** Core prints it; `CliRuntime.main` and `reportFailures` skip it, and it exits as a **handler failure**: its `exitCodes` entry by tag, then `exitCode`, then `1`. A rendered `CliError.UserError` still exits with the usage code. Use the annotation on a domain error to keep its tag and its `exitCodes` entry; use `UserError` for a usage error.
  - **Trap:** `reportFailures` reads only the message and the reported mark, so an annotated error you mark with `CliRuntime.reported` and never print through `Command.runWith` is skipped too, and the run exits silently. Mark an error without the annotation, or leave it unmarked, if your program has not printed it.
- **`helpOnUsageError: "stderr"` routes through core's `CliOutput.Presenter`.** A usage error's help and errors both go to stderr. `--help`, a bare group invocation and `--version` stay on stdout.
  - A `CliOutput.Formatter` or `Console` provided inside your program is now honoured; before, the help stayed on stdout there.
  - A `CliOutput.Presenter` provided inside your program replaces the routing.
  - Under `renderErrors: false` the help stays on stdout, as before.

### `@effected/mcp`

- `McpStdio.layer`'s stdin guard no longer intercepts `@effect/rpc/*` frames; core handles them (step 3). The visible change is the reply text to such a request: `-32601` with `Method not found: @effect/rpc/Eof` rather than `Method not found`. The rest of the guard is unchanged: core still sends no reply to an unparseable or non-JSON-RPC line, and the guard still does.

### `@effected/env`

- **New: `TerminalEnv.colorLevelFrom(env, isTTY)`**, a pure colour reader over an env record and a TTY flag, with no `Stdio` and no runtime. It applies the same rule as `TerminalEnv.layer`. Use it in sync code that decides colour, such as a bundler or a reporter. Search: a production `Stdio.layerTest({ stdoutIsTerminal })` stand-in built only to read the colour level, and hand-written `FORCE_COLOR`/`NO_COLOR` logic.
- **New: `TerminalEnv.capabilities(terminal, term?)`** projects a `TerminalEnv` snapshot into core's `TerminalCapabilities` value. `TERM=dumb` clears animation and prompting, not colour.
- env imports `effect/cli` type-only, so its root never loads that barrel at runtime. The layer that installs `TerminalCapabilities` lives in `@effected/cli`.

### `@effected/pnpm-plugin-effect`

- If you run the effected repo's catalog tooling against your own config, rolldown-pnpm-config 2.2.0 takes `--format json`, not `--json`.

## 5. Breaking changes in the backlog drain

Find the call sites first, then judge each against the installed `.d.ts`:

```bash
git grep -nE 'WalkerSyncPath|confineReal|descend\(|RunResult|exitCode|SpawnedBin|CliFormat|saveTarget|AppliedSettings|RestExtras|baseUrl|repositoryPatch|RepositoryPatch|layerFixture|DeploymentEnvironment|uploadAsset|NpmRegistry|PackageTarball|ExportEntry|PackageFileTarget|lineIndex|NodeDirectorySeed|LspUri|McpHarness|\.cause\b'
```

### 5.1 `@effected/walker`: a wider sync port, absolute cwds, stricter confinement

- **`WalkerSyncPath` has five members:** `sep`, `join`, `dirname`, `resolve` and `isAbsolute`. It used to need only `join`. `node:path` already satisfies it; a hand-written double must add the other four. The compiler finds every one.
- **A relative `descend` `cwd` now dies** in the Effect form and throws in the sync form. Pass an absolute path, for example `path.resolve(cwd)`.
- **`confineReal` refuses every dangling symlink,** including one that points back inside the root, because its target cannot be checked. A test that confined a path through a dangling link inside the root now sees a refusal.
- **Win32 drive-less rooted paths (`\repo`, `/repo`) are refused** in the `descend` cwd, in `confineReal`'s base and candidate, in `stopAt`, and in the `ascendWithin` ceiling. They used to be read as inside the current drive's root. Pass a path with its drive.

### 5.2 `@effected/cli`: `CliTest` exit codes, and no `--json`

- **`CliTest`'s `RunResult.exitCode` is `number | null`, and `RunResult` gains `signal`.** A child killed by a signal reports `exitCode: null` with the signal named. `SpawnedBin.exitCode` is `Effect<number | null>` and no longer fails after the default kill. Narrow on `null` wherever you compare an exit code; the compiler finds the arithmetic and `number`-typed sites, not a loose `===` against a literal.
- **`RunOptions.forceKillAfter`** (default 2 seconds) now escalates to SIGKILL for a child that ignores SIGTERM. A test that relied on a stuck child hanging until its own timeout now ends sooner.
- **`CliFormat.flag` offers `--format` only. A retired `--json` is not supported.** If your CLI still accepts `--json`, keep your own hidden flag and map it to the `json` format yourself, for example a `Flag.Boolean("json")` passed through `Flag.withHidden`, and print through `CliFormat.printJson` (step 7) when it is set.
- `Fmt.describe` and `Fmt.causeMessage` now delegate to `@effected/engine`'s `ErrorText`. Their output is unchanged. A copy of them you kept locally should move to `ErrorText`.

### 5.3 `@effected/config-file`: `saveTarget` defaults by strategy

- **With `saveTarget` unset, `save` and `update` under a `firstMatch` strategy now write to the discovered file**, the highest-priority file the resolver chain found, falling back to `defaultPath`. They used to write to the default path. Under `layeredMerge` and custom strategies the target is still the default path.
- **To keep the old target under `firstMatch`, pin `saveTarget: "default"`.** Decide per config: writing back to the file the user actually has is usually what you want, but a test that asserted the default path changes.
- **`@effected/app`'s `AppConfig` is unaffected.** It passes `saveTarget` through and pins `"default"`.

### 5.4 `@effected/github`: settings, transport and test doubles

- **`AppliedSettings.unverified` is required.** Test doubles that build `AppliedSettings` literals must add it.
- **`RestExtras.baseUrl` is removed**, and `Rest.Params` and `requestDecoded` params forbid `baseUrl`. Point the client at another host through its configuration instead.
- **The raw `request`, `requestDecoded`, `paginate` and `paginateStream` refuse `baseUrl`, `url`, `request` and `method` params,** and any route that resolves off the configured origin. A top-level `url` body field must now go in `data`. A cross-origin pagination `Link` header or continuation fails as rejected instead of truncating the result.
- **`RepositoryPatch` drops the `RequestExtras` transport keys** (`headers`, `mediaType`, `baseUrl`).
- **`repositoryPatch` throws a `RangeError`** for a reserved name or `__proto__`, and `applySettings` reports one in `ignored`. Settings now travel as octokit's `data` body.
- **`DeploymentEnvironment.upsert` takes its configuration in the PUT body only.** An `owner` or `repo` in the config now dies instead of silently overriding the target.
- **`uploadAsset` uses a private channel:** a spread client that overrides `requestDecoded` no longer sees uploads. A hand-built `ReleaseInfo` with an empty, relative or foreign `uploadUrl` now fails as rejected. On GitHub Enterprise Server the upload host is derived from the configured base.
- **GraphQL variables named `query`, `method` or `url` are sent as variables,** in the POST body. The abort signal now reaches GraphQL calls.
- **The test doubles changed:**
  - `makeTest`, `layerTest` and `layerFixture` refuse the same request options and any route off `api.github.com`, even in suites that simulate GHES. Refused calls are not recorded in `fixtures.requested`.
  - `layerFixture` records a repository PATCH as `{ owner, repo, data: {...} }`, not a flat object. Update assertions over `fixtures.requested`.

### 5.5 `@effected/npm`: redirects and credential transport

- **`NpmRegistry` and `PackageTarball` follow redirects** (at most 10). A client that did not follow used to fail a 302; code that caught that failure to follow by hand can drop it.
- **Credentials are only sent over https,** or over http when the registry for that host is configured as http. Inline key and cert values and URL userinfo count as secrets. A private registry you reach over plain http without configuring it as http now gets no credential.
- **`credentialFor` matches only the request URL's own host, port and path,** so a token never follows a scope, a lookalike host, another port or a CDN URL.

### 5.6 `@effected/package-json`: decoded export paths

- **`PackageFileTarget.path` and `ExportEntry.path` are percent-decoded,** as Node resolves them: `./dist/a%20b.js` gives `a b.js`. Types targets stay as written, because TypeScript does not decode.
- **A raw `?`, `#` or NUL in a target is refused,** which is stricter than Node.
- If you join `.path` onto a directory or compare it to a file listing, recheck any package with encoded characters in its targets.

### 5.7 `@effected/markdown`: `lineIndex` is a `SourceIndex`

- **`MarkdownDocument.lineIndex` is typed as the structural `SourceIndex` interface** from `@effected/source`. Annotate with `SourceIndex`, not `LineIndex`. markdown re-exports both.

### 5.8 Positions in `jsonc`, `toml`, `yaml` and `markdown`

- Diagnostic and token positions now come from `@effected/source`. That fixes a `character` of `-1` at the `\n` of a `\r\n`. Snapshots of positions in CRLF input change; delete any workaround that clamped a `-1`.

### 5.9 `@effected/yaml`: line breaks and lint fixes

- **A bare CR now breaks a line** in the lexer and composer, so a bare-CR document parses like its LF twin. `YamlToken` positions and lint lines follow the LSP rule (LF, CRLF, bare CR), and diagnostics no longer count LS or PS as line breaks.
- **A CRLF inside a single-quoted scalar no longer leaves a `\r`,** and a root block scalar with an indent indicator after `---` decodes as it does without the marker. Decoded values can change.
- **Lint fixes no longer change a document's value.** `colon-spacing` and `hyphen-spacing` decline fixes that would restructure content or move it across a later column; the issue is still reported. `trailing-spaces`, `empty-lines` and `comments-spacing` no longer report inside composed scalars. A test that counted lint issues or applied fixes over such content changes.

### 5.10 `@effected/memfs`: seed link refusal

- **`NodeDirectorySeed` refuses a symlink that leaves and re-enters the fixture** (such as `../fixture/a.txt`), not only one that ends outside it. Rewrite such a link to a path inside the fixture.
- A link that leaves the fixture throws `ERR_SEED_SYMLINK_ESCAPE`, and a file that changes between the check and the read throws `ERR_SEED_CHANGED` (step 6).
- The win32 port answers `realPath` in win32 spelling instead of the POSIX `/C:/repo` form.

### 5.11 `@effected/lsp`: win32 refusals

- **`LspUri.toPath` answers `None` and `fromPath` throws a `TypeError`** for win32 device and stream paths: DOS device names (`CON` to `LPT9`, `CONIN$`, `CONOUT$`, with any extension), a `:` after the drive (alternate data streams), trailing dot or space segments, `\\??\` paths and non-hostname UNC servers.
- A `file://%6Cocalhost/a` host is no longer percent-decoded, so it answers `None`. `\\localhost\share` round-trips as `file:////localhost/share/x`.
- If you passed such paths through, wrap `fromPath` where its input is untrusted, or check `toPath`'s `Option`.

### 5.12 `@effected/mcp`: captured console arguments

- **`McpHarness` records captured console arguments the way the console shows them:** an `Error` argument becomes `Error: boom` through `ErrorText`, a plain object or array renders as JSON, and anything else falls back to a description. An assertion that matched an `Error`'s bare message must now match the `Error:` prefix.

### 5.13 Kept error causes are redacted copies

`@effected/npm`, `@effected/runtimes`, `@effected/jwt`, `@effected/github` and `@effected/github-actions` no longer keep the raw HTTP request or response as an error cause. They keep a copy made by `@effected/crypto`'s `HttpRedaction`, which keeps the method, the redacted URL, the status and the non-sensitive headers, writes `REDACTED` over `authorization`, cookies and token-style headers, and drops URL userinfo, signed-URL query values and the body.

- **Code that reads `cause.request.headers` or `cause.request.body` changes:** sensitive header values read `REDACTED`, and the body is gone.
- **Object identity does not hold.** A test that compared a cause with `===` against the request or error it injected fails; `instanceof` still holds. Compare by tag or fields instead.
- **What each package keeps:**
  - `npm`: `RegistryReadError` and `TarballError` keep redacted causes; the registry URL's userinfo is redacted in `RegistryReadError.registry`, `PublishError.registry` and span annotations.
  - `runtimes`: `NetworkError` and `ResponseParseError`.
  - `jwt`: the `JwtError` `jwksFetch` cause.
  - `github`: `GitHubError` and `GitHubGraphQLError` keep no request body, options, `set-cookie`, response data, or GraphQL data and errors.
  - `github-actions`: the OIDC, blob store, cache, artifact, Twirp and `ToolInstaller` errors. `ToolInstallerError.subject` is the redacted URL, and `BlobTransferError.cause` is a redacted `RestError` copy.

### 5.14 `@effected/workspaces`: `WORKSPACE_MARKERS` is narrowed

- **`WORKSPACE_MARKERS` is typed `ReadonlyArray<WorkspaceMarker>`, not `ReadonlyArray<string>`.** `WORKSPACE_MARKERS.includes(someString)` stops compiling. Narrow the string first, or widen the array at the call site: `(WORKSPACE_MARKERS as ReadonlyArray<string>).includes(name)`. Typecheck finds every site.

## 6. Security fixes

These landed in the drain. Upgrading is what closes them; no code change of yours is needed beyond step 5.

- **`@effected/github`: request-option injection.** `updateSettings` and `applySettings` spread an open settings map beside octokit's request options, so a settings key such as `baseUrl`, `headers` or `request` could redirect the authenticated PATCH, token attached. Settings now travel as the request body.
- **`@effected/github`: token confined to the configured base.** The token is only sent to the configured base. Routes that resolve elsewhere, absolute-URL routes and cross-origin pagination `Link` headers are refused. On GHES the upload host is derived from the base, so the token no longer goes to `uploads.github.com`.
- **Credentials in kept error causes** (step 5.13): a logged or serialized error from `npm`, `runtimes`, `jwt`, `github` or `github-actions` could carry a token, cookie, signed URL (such as a SAS URL) or request body. They keep redacted copies now.
- **`@effected/npm`: credentials off cleartext.** npmrc credentials are no longer sent over plain http to a registry not configured as http, never follow a scope, lookalike host, port or CDN URL, and are kept out of printed output.
- **`@effected/walker`: symlink and win32 escapes.** `confineReal` refuses dangling links, which a link swapped in after the check could otherwise redirect outside the root, and win32 drive-less rooted paths are no longer read as inside the root.
- **`@effected/memfs`: fixture seed escapes.** `NodeDirectorySeed` resolves each link physically, so a dangling link can no longer escape through a lexical check, and reads each file through `O_NOFOLLOW` checked against the walk, so a file swapped for a link or grown past `maxFileBytes` mid-seed is refused.
- **`@effected/package-json`: exports confinement.** Every `exports` and `imports` target is confined to the package, and substituted targets and bare imports are re-checked, so a pattern match cannot inject a forbidden segment or escape the package.
- **`@effected/lsp`: win32 device and stream paths** are refused in both directions, so an untrusted URI cannot name a device or an alternate data stream.

## 7. New surfaces worth adopting

For each, search your code for the hand-rolled pattern, and replace it only where the semantics match.

### Effect 4.0.7

- **`CliOutput.Presenter` / `layerPresenter` / `defaultPresenter`:** a scoped service that decides where built-in help, invalid-invocation and version output goes, or replaces it. Search: `Console` wrappers that intercept or reroute `Command.runWith` help output.
- **`CliError.userMessage` / `getUserMessage`:** annotate a domain error so `Command.runWith` renders its message without wrapping it in `CliError.UserError`. Search: catch-and-wrap into `UserError` just to print a message.
- **`Completions.fromCommand(command)`:** converts a `Command` tree into a `CommandDescriptor`, so build tooling can generate completion scripts with `Completions.generate` without running the CLI.
- **`@effect/vitest` `layer(L, { buildPerTest: true })`:** builds the block's layer once per test, into a fork of the memo map, and releases it before the next test; a layer from an enclosing `layer` block stays shared. It gives per-test isolation without leaving the `layer()` block. Search: suites that dropped `layer()` for per-test `Effect.provide` because of cumulative state, or reset a `Ref` in `beforeEach`.
- **`Arbitrary.checkEffect` `concurrency`** (and the global check configuration): runs independent property evaluations concurrently. Default `1`; shrinking and replay stay sequential.
- **`HttpApiClient.decodeResponse`:** decodes a raw endpoint response with the endpoint's declared success and error schemas, for example after a `responseMode: "response-only"` call.
- **`effect/observability/OtlpProxy`:** serves OTLP routes that forward browser telemetry to a collector and keep credentials on the server.
- **`effect/persistence/CircuitBreaker`** (`@stability experimental`): keyed circuits with consecutive and rate trip policies, in-memory and Redis stores, plus `HttpClient.withCircuitBreaker`. The breaker never waits, so put retry and timeout inside it. Search: hand-rolled failure counters around an HTTP client.
- **`Redis.reserve`:** leases a dedicated pooled connection, so blocking commands (`XREAD BLOCK`, `BLPOP`) no longer hold up the shared one.
- **`Tool.make`/`Tool.dynamic` `toModelOutput`:** send text, images and files to the model in place of the serialized tool result. `Tool.ParametersDecodingServices` names the services a tool's parameter schema needs.

### The kit: from the advance

- `TerminalEnv.colorLevelFrom` and `TerminalEnv.capabilities` (step 4).

### `@effected/source` (new)

- **`LineIndex`:** converts between offsets and LSP-style line and character positions, deriving line ends from the text. Its line-break rule is the LSP one: LF, CRLF and a bare CR each end a line. `LineIndex.locationOf` validates the length it is given.
- **`SourceIndex`:** a structural interface for index-shaped values, so you can type a field without depending on the `LineIndex` class. Plus the structural range and diagnostic shapes `jsonc`, `toml`, `yaml` and `markdown` share.
- `@effected/yaml` and `@effected/markdown` re-export `LineIndex`, `SourceIndex` and the position shapes.
- Search: hand-written `lineCharacter`, `offsetToPosition`, `positionAt` or line-start tables, especially any that split on `\n` alone and so answer `-1` or a wrong line on CRLF or bare-CR text.

### `@effected/env`

- **`ShellExports.quote(value)`:** a one-word bash quoter for a caller that builds its own `export` lines. It throws a `RangeError` on NUL or a lone surrogate. It has no POSIX-sh-only mode: a value holding a control character comes out as `$'…'`. Search: hand-written `shellQuote`, `'\''` replacements.
- `ShellExports` now rejects `PIPESTATUS` as a special variable.

### `@effected/xdg`

- **`Xdg.layerWith(options)`**, plus an options argument on `layerFromEnv` (`XdgEnvOptions`), for a program that follows a shell rule such as `${XDG_STATE_HOME:-$HOME/.local/state}`. `homeFallback` replaces only a missing home, never a set one; `relativeHomes: "keep"` uses a relative XDG home as given instead of discarding it. Every default stays the spec, and the runtime directory and search paths keep the spec rule. Search: local XDG resolvers that exist only to keep a relative value or supply a fallback home.

### `@effected/walker`

- **`Walker.ascendToMarker`:** stops at the nearest directory holding a marker entry and probes nothing above it.
- **`Walker.findUpwardAll`:** every hit in the nearest directory, so a caller can report an ambiguity (two lockfiles, say) rather than silently taking the first.
- **Sync twins** for every upward IO form and for `ascend` (`ascendSync`, `ascendWithinSync`, `ascendToMarkerSync`, `findUpwardSync`, `findUpwardAllSync`), built on one shared upward machine with the Effect forms.
- **`descend` `match`:** `file`, `directory` or `any`.
- **`confineReal` / `confineRealSync`:** physical containment checked segment by segment, refusing symlink escapes and unresolvable paths. `PathEscapeReason` gains `outside` and `unresolvable`, and `PathEscapeError` an optional `cause`.
- Search: `while (dir !== dirname(dir))` loops, hand-rolled upward walks in sync code (Vitest `globalSetup`, bundler plugins), `realpath` + `startsWith` containment checks.

### `@effected/cli` and `@effected/engine`

- **`CliFormat.flag` aliases and custom formats:** `aliases` maps your names onto built-in formats (`{ human: "auto" }`), and `custom` formats are offered and yielded as themselves for you to render. Search: a local `--format` flag that exists only to add `human` or a `mermaid`/`dot` output.
- **`CliFormat.printJson(value)`:** the JSON half of `CliFormat.print` on its own, an `Effect<void>` with no requirement, so a CLI that keeps its own `--json` flag prints JSON the kit's way. Search: `JSON.stringify(…, null, 2)` written to stdout.
- **`Fmt.suggest`:** a did-you-mean list with `effect/cli`'s threshold. `ConfigIssueRenderer` appends it to unknown-key lines. Search: local Levenshtein helpers.
- **`Fmt.errorText`** and **engine `ErrorText`** (`describe`, `causeMessage`, `of`, where `of` is the `causeMessage ?? describe` fallback): the never-throwing error-text rendering, now shared by `cli` and `mcp`. Use engine's in a non-CLI front end. Search: `String(error)`, `error instanceof Error ? error.message : …`.
- **`CliTest.spawn`:** starts a bin and returns at once with stdout and stderr line streams, `kill`, `exitCode` and `result`. Both streams replay to every reader and the child is killed when the scope closes. Search: tests that spawn a long-running bin (a server, a watcher) by hand to wait for a ready line.

### `@effected/git`

- **`GitLocateOptions` `ignoreRepositoryEnv`** on `repoRoot`, `commonDir` and `treeIdentity`: drops git's `--local-env-vars` from the child environment, so a hook's inherited `GIT_DIR` no longer reports the cwd as the toplevel. Search: `delete env.GIT_DIR`, `env -u GIT_DIR` in hook code.
- **`GitFile.parse` / `parseResult`:** read a worktree or submodule `.git` pointer file by git's own rules, with a typed `GitFileParseError`. Search: `gitdir:` regexes.
- `GitRemote.parse` does not trim: trim first, since git treats surrounding whitespace as significant.

### `@effected/config-file`

- **`saveTarget: "source"`** (step 5.3): write back to the file the resolver chain found.
- **`ConfigMerge.deep`:** the pure, synchronous merge `layeredMerge` folds with. Arrays are atomic, an own `undefined` wins, prototype keys are dropped, and a depth cap keeps it total. Search: local `deepMerge` helpers.

### `@effected/workspaces`

- **`WorkspaceRoot.locate(cwd, options)`:** a `WorkspaceRootMatch` as an Effect, from `FileSystem` and `Path` in `R`. It shares one ascent with `find`, so the two cannot disagree on a root, and `WorkspaceRootShape` is unchanged.
- **`markers`:** root lookups filter by marker (`pnpm-workspace.yaml`, `package.json`) and report the matched file, so a pnpm-only tool is not stopped by a member that keeps a `package.json` `workspaces` field. Every layer that forwarded `stopAt` now forwards `markers` too. `WORKSPACE_MARKERS`, `WorkspaceMarker` and `WorkspaceRootMatch` are exported.
- **`locateWorkspaceRootSync(cwd, { ...nodeSyncOps, markers })`:** the sync form, answering `null` where `locate` fails.
- **`SourceBoundary` `forbidImportedNames`:** forbid the named exports of one module while leaving its others free. Dynamic import, `require` and computed members are documented misses.
- Search: upward searches for `pnpm-workspace.yaml`, hand-written import-boundary checks.

### `@effected/commands`

- **`Run.bytes`:** a command's stdout undecoded, NULs and invalid UTF-8 kept, with `Run.text`'s exit, timeout and capture semantics. Search: `Buffer` collection around a child to read binary output.
- **`Run.setKillOptions`:** sets `killSignal` and `forceKillAfter` on any command, pipelines and `ResolvedTool` commands included. `forceKillAfter` bounds a timeout against a tool that ignores SIGTERM.
- **`LocalExec.command(launcher, binary, args, { kind, cwd })`:** a ready core command from the canonical prefix table. An empty or flag-like binary throws. Search: hand-built `npx --no --` / `pnpm exec` argv.
- **`RunOnce` `mode: "serialize"`:** every caller runs the work in turn under the lock; no done marker is read, trusted or written. Search: a second, local lock around work that must run every time but never concurrently.

### `@effected/memfs`

- **`NodeDirectorySeed.read`** (`node-sync` subpath): seeds a volume from a real fixture directory, sync and byte-exact, absolute under `mountAt` or relative for the `root` option. Symlinks are copied as links, modes only on request. Search: test setup that walks a fixture directory and writes each file into a memfs volume.

### `@effected/github`

- **`repositoryPatch(draft, { extra })`:** sends extras verbatim while the draft stays type-checked. `applySettings(settings, { unknownKeys: "send" })` forwards undescribed settings keys and reports them in `AppliedSettings.unverified`. Search: casts that smuggle an undescribed setting through the draft.
- Interrupting `paginate` aborts the in-flight page.

### `@effected/npm`

- **`NpmConfig`:** resolves registry reads the way npm does. `load` reads project, user and global npmrc plus `npm_config_*` variables with env substitution, and `fromSourcesResult` is the pure form. `registryFor` applies scoped registries and `targetFor` yields the `RegistryTarget` `NpmRegistry` takes. Credentials stay `Redacted`, and an unset variable fails as missing-env. Search: `.npmrc` parsers, `@scope:registry` lookups.
- **Authenticated tarballs:** `PackageTarball` authenticates a private-registry tarball with `credentialFor(tarballUrl)`.

### `@effected/package-json`

- **`PackageExports`:** Node's `PACKAGE_EXPORTS_RESOLVE` and `PACKAGE_IMPORTS_RESOLVE` transcribed, with patterns, null exclusions and array fallbacks. `resolveTypesResult` adds TypeScript's `types` and `types@` conditions, extension substitution and `typesVersions`. `entriesResult` and `typesEntriesResult` enumerate exported subpaths. Search: hand-written `exports` walkers.
- **`PackageJsonFile.exportedFiles`:** expands pattern exports against package files, never entering `node_modules` or following a symlink.
- **`Repository.slug`:** the owner and name, counting a bare `owner/name` shorthand as GitHub, as npm does. Search: regexes over `repository.url`.

### `@effected/jsonc`

- **`JsoncCanonicalizeOptions`:** opt in, per value kind, to lenient fingerprinting: `bigint` as a bare decimal literal, `undefined` omitted (`null` in arrays), non-finite numbers as `null`, and `toJSON` on a `Date` only or on any object. `canonicalizeResult`, `canonicalize`, `hash` and `hashResult` take it as an optional last argument; the strict RFC 8785 default is unchanged. Search: pre-passes that normalize a value before hashing it. **If you persist a hash,** compare before switching.

### `@effected/lsp`

- **`LspUri.toPath` / `fromPath`:** file URIs to paths and back. `toPath` answers `Option.none()` for a non-file scheme or a URI that names no path on the platform, instead of throwing as `fileURLToPath` does. `fromPath` writes RFC 8089 URIs, dot segments never climb above a root, drive or UNC share, and the drive letter is lowercase both ways. Search: `fileURLToPath` / `pathToFileURL` in LSP handlers.

### `@effected/crypto`

- **`HttpRedaction`:** copies HTTP errors, requests and responses with credentials removed (`error`, `request`, `response`, `url`, `text`, `cause`, `isSensitiveHeader`). Use it in your own libraries wherever you keep a request or response as an error cause. Search: errors that store a `HttpClientRequest` or response, header scrubbing before logging.

### Known consumer notes

- **okfit:** its own `lineCharacter` (`packages/core/src/internal/position.ts`) returns `character: -1` for an offset at the `\n` of a `\r\n`, the bug the kit just fixed. It can switch to `LineIndex` from `@effected/source`, which follows the same LF, CRLF and bare-CR rule.
- **Every consumer:** drop hand-rolled upward walks and `while (dir !== dirname(dir))` loops for the `Walker` upward forms and their sync twins, and hand-rolled workspace-root searches for `WorkspaceRoot.locate` or `locateWorkspaceRootSync`.
- **reposets:** it calls `applySettings`. Any test double that builds an `AppliedSettings` literal must add `unverified` (step 5.4).

## 8. Verify the upgrade

1. `pnpm install` from scratch resolves every `@effected/*` package to the catalog's new minors and every Effect package to `4.0.7`, with no `file:` overrides left. Verify by resolution, not by reading a manifest: `TerminalEnv.colorLevelFrom` exists in the installed `@effected/env`, and `@effected/source` resolves wherever `yaml` or `markdown` does.
2. Typecheck every package (`tsc --noEmit` or the repo's `types:check`). This finds the drain's typed breaks: `WalkerSyncPath` doubles missing members, `RunResult.exitCode` read as a `number`, `lineIndex` annotated as `LineIndex`, `AppliedSettings` literals without `unverified`, and `baseUrl` in `RestExtras` or request params.
3. Build, then run the full test suite. It finds the behaviour breaks the compiler cannot: relative `descend` cwds, dangling links through `confineReal`, `saveTarget` under `firstMatch`, the github doubles' refusals and the new `layerFixture` PATCH shape, npm redirects and credential transport, decoded export paths, CRLF positions, yaml line breaks and lint fixes, memfs seed refusals, `McpHarness`'s `Error:` prefix, and identity or field checks on kept error causes.
4. `pnpm peers check` is clean.
5. Regenerate and diff any JSON Schema, API report or snapshot derived from Effect output (step 3) before you ship. Diff snapshots of kit positions and error causes too.
6. For a CLI: run it piped (`your-cli … < /dev/null | cat`) with a fallback-prompted flag left out, and confirm it takes the default rather than exiting 64. Run a handler failure carrying `[CliError.userMessage]` and confirm it prints once. If you kept `--json`, confirm it still prints the same JSON as `--format json`.

Update READMEs, docs and agent context files that show the old shapes. Leave CHANGELOGs alone.

## 9. Clear your tracking tickets

This wave closes the effected issues below, most of them filed by downstream projects. If your repository has an open ticket that tracks one of them (a workaround waiting on the kit, a "replace this once effected ships X", a TODO naming an effected issue), the fix has probably shipped.

1. List your open issues and search the code and TODOs for `spencerbeggs/effected#` and for the numbers below.
2. For each match, confirm the fix is in the version you now resolve. Read its changeset entry in the package CHANGELOG and the installed `.d.ts`, and probe it if your workaround depends on a behaviour.
3. Adopt it: replace the workaround with the kit surface, keep the suite green, and close your ticket with a link to the effected issue. If the shipped shape does not cover your case, say so on the effected issue rather than keeping a private shim.

Also check tickets that track an Effect issue against the 4.0.7 changes in step 3.

| Issue | Closed by this wave |
| --- | --- |
| #530 | package-json: types-aware subpath resolution and entry-point enumeration |
| #1113 | config-file: save/update write to the discovered source, not `defaultPath` |
| #1114 | cli: a near-match ("did you mean") helper |
| #1115 | github: `repositoryPatch` carries settings Octokit's types do not know yet |
| #1116 | walker: stop an upward walk at a marker entry |
| #1117 | walker: a `findUpward` form returning every hit in the nearest directory |
| #1118 | env: a shell-word quoter beside `ShellExports.format` |
| #1119 | xdg: opt-in home fallback and shell-compatible relative values |
| #1120 | cli/testing: a `CliTest.spawn` handle for streaming output and signals |
| #1121 | jsonc: a lenient `JsoncFingerprint` canonicalization mode |
| #1122 | config-file: a pure, synchronous `deepMerge` |
| #1123 | git: a hook-safe `repoRoot`/`treeIdentity` that scrubs `GIT_DIR` and `GIT_WORK_TREE` |
| #1124 | workspaces/testing: a `SourceBoundary` rule forbidding specific named imports |
| #1125 | memfs: seed a volume from a real fixture directory |
| #1126 | markdown/yaml: the offset-to-line/character conversion (now `@effected/source`) |
| #1127 | lsp: `file:` URI and path helpers (`LspUri`) |
| #1128 | cli: `CliFormat.flag` takes caller-named aliases and custom formats |
| #1129 | walker: sync forms of `ascend` and `findUpward` |
| #1130 | workspaces: `findWorkspaceRootSync` can match only `pnpm-workspace.yaml` and returns the matched file |
| #1132 | npm: a registry read that honours `.npmrc` (scoped registries, per-host auth) |
| #1134 | cli: one `Fmt` helper for the error-text fallback |
| #1135 | env: `ShellExports` handles `PIPESTATUS` |
| #1136 | walker: directory matches, physical containment, and the missing-base contract |
| #1137 | git: a pure gitfile parser, and trimming in `GitRemote.parse` |
| #1138 | commands: `Run.bytes`, serialize-only `RunOnce`, ready `LocalExec` commands, kill options |
| #1139 | env: a colour reader that does not need `Stdio` |
| #1140 | package-json: an owner/repo accessor on `Repository` |
| #1141 | mcp: `Fmt.describe` without a dependency on `@effected/cli` |

## 10. Align on the kit and on Effect

Do this only once step 8 is green, so every replacement is measured against a working baseline.

The kit and Effect v4 keep absorbing what downstream projects hand-roll. **Review all of your code, not just the call sites named above**, and replace whatever you implement yourself that the kit or Effect now provides, wherever the semantics fit.

- **Delegate the review to the effected plugin's `effect-developer` agent.** It carries the kit's package index (`effected-packages`, with the per-construct intent index under `references/constructs/`) and the Effect v4 skills, and verifies every API against the installed `.d.ts`. Work module by module, and ask it what the kit or Effect already provides for what each module does.
- **Replace only where semantics match.** Where the kit computes a value you persist or publish (a key, a path, a schema), compare its output against your stored data first, and keep a local version or a migration where they differ.
- **When the kit almost fits, report the gap upstream** rather than wrapping it in a local shim.
- Keep each replacement behaviour-preserving, with the suite green after every step, and re-run the step 8 verification at the end.
