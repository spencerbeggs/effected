# @effected/ai-plugin

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
