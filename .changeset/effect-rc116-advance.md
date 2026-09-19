---
"@effected/app": minor
"@effected/claude-code-plugin": minor
"@effected/cli": minor
"@effected/commands": minor
"@effected/config-file": minor
"@effected/copilot-plugin": minor
"@effected/git": minor
"@effected/github": minor
"@effected/github-actions": minor
"@effected/github-references": minor
"@effected/glob": minor
"@effected/jsonc": minor
"@effected/jsonl": minor
"@effected/lockfiles": minor
"@effected/markdown": minor
"@effected/memfs": minor
"@effected/npm": minor
"@effected/package-json": minor
"@effected/pnpm-plugin-effect": minor
"@effected/runtimes": minor
"@effected/sbom": minor
"@effected/schema-org": minor
"@effected/schemastore": minor
"@effected/schemastore-cli": minor
"@effected/semver": minor
"@effected/spdx": minor
"@effected/store": minor
"@effected/templates": minor
"@effected/toml": minor
"@effected/tsconfig-json": minor
"@effected/walker": minor
"@effected/workspaces": minor
"@effected/xdg": minor
"@effected/yaml": minor
---

## Breaking Changes

### The whole kit tracks Effect `4.0.0-rc.116`

Every package's `effect` peer moves from `4.0.0-rc.115` to `4.0.0-rc.116`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. No `@effected` API changes shape on this advance; the kit itself needed one edit (`Stream.scan` now takes a lazy initial state, met once in `@effected/jsonl`'s `Journal.projection`). A consumer that upgrades meets the rc.116 renames on its own code:

- `SchemaTransformation.make` is `makeTransformation`, and `Transformation#compose` is the dual standalone `SchemaTransformation.composeTransformation`.
- `SchemaGetter.Getter` is a tagged union exposing only `pipe`: `new SchemaGetter.Getter`, `onSome` and `onNone` are gone in favour of `SchemaGetter.map` / `compose` / `run` and `transformEffect` / `transformOptionalEffect`.
- `Stream.scan` and `Stream.scanEffect` take `() => initial`; `Stream.partition` returns `[passes, fails]`; `Stream.mapBoth` takes `onElement` / `onError`.
- `Effect.orElseSucceed` passes the error to its fallback and `Effect.isEffect` narrows to `Effect<unknown, unknown, unknown>`.
- `ByteSize.Input` string literals are checked at compile time; parse external strings with `ByteSize.fromString`.
- Arbitrary shrinking changed, so property-test replay tokens recorded at rc.115 no longer reproduce.

## Documentation

### The Claude Code and Copilot plugins teach the rc.116 surface

The `effect-v4-schema` transformation reference composes transformations with `SchemaTransformation.composeTransformation` and describes the `Getter` surface rc.116 left behind; the source-lookup and testing skills report rc.116 as the kit's pin and the two-copy lockfile shape the bridge now produces (`rc.115` for the toolchain, `rc.116` for the kit); the session-start briefing reports rc.116.

## Maintenance

### The rc.115 `packageExtensions` bridge is retired

The toolchain (`@savvy-web/tsdown-plugins`, `rolldown-pnpm-config`, `@vitest-agent/*`) has republished declaring `effect` and its `@effected/*` inputs as regular dependencies, so the workspace no longer needs the `packageExtensions` block that pinned them by hand. Its ten keys named versions no longer installed and the lockfile diff on removal was the checksum line alone. Nothing published changes; this is the workspace's own install shape.

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| effect | peerDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
