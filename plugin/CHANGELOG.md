# @effected/ai-plugins

## 0.49.1

### Documentation

- The upgrade ledger records the `bundle.json` and `[package.bundle]` rename, the `@effected/npm` packument reads that answer `Option`, and the `PackedInstall` `NODE_OPTIONS` fix, with adopt entries for `@effected/manifest`, `[package.build.manifest] set`, the `effected-built` condition, the runtime-subdirectory override, `PendingChangesets.readSettled`, `@effected/plugin/env` and the action tsconfig preset
- Ledger entry 0001 replaces its stale `dist/dev` and transform guidance, repoints the env reference and the action tsconfig, and warns about a leftover `tsdown` override and the dropped pre-test build
- The npm adopt entry names the transport gap and its recipe
- Two new traps: a leftover `tsdown` override, and `TS2883` after a dependency stops importing a package in its declarations
- The `effected-packages` skill adds `@effected/manifest`, and its npm, bundler, cli and plugin references and the release skill state the new shapes [#1310][#1310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.49.0

### Features

- The `effected-renovate` upgrade ledger gains migration entries for this release's breaking and behavioural changes in `@effected/walker`, `@effected/markdown`, `@effected/glob` and `@effected/npm`
- The ledger also gains opt-in adoption entries for the new surfaces in `glob`, `walker`, `markdown`, `npm`, `workspaces`, `lockfiles`, `crypto`, `webhooks`, `github` and `files`, each offered to the user and never applied unasked
- The `effected-packages` skill and construct index now route to those new surfaces, including `Wildcard`, `PosixPath`, `@effected/markdown/stringify`, `Hash.digest`, `LockfileDiff`, `PnpmSettings` and `GitHubUserAuth`

#### Upgrade ledger

- Five new `effected-renovate` entries: the `@effected/glob` compile budget and kept-whole numeric ranges, the `@effected/lockfiles` glob peer and npm workspace reading, the `@effected/crypto` `SigV4EncodingError`, the `@effected/npm` key-variable rule and exported npmrc parser, and walks under `matchBase` reaching every match. Seven existing entries now describe the shapes this release ships, including `@effected/changesets` planning fixed, linked and pre releases and `effected action init`.

#### Skills and references

- `effect-v4-idioms` says core `HttpClient` already aborts its fetch on interruption, and when to use the `Effect.tryPromise` signal instead
- The action skills, the action engineer agent and the GitHub Action canon name `effected action init` and the `effected.toml` `[action]` tables
- Package references and the construct index cover every new export, with intent keywords for each value export [#1295][#1295]

### Bug Fixes

- `effected-renovate` now verifies the resolved Effect version with `pnpm why effect --depth 0`. The previous `node -p` check failed with `Cannot find module` after a good install, from a root that does not declare `effect`
- A new ledger entry corrects the schemastore migration: declare `@effected/plugin` in the manifest of the package that holds `schemastore.config.*`, not only at the root, or Biome's `noUndeclaredDependencies` reports it. Both traps are also listed in the skill's traps reference [#1250][#1250]

### Documentation

- The plugin's skills teach the single-target `effected package build` and `effected action build`, and the upgrade ledger gains three entries for moving a consumer off `@savvy-web/bundler` [#1249][#1249]

### Maintenance

- Closes the `effected-renovate` upgrade-ledger round released in 0.48.0, so the shipped ledger starts empty from that release
- A repository older than the new baseline still gets every entry it crossed, fetched from the 0.48.0 release tag [#1249][#1249]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1250]: https://github.com/spencerbeggs/effected/pull/1250

[#1295]: https://github.com/spencerbeggs/effected/pull/1295

## 0.48.0

### Features

- The consumer upgrade ledger gains entries for this sweep: `AtomicDirectory` moved to `@effected/files`, `ManagedSection` requiring `Path`, `@effected/cli-kit` dropping its `@effected/config-file` peer, the `CliUi.prompt` `otherwise` overloads, adopting the new helpers, and writes needing directory permission (#1176, #1185, #1203).
- The `effected-packages` skill and construct index cover `@effected/files`, `EditDistance`, `CliExit.report`, `McpToolkit.provideLifetime` and the `promiseInExclusive` boundary rule.

* Skills teach `effected schema` for building, checking and validating SchemaStore schemas.

### Documentation

- The observability skill (#1215) now covers the OTLP gate, export intervals and endpoint URLs.
- The package reference skills for `env`, `github`, `github-actions`, `glob`, `jsonc`, `markdown`, `memfs`, `npm`, `package-json`, `semver` and `store`, plus the Actions and GitHub API skills, follow the package changes in this release. [#1239][#1239]

* The `effect-v4-cli`, `effect-v4-mcp`, `effect-v4-schema`, `effect-v4-services-layers` and `effect-v4-testing` skills are corrected to match the sweep's behaviour (#1089). [#1237][#1237]

### Maintenance

- The consumer upgrade ledger is reset for the new round. [#1233][#1233]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1233]: https://github.com/spencerbeggs/effected/pull/1233

[#1237]: https://github.com/spencerbeggs/effected/pull/1237

[#1239]: https://github.com/spencerbeggs/effected/pull/1239

## 0.47.0

### Features

- The `effected-packages` skill routes to the `effected` tool: rows and references for `@effected/plugin`, `@effected/cli`, `@effected/mcp` and `@effected/engine`, with the package count at 47. The skill recommends installing only `@effected/plugin`, as a root devDependency through `catalog:effected`.
- The construct index covers the four tool packages. [#1229][#1229]

#### `/effected-renovate`

- A new user-invoked skill that moves a repository onto a new `@effected` release. It bumps the catalog plugin and the other config dependencies, regenerates the lockfile, checks that one `effect` resolves, then builds, tests and aligns the remaining dependencies.

- **The upgrade ledger.** Each release now ships one entry per change a consumer must act on: a break, a behaviour change, a security fix, a tooling change or a surface worth adopting. `applicable.mjs` compares the pre-upgrade lockfile with the new one, lists only the entries the upgrade crossed, and shows the files where each one meets your code. A repository several releases behind gets the earlier rounds too, fetched from the plugin's release tags.

- **The first round** covers the move to Effect 4.1.1 and 4.1.2, the carrier-library rename and the matching kit releases, in 53 entries.

- **Renames count as the same package.** A repository that still resolves a renamed package under its old name crosses the new name's thresholds from its old version, so a repository on `@effected/pnpm-plugin-effect` still sees the entries keyed on `@effected/pnpm-plugin-effected`.

- **Renamed config dependencies** declared in the ledger are applied by `bump-config-deps.mjs`, for example `@effected/pnpm-plugin-effect` to `@effected/pnpm-plugin-effected`.

- The session briefing lists the new skill.

* The effected agent plugin launches the `effected-mcp` server.
* The upgrade ledger records the carrier rename (`@effected/cli`, `@effected/mcp` and `@effected/engine` became `@effected/cli-kit`, `@effected/mcp-kit` and `@effected/kit`) and how to install the effected tool through `@effected/plugin`. [#1229][#1229]

### Documentation

- The `effected-packages` references for `@effected/pnpm-plugin-effected` and `@effected/workspaces` describe the plugin's single declared `effected` catalog and the `:peers` twin its hook hides. [#1229][#1229]

* Four new `effected-renovate` ledger entries for Effect 4.1.2: refs compare by their contents again, `McpServer` JSON-encodes declared tool failures, core fixes that change a tested result, and SQL transaction spans plus idle OTLP exporters.
* `effect-v4-idioms` now says `Ref` and `MutableRef` compare by their current contents, and `effect-v4-module-index` lists core's `Jsonc` and `Json5` parsers.
* The `pnpm-plugin-effected` README and the `effected-packages` skill describe the Effect catalog range without naming a patch release, so they no longer go stale on each Effect patch. [#1229][#1229]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | config | updated | 4.1.1 | 4.1.2 |

- The `effected` catalog moves the Effect family to 4.1.2, and the derived graph-wide pins follow it.

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

* The tracking package is renamed from `@effected/ai-plugin` to `@effected/ai-plugins`, so plugin release tags now read `@effected/ai-plugins@<version>`. [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229

## 0.46.0

### Features

- Skills and references now teach Effect 4.1 and the matching kit shapes: `Digest` in place of `Crypto`, `McpStdio` `registrations`, inherited-flag help, `Redacted` spawn arguments and core's derived `glob`.
- New `pnpm-plugin-effected` package reference replaces the `pnpm-plugin-effect` one, covering the single `effected` catalog. [#1168][#1168]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1168]: https://github.com/spencerbeggs/effected/pull/1168

## 0.45.0

### Features

- The `@effected/git` skill reference and construct index now cover `Git.diffFile`, its `allowMissing` and `ignoreRepositoryEnv` options and `FileNotFoundError`. [#1161][#1161]

* The `@effected/env` skill reference and construct index now cover `ShellExports.quote` options (`dialect: "posix"`, `always`), `ShellExports.quoteResult` and `ShellQuoteError`. [#1160][#1160]

- The `@effected/walker` skill reference and construct index now cover `relativeWithin` and `relativeWithinSync`, the physical base-relative placement of an absolute path that may not exist yet. [#1162][#1162]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1160]: https://github.com/spencerbeggs/effected/pull/1160

[#1161]: https://github.com/spencerbeggs/effected/pull/1161

[#1162]: https://github.com/spencerbeggs/effected/pull/1162

## 0.44.0

### Features

- Skills and package references cover the backlog-drain APIs: `@effected/source`, `ErrorText`, `CliFormat` and `CliTest.spawn`, `Walker` marker and sync forms, `PackageExports`, `NpmConfig`, `LspUri`, `Run.bytes`, `ConfigMerge.deep`, `HttpRedaction` and `SourceBoundary`'s `forbidImportedNames`.

### Documentation

- New warnings: `baseUrl` sends the token to any host, and a `doesNotThrow` label is read as a matcher. [#1151][#1151]

### Maintenance

- Upgrades core Effect library dependencies to v4.0.7 [#1145][#1145]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1145]: https://github.com/spencerbeggs/effected/pull/1145

[#1151]: https://github.com/spencerbeggs/effected/pull/1151

## 0.43.2

### Maintenance

- Updated the skills and regenerated the construct index for the kit-ports API changes in env, git, app, cli, commands, engine, mcp, walker, glob, xdg and memfs, and rebuilt the Claude and Copilot plugin builds. [#1111][#1111]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1111]: https://github.com/spencerbeggs/effected/pull/1111

## 0.43.1

### Maintenance

- Regenerated the construct index with rows for the new synchronous facades in `@effected/commands` and `@effected/workspaces`, and rebuilt the plugin builds under pluginfinity 0.3.8. [#1101][#1101]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1101]: https://github.com/spencerbeggs/effected/pull/1101

## 0.43.0

### Documentation

- `effected-packages` references and the construct index cover the wave's API changes: Option lookups in markdown and schemastore, Result twins in the format packages and package-json, npm workload credentials and the publish auth path, nested `ActionLogger` groups, decorated config-file codecs, the semver range edges, the xdg relative-value rules and the `Git.status` untracked-files default.
- `effect-v4-idioms`, `effect-v4-source-lookup`, `effect-v4-module-index` and `running-commands-and-tools` no longer claim `Effect.cached` caches an interrupt, and teach an exit-keyed `Effect.cachedWithTTL` for success-only memoization.
- `effect-v4-house-style` corrects the class/interface merge rule: only a type alias blocks the class form.
- `effect-v4-module-index` and `effected-packages` route semver and xdg between the kit and core.
- `effect-v4-source-lookup` explains that published Effect source is reflowed and carries extra TSDoc, and looks anchors up by symbol through the skill-anchors manifest.
- Every source citation in the skills is now checked by symbol, and the wrong citations found are corrected. [#1066][#1066]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1066]: https://github.com/spencerbeggs/effected/pull/1066

## 0.42.0

### Documentation

- `effected-packages` indexes `@effected/crypto`, `@effected/webhooks` and `@effected/oidc`, each with its own reference, and updates the `sbom`, `github` and `github-actions` references for the moved identity-token contract and the shared OIDC claims.
- `effect-v4-observability` teaches core's Otlp layers, `Tracer.externalSpan` and `TracerPropagationEnabled`. [#1051][#1051]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1051]: https://github.com/spencerbeggs/effected/pull/1051

## 0.41.0

### Documentation

- Skills cite the Effect 4.0.6 source: re-derived line anchors, and stale citations outside the anchor manifest relocated or corrected.
- `effect-v4-idioms` explains that a defect beside a typed failure turns the failure into a defect, so typed recovery does not run.
- `effect-v4-services-layers` explains that composed layers are memoized by identity, so a `Layer.fresh` dependency inside a shared composed layer is shared with it.
- `effect-v4-cli` covers `Command.validate` for rules across flags, `Flag.withNegation` / `Flag.withoutNegation`, and which colour rule core's built-in help follows.
- `effect-v4-module-index` lists `Bytes`, `SemVer`, `SemVerRange`, `TextDiff`, the `Tar`/`Zip`/`Xml`/`JsonArray` codecs, `UserDirectories`, `McpClient`, `EventRow` and `TerminalCapabilities`.
- `effect-v4-schema` states that a duplicate `toTaggedUnion` discriminant is caught at runtime only, and shows `Cause` JSON with `reasons`. [#1039][#1039]

### Maintenance

- Upgrades core Effect library dependencies to v4.0.6 [#1039][#1039]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1039]: https://github.com/spencerbeggs/effected/pull/1039

## 0.40.0

### Documentation

- The `TestClock` reference no longer says that a nested `TestClock.layer()` reads virtual time from `withLive`. A nested clock resolves the real clock behind the outer one, and `TestClock.layer()` also provides its own `Scheduler`.
- The schema reference now says that `Schema.toTaggedUnion` rejects duplicate discriminants at compile time. It also still throws at runtime when member types are widened.
- The jsonl reference now describes `FileSystem.watch`'s `onReady` callback when it explains the `JournalWatcher` seam.
- Corrects stale `FileSystem.ts` line citations in the module index, and re-derives skill source anchors against the new vendored tree. [#1019][#1019]

### Maintenance

- Upgrades core Effect library dependencies to v4.0.5 [#1019][#1019]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1019]: https://github.com/spencerbeggs/effected/pull/1019

## 0.39.0

### Maintenance

- Upgrades core Effect library dependencies to v4.0.4 [#1008][#1008]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1008]: https://github.com/spencerbeggs/effected/pull/1008

## 0.38.0

### Documentation

- The vendored-source pin and SessionStart briefing move to effect 4.0.3, and the skill anchors are re-derived.
- The `effect-v4-module-index` Crypto row covers the `randomUUIDv4`/`randomUUIDv7` call form, ULID and `TestCrypto.layer`.
- The CLI skill and the `effected-packages` env reference no longer tell bins to pass `process.stderr.isTTY`. [#1000][#1000]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1000]: https://github.com/spencerbeggs/effected/pull/1000

## 0.37.0

### Documentation

- The `effected-packages` github reference and the `github-app-tokens` skill now cover the widened `CheckRunRef`, `CheckRun.updateRef`, `completeRef` and `list`, the new `AuthenticatedApp` service, and `GitHubApp.botUser`.
- The construct index lists the new `@effected/github` exports. [#997][#997]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#997]: https://github.com/spencerbeggs/effected/pull/997

## 0.36.0

### Documentation

- The `effected-packages` skill gains a reference for `@effected/jwt` and lists the package in its index.
- The `github-api`, `github-app-tokens`, `actions-reporting` and `testing-actions` skills describe the new App-auth surface, OIDC verification, check-run options and the shared error classifier.
- The construct index gains the `@effected/jwt` entries and the new `@effected/github` entries, in both the Claude Code and Copilot builds. [#984][#984]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#984]: https://github.com/spencerbeggs/effected/pull/984

## 0.35.0

### Documentation

- The `effect-v4-cli` skill's live-view and testing references teach `LiveHandle.printAbove`, which prints a forwarded line above a mounted frame and reports whether it did, and the `CliUiTestLive` test seams `write`, `stdoutWritten` and `stderrWritten` for reproducing and asserting a torn frame.
- The `building-schemastore-schemas` skill now teaches a scoped Biome `json.formatter.expand: "always"` override, so a freshly built schema is lint-clean under CI, and records that the CLI writes every array element and object member on its own line. [#981][#981]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#981]: https://github.com/spencerbeggs/effected/pull/981

## 0.34.0

### Documentation

- The `effected-packages` skill gains a reference for `@effected/images`, covering image facts from bytes and the generated-image cache, and lists the package in its index.
- The construct index gains the `@effected/images` entries, in both the Claude Code and Copilot builds. [#977][#977]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#977]: https://github.com/spencerbeggs/effected/pull/977

## 0.33.0

### Documentation

- The `effected-packages` skill's `@effected/jsonl` reference documents the new `JournalWatcher` service and `NodeJournalWatcher.layer` from `@effected/jsonl/node`, and the updated provide pattern for journal layers.
- The construct index entries for `@effected/jsonl` are regenerated to match, in both the Claude Code and Copilot builds. [#971][#971]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#971]: https://github.com/spencerbeggs/effected/pull/971

## 0.32.0

### Documentation

- The `effect-v4-cli` skill's live-view reference no longer lists `drainPerformance` among the `CliUi.live` options, which `@effected/cli` 0.15.0 removes. [#960][#960]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#960]: https://github.com/spencerbeggs/effected/pull/960

## 0.31.0

### Features

- The session-start briefing runs on the pluginfinity 0.3.0 hook library as one script for both hosts. Copilot now receives the same briefing as Claude Code.

### Documentation

- The `effected-packages` skill's `@effected/jsonl` reference is rewritten for the redesigned journal API: the `Journal.Service` factory with a static `layer`, `position` on envelopes, `Slice` with `onInvalid`, and the per-operation error types.
- The construct index entries for `@effected/jsonl` are regenerated to match, in both the Claude Code and Copilot builds. [#951][#951]

* Skills are updated for Effect 4.0.2: stability tags are corrected, platform modules are marked unstable, and `Effect.retry` no longer retries defect or interrupt causes.
* The schema skill covers `.tag` on `Schema.TaggedUnion`, about 200 source citations are remapped, the module-index Encoding rows are fixed, and a Version row is added.
* The `effect-v4-cli` and `effected-packages` skills reflect Ink 8 and the U+2800 neutralizer marker, and the SPDX reference reflects the refreshed license counts.

### Maintenance

- `pluginfinity` is bumped to 0.3.0. [#959][#959]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#951]: https://github.com/spencerbeggs/effected/pull/951

[#959]: https://github.com/spencerbeggs/effected/pull/959

## 0.30.0

### Documentation

- The `effected-packages` skill gains a reference for `@effected/lsp` (frame codec and boot probe), and its `engine`, `mcp`, `store` and `workspaces` references cover the new surfaces: `ProcessGuard` in `@effected/engine/guard`, `McpHarness.stop` and the draining `close`, `McpProcess.stderrUntil`, `RunBinOptions.stdin`, and `PackedInstall.preflight` / `gate`.
- The `effect-v4-mcp` skill covers the stop/drain semantics of the test harness, the crash guard, stderr waits, and that structured data on a refusal is unreachable.
- The `effect-v4-cli` skill covers the `isCancelled` and `isNotInteractive` failure flags and `env.formatter` for `helpOnUsageError`.
- The `design-patterns` skill carries the packed-install preflight and CI-gate recipe for carrier verification.
- The store references no longer prescribe a first-open warm-up workaround, and the `effect-reviewer` and `effect-developer` agents are updated to match. [#944][#944]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#944]: https://github.com/spencerbeggs/effected/pull/944

## 0.29.1

### Documentation

- The `effect-v4-services-layers` skill now covers pinning a key over a generic shape such as `ConfigFileShape<A>`. It shows how to intersect the plain `Context.Key<I, Shape<A>>` back in, so that `A` is still inferred from the key. [#935][#935]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#935]: https://github.com/spencerbeggs/effected/pull/935

## 0.29.0

### Documentation

- The `effect-v4-cli`, `effected-packages`, `building-schemastore-schemas` and `effect-v4-testing` skills now cover the new `@effected/cli` surface: `CliUi.map`, `CliUi.lazyView` and `LiveOptions.final`, masked `TextInput`, the span-trail modes, the `CliUiTest` transcripts and serializer, and the new `@effected/schemastore-cli` failure report
- The `effect-v4-cli` skill now covers six adoption traps: where `CliUiTest.session` goes relative to `CliEnv.layerTest`, `Select` drawing `detail` only for the highlighted choice, the session's 80-column default and row truncation, `CliUi.prompt` keeping `NotInteractive` without `otherwise`, `Doc.print` writing one `Console.log`, and top-level `Doc` blocks printing with no blank line
- The `effect-reviewer`, `effect-developer` and `action-engineer` agents are updated to match [#933][#933]

* The `effected-packages` references for `app`, `store` and `config-file` cover `App.layerDirs`, the keyed `layerAs` and `layerSqliteAs` layers, `location`, Migrator ledger adoption and mirroring, and the wider-key caveat on `ConfigFile.layer`.
* The `effect-v4-services-layers` skill states the verified memoisation rule (a layer builds once per provided graph and a nested `Effect.provide` reuses the enclosing build, while sequential or sibling provides build again) and the key-pin edge case where a key parameter accepts wider service shapes.
* The `effect-reviewer` and `effect-developer` agents check a project's database wiring: one shared layer binding per database, `App.layerDirs` at a CLI edge, a distinct `layerAs` filename, per-connection pragmas in `client` / `onConnect` rather than migrations, and retrying only a warm-up open on `SQLITE_BUSY`.
* The `effect-v4-testing` memfs reference reflects the `FileSystem` requirement on the app database layers. [#933][#933]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#933]: https://github.com/spencerbeggs/effected/pull/933

## 0.28.0

### Features

#### One plugin for Claude Code and GitHub Copilot

- The effected plugin is now built from a single source for both hosts, so the Claude Code and Copilot plugins carry the same skills, agents and session briefing at the same version. The Copilot plugin moves onto the shared version line with this release.

- The Copilot plugin now carries every skill reference the Claude Code plugin does, including the installer integrity options that had fallen out of its `actions-cache-and-artifacts` reference

- Copilot agents list only tools Copilot provides: `read`, `edit`, `search`, `todo`, `execute` and `web`

- Four skills whose combined trigger text exceeded Copilot's 1024-character limit now ship a shorter Copilot description that fits within it

- The Copilot session briefing finds the project root from the session's working directory, since Copilot exposes no project-root variable

### Bug Fixes

- The `effect-v4-testing` and `effected-packages` skills now parse correctly: unquoted `when_to_use` text containing a colon followed by a space, or a `#`, had been invalid or cut short [#929][#929]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#929]: https://github.com/spencerbeggs/effected/pull/929
