# @effected/claude-code-plugin

## 0.15.0

### Features

#### `bootstrapping-an-action` interview skill

- Adds a user-invoked skill that turns a fresh copy of the `github-action-template` repository into a planned action. It runs a fixed eight-question interview — identity, phases, GitHub access, inputs, outputs, runner capabilities, reporting, and self-dogfood — one question per message, and writes a plan file capturing the frozen I/O contract, the phase decision, the derived dependency list, the rename list, and a known-unknowns ledger. On approval it dispatches the `action-engineer` agent to run `designing-an-action` from Phase 0, so the interview itself covers Phase −1 recon and nothing is repeated downstream. This skill never runs for ordinary action work — only an explicit "bootstrap this template" request loads it.

- `action-engineer` now preloads `bootstrapping-an-action` alongside its existing preloads, and owns publishing the output schema to schemastore as part of the output-contract workflow described below.

#### Output contracts taught through schemastore

- `actions-inputs-outputs` now teaches structured outputs as versioned, published JSON Schema documents rather than ad hoc shapes. Any action with a JSON output runs a pre-write gate before emitting it, and a `SchemaPipeline.check` drift test keeps the published schema and the runtime `Schema` definition from diverging.

#### `structuring-an-action` canon updates

- A new `schemas/` slot for committed JSON Schema documents: `schemas/<version>/<name>-<version>.json` for a versioned output contract, and an unversioned `<action>.input.schema.json` at the repo root for an input schema.

- Baseline-first emission: `program.ts` emits the all-disabled output baseline before any work, never from an `Effect.onError` handler, so a failure handler can never blank an output describing work that happened.

- A two-sided compile-time layers proof: type-level assertions that the app layer's requirement channel and the program's requirement channel, minus the runtime's `ActionServices`, are both `never`.

- The any-depth collection rule: the test runner's project discovery skips directories named `utils`, `fixtures` or `snapshots` at any depth, so `src/utils/` mirrors to `__test__/unit/utilities/`.

- The `@effected/memfs` mandate for any test that touches the filesystem, never a hand-rolled `FileSystem.layerNoop` double.

- The `building-a-github-action` router and `testing-actions` skill are reconciled with this canon so their guidance and examples stay consistent with the new schema and testing rules. [#600][#600]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#600]: https://github.com/spencerbeggs/effected/pull/600

## 0.14.0

### Breaking Changes

#### The plugin source moved to `plugins/claude-code/`

- `plugin/` is now `plugins/claude-code/`, making room for a sibling Copilot plugin under `plugins/copilot/`. Skills, agents, hooks, scripts and tests moved verbatim; the plugin is still named `effected`, and its manifest is still at `.claude-plugin/plugin.json` within the plugin directory.

- Installed from the `spencerbeggs` marketplace, nothing changes — the marketplace entry already points at the new subdirectory. Anyone loading the plugin from a local checkout must update the path:

```bash
claude --plugin-dir plugins/claude-code
```

### Features

#### The plugin is now versioned and released on its own

- The Claude Code plugin no longer borrows `@effected/app`'s version. It is tracked by its own private workspace package, `@effected/claude-code-plugin`, which never publishes to npm — it exists so a changeset naming it bumps both `plugins/claude-code/package.json` and the plugin manifest `plugins/claude-code/.claude-plugin/plugin.json` in lockstep, then cuts a git tag and a GitHub release for the plugin.

- To version the plugin, write a changeset for `@effected/claude-code-plugin`. Changesets for `@effected/app` no longer move it.

### Bug Fixes

- The construct-index generator resolved the repository root relative to its own location and pointed one directory too shallow after the move, so `generate` and `check` both failed before reading a single package. Its repo-root and default annotation/output paths now account for the deeper nesting.
- The generated construct index carried a do-not-edit banner naming the old `plugin/scripts/` path, as did the skill that teaches grepping it. Both now name `plugins/claude-code/`, and the index has been regenerated.

### Documentation

- `plugins/CLAUDE.md` records how the two plugins are developed, versioned, tagged and distributed, and the design doc covers both. [#555][#555]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#555]: https://github.com/spencerbeggs/effected/pull/555
