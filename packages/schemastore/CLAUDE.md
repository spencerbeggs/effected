# @effected/schemastore

Build, version, validate and lint SchemaStore-shaped Draft-07 JSON Schema
documents from Effect Schema sources: assembly over core's
`Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`, the
declared keyword families, the catalog vocabulary in both versioning modes,
structural and hygiene lints, canonical JSON text, write-if-changed IO with
change classification, and the validation **contracts** — `SchemaValidator`
(documents) and `InstanceValidator` (payloads) — whose one shipped engine
each is `@effected/engine/schema`'s `AjvValidator` and
`AjvInstanceValidator`.

Tier: **boundary**. The one runtime dependency is `@effected/semver`;
`effect` is the peer. All IO lives in `src/SchemaFile.ts` over core
`FileSystem`/`Path` required in `R`; every other module is pure — keep it
that way. **No ajv here, ever** — an application that imports this package
at runtime (for `HostedSchema`) must never pull an engine into its install.

## Knowledge bundle

Durable knowledge lives in `okf/`, not here. Start at `okf/modules/schemastore.md`
and follow its links; load the specific concept a task needs:

- Design, module surface, scope fence, tier history, annotation admission,
  versioning grammar, `defineConfig`/`HostedSchema`, the pipeline's two
  policies, and the test layout → `okf/modules/schemastore.md` — Load when:
  changing an emitted shape, the versioning grammar, the config contract
  or the gating model, or asking what a module owns.
- Why the engines live in `@effected/engine` and the library ships only the contracts →
  `okf/decisions/schemastore-engine-lives-in-the-cli.md`,
  `okf/decisions/schemastore-ajv-ships-closed.md`,
  `okf/decisions/schemastore-retier-to-integrated.md` (superseded) — Load
  when: tempted to add an engine, an ajv import or a `layerDefault`
  (`okf/decisions/schemastore-no-layer-default.md`).
- Closed objects by default, and the target-level `jsonSchema` option that
  reopens one document → `okf/decisions/schemastore-closed-objects-by-default.md`
  — Load when: a consumer's document gained or lost `additionalProperties: false`.
- Write-if-changed compares content, and `outcome`/`wouldWrite` versus
  `change` → `okf/decisions/schemastore-write-if-changed-compares-content.md`
  — Load when: touching `SchemaFile` or a CI drift check.
- The `x-ai-` namespace's edges (ajv keyword grammar, `$id` inside a
  payload) → `okf/limitations/schemastore-declared-family-keys-are-bounded-by-ajv.md`
  — Load when: a declared key fails the engine gate as a finding.
- `"2"` enumerating ahead of `"1.5"` in a catalog `versions` map →
  `okf/gotchas/bare-major-version-key-enumerates-first.md`.
- `DRAFT_07_META_SCHEMA` keeping its trailing `#` →
  `okf/decisions/schemastore-meta-schema-keeps-trailing-hash.md`.
- Module naming, no `SchemaVersioning.plan`, no `bin`, no templates directory,
  coverage tooling → the remaining `okf/decisions/schemastore-*.md`.
- The `effected schema` command, its drift table and exit codes, and the engines
  `AjvValidator` / `AjvInstanceValidator`
  (including the `ajvFormats.default` one-hop binding,
  `okf/gotchas/ajv-formats-default-import-is-not-callable.md`) →
  `okf/modules/engine.md`, `okf/modules/cli.md` — Load when: a change here alters what
  the tool reads from the library.

Before changing what the Draft-07 lowering does or does not carry, read
`__test__/annotation-carrying.test.ts` — it pins core's behaviour directly,
with no package code in the assertion path — rather than restating the
mechanism from memory.

## Working here

Tests live in `__test__/` (`@effect/vitest`, `assert.*` — never `expect`);
`SchemaFile`'s real-IO tests are under `__test__/integration/`.

```bash
pnpm vitest run packages/schemastore --coverage.enabled=false
pnpm build --filter @effected/schemastore
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`
and leaves a truncated `issues.json` shaped like a clean gate.

`savvy.build.ts` carries one narrow suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the heritage
symbols; `SchemaTarget`'s class/interface merge carries the house
`biome-ignore lint/suspicious/noUnsafeDeclarationMerging` with the
statics-only justification. `internal/limits.ts`'s `MAX_NESTING_DEPTH` is
mirrored by the engine's `schema/internal/ajv.ts` — the shared `makeAjv` both
engines (`AjvValidator`, `AjvInstanceValidator`) build through carries the
same limit as `MAX_KEYWORD_WALK_DEPTH` — change both together.
`package.json` stays `"private": true` — the bundler emits the publishable
manifest.
