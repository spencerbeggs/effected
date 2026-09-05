# @effected/copilot-plugin

## 0.4.0

### Features

- The actions-inputs-outputs skill drops the hand-rolled check-then-run contract preflight: `SchemaPipeline.run` refuses a pinned versioned target's contract change itself, and the drift test reads `contractBlocked` to print the right remedy.
- The LLM-annotation guidance is reversed: `x-ai-hint` is a declared family carried into emitted schemas, replacing the description-only advice.
- The schemastore package reference and construct index cover `contractChanges`, `SchemaContractChangeError`, `ContractChangeTarget`, `SchemaVersioning.isPinned` and `SchemaVersioning.next`. [#607][#607]

### Documentation

- The workspaces reference no longer teaches the sync facade as the workaround for a version-less root; `WorkspacePackage.version` is optional and `getWorkspacePackagesSync` reports skips through `onSkip`.
- The secrets reference's comment stripper example uses the safe lines-then-blocks order, matching the structural-checks rule it cites. [#614][#614]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#607]: https://github.com/spencerbeggs/effected/pull/607

[#614]: https://github.com/spencerbeggs/effected/pull/614

## 0.3.0

### Features

#### `bootstrapping-an-action` interview skill

- Mirrors the Claude Code plugin's new user-invoked skill: an eight-question interview — identity, phases, GitHub access, inputs, outputs, runner capabilities, reporting, and self-dogfood — one question per message, that turns a fresh copy of the `github-action-template` repository into a planned action. It writes a plan file capturing the frozen I/O contract, the phase decision, the derived dependency list, the rename list, and a known-unknowns ledger, then hands off to the `action-engineer` agent to run `designing-an-action` from Phase 0. Only an explicit "bootstrap this template" request loads it.

- `action-engineer` now preloads `bootstrapping-an-action` and owns publishing the output schema to schemastore as part of the output-contract workflow described below.

#### Output contracts taught through schemastore

- `actions-inputs-outputs` now teaches structured outputs as versioned, published JSON Schema documents. Any action with a JSON output runs a pre-write gate before emitting it, and a `SchemaPipeline.check` drift test keeps the published schema and the runtime `Schema` definition from diverging.

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

## 0.2.0

### Features

- Mirrors CLaude Code plugin setup with agents skills and hooks. [#558][#558]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#558]: https://github.com/spencerbeggs/effected/pull/558

## 0.1.0

### Features

#### An experimental Copilot plugin

- `plugins/copilot/` introduces a GitHub Copilot build of the "effected" plugin, alongside the established Claude Code one. It is an experiment: the intent is to find out whether Copilot is usable for `@effected` development, not to reach parity with the Claude Code plugin.

- Copilot and Claude Code describe skills and hooks in similar but incompatible formats, so the agent and skill content is maintained twice. Claude Code is the source of truth — a change lands in `plugins/claude-code/` first and is then copied and refactored into `plugins/copilot/`.

#### Versioning and distribution

- The plugin is tracked by a private workspace package, `@effected/copilot-plugin`, which never publishes to npm. A changeset naming it bumps both `plugins/copilot/package.json` and the plugin manifest `plugins/copilot/plugin.json`, then cuts a git tag and a GitHub release.

- It is distributed from its own Copilot marketplace in `spencerbeggs/bot`, separate from the Claude Code marketplace. That marketplace's ref is bumped by hand for these first versions rather than on release. [#555][#555]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#555]: https://github.com/spencerbeggs/effected/pull/555
