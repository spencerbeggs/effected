# Review: config-file-effect → @effected/config-file

Reviewed: 2026-07-06. Source: `/Users/spencer/workspaces/spencerbeggs/config-file-effect` (v0.3.0, Effect 3.21+).
Target tier: **boundary** (per package-inventory.md). Judged against
`.claude/design/effected/effect-standards.md`; v3 idioms are not counted as defects — design is.

## 1. What is done well

### The pipeline decomposition is the right architecture

The core abstraction — **codec** (how to parse/write) x **resolver** (where to look) x
**strategy** (how to combine multiple sources) — is a genuinely good factoring. Each seam is a
small interface (`ConfigCodec`, `ConfigResolver`, `ConfigWalkStrategy`), all built-ins are just
values of those interfaces, and consumers can supply their own without forking. This decomposition
should survive the port intact.

### Codec composition via decorators

`EncryptedCodec(inner, key)` and `ConfigMigration.make({ codec, migrations })` both wrap a
`ConfigCodec` and return a `ConfigCodec`, so encryption + migrations + format compose freely
(`ConfigMigration.make({ codec: EncryptedCodec(JsonCodec, key), ... })`). This is a clean
decorator pattern worth preserving verbatim as a design (the encryption implementation itself —
AES-GCM, IV-prefix layout, PBKDF2 with cached derivation, Windows-safe BufferSource copies — is
careful, well-commented code).

### Error-absorbing resolvers

Resolvers return `Effect<Option<string>>` with **all** errors caught to `Option.none()` — a
permission-denied on one tier never aborts the chain. This is a deliberate, documented policy
(stated in TSDoc on every resolver) and it is the right call for discovery.

### Per-schema generic services

`ConfigFile.Tag<A>(id)` produces a uniquely-keyed tag per config schema, so multiple typed config
services coexist in one layer graph. The *need* (parameterized service identity) is real and the
API shape — consumer names the tag, library builds the layer — is good DX. Only the v3 mechanism
(`Context.GenericTag` factory) is dated.

### Opt-in observability with honest zero-cost fallback

The events system is opt-in via an optional `events` tag in the options; when absent, `emit` is
`Effect.void`. Event payloads are already schema-first (`Schema.Union` of `Schema.TaggedStruct`,
`ConfigEvent` as `Schema.Class` with `Schema.DateTimeUtc`) — this file is closer to v4 style than
anything else in the repo.

### Scoped test layer

`ConfigFile.Test` seeds files into place, registers a finalizer to remove them, and reuses the
*real* live implementation underneath (`makeConfigFileLiveImpl(options)`), so tests exercise the
actual pipeline rather than a parallel mock. Platform-agnostic (consumer supplies the FileSystem
layer). Very good testing DX; keep the concept.

### Boundary-tier posture is already correct

All IO goes through `@effect/platform` `FileSystem`/`Path`; the package never touches `node:fs`.
The consumer provides `NodeFileSystem.layer` at the edge — exactly the boundary-tier contract the
standards require.

### Small, coherent service surface

`load` / `loadFrom` / `loadOrDefault` / `discover` / `save` / `write` / `update` / `validate` is a
well-scoped set with sensible distinctions (`save` = default path + mkdir -p; `write` = explicit
path, no mkdir — documented). `update` = load→transform→save is a nice ergonomic. Documentation
discipline (TSDoc on everything, 9 topic docs, thorough README) is exemplary.

## 2. What is confusing or awkward

### One mega-error, stringly typed — the opposite of error proliferation

`ConfigError` has `operation: string` (open-ended), `path?: string`, `reason: string`. Every
failure in the pipeline — fs read, codec parse, schema decode, custom validate, resolution empty,
save without defaultPath — is flattened into it via `Effect.mapError((e) => new ConfigError({ ...,
reason: String(e) }))`. Consequences:

- `catchTag("ConfigError")` cannot distinguish "no config found" from "TOML syntax error" without
  string-matching `operation`. The README's own recovery example catches everything.
- Structured causes are destroyed: a `CodecError` with codec/operation fields becomes
  `reason: "CodecError: ..."`. `ParseError` from schema decode becomes a giant string. This directly
  violates the standards' "never collapse errors to string/unknown early" and "wrap foreign errors
  with a `cause` field".
- `ConfigMigration` compounds it: migration failures are re-wrapped into `CodecError` with
  hand-assembled reason strings (`migration "x" (v2) failed: ...`) so the wrapper still satisfies
  `ConfigCodec` — the error channel of the codec interface is forcing information loss.

### Namespace-object pseudo-modules and Impl leakage

`ConfigFile = { Tag, Live, Test }`, `ConfigEvents = { Tag, Live }`, `ConfigWatcher = { Tag, Live }`,
`ConfigMigration = { make }`, `VersionAccess = { default }` are const objects simulating classes.
Partly a v3 limitation for generic services, but the seams show: the actual implementations are
exported as `makeConfigFileLiveImpl` and `ConfigFileTestImpl` from `layers/` and re-dressed in
`services/ConfigFile.ts`. Three files (service interface, live layer, test layer) for one concept.

### Kind-based folder sprawl

Nine `src/` folders (`codecs/`, `errors/`, `events/`, `layers/`, `migrations/`, `resolvers/`,
`services/`, `strategies/`, `watcher/`), several holding a single small file
(`errors/ConfigError.ts` is ~36 lines). Exactly the layout the standards supersede.
`ConfigErrorBase`/`CodecErrorBase` are exported *solely* as a declaration-bundling workaround —
public API surface that exists for the build tool.

### Misleading names

- `ConfigWalkStrategy` is a **merge/selection** strategy; it never walks anything. The thing that
  walks is the `UpwardWalk` *resolver*. Rename to `MergeStrategy`/`ResolutionStrategy`.
- `ConfigSource.tier` holds the resolver's `name` — "tier" is never defined anywhere.
- Resolver `name` values (`"walk"`, `"git"`, `"static"`, `"explicit"`, `"system"`, `"workspace"`)
  are stringly identifiers with no type.

### `any` suppression of the R channel

The R channel is systematically cast away rather than flowed:

- `resolvers: ReadonlyArray<ConfigResolver<any>>` and then
  `Effect.provideService(resolver.resolve, FileSystem.FileSystem, fs) as Effect.Effect<Option<string>>`
  — an unchecked assertion that FileSystem is the only requirement a resolver can have.
- `defaultPath?: Effect<string, ConfigError, any>` with a comment "cast away R here" inside `save`.
- `FirstMatch`/`LayeredMerge` are `ConfigWalkStrategy<any>` singletons.

The layer's declared type `Layer<Service, never, FileSystem>` is therefore a claim, not a proof.
In the redesign, resolver/defaultPath requirements should flow into the layer's R type.

### Boundary-violating internal `Effect.provide`

Every resolver (and the Live layer, and the Test layer) calls `Effect.provide(Path.layer)`
internally. Standards: provide at boundaries only. `Path` should be a requirement satisfied once
by the consumer's platform layer alongside FileSystem.

### Duplication and dead surface

- `load` and `loadOrDefault` copy-paste the resolve-and-emit block (`resolveAndEmit` exists but
  `loadOrDefault` re-inlines it).
- `UpwardWalk`, `GitRoot`, `WorkspaceRoot` each hand-roll the same walk-up-until-root loop.
- `ConfigCodec.extensions` is declared on every codec and **never read** by the pipeline.
- Event variants `Stringified` and `ResolutionFailed` are defined in the union and **never
  emitted**. `ConfigFileMigration.down` is defined and never invoked.
- `CodecError.operation` includes `"key-derivation"`, an encryption-only concern leaking into the
  generic codec error.

### Event semantics are approximate

`Resolved`/`Loaded` always report `sources[0].path` — wrong for `LayeredMerge`, where every source
contributed. `update` emits `Written` + `Saved` + `Updated` for one call (documented, but a smell
that event granularity was bolted on rather than designed per-operation).

### Watcher weaknesses

- Change detection via `JSON.stringify` comparison — should be `Equal`/Schema-derived equivalence.
- `loadFrom` failures are swallowed to `Option.none()`, so a config file that becomes *corrupt*
  is indistinguishable from one that was *deleted*.
- `AbortSignal` option is un-Effect-ish; fiber interruption already covers this.
- Polling-only; `FileSystem.watch` exists on the platform abstraction and isn't offered.

### No span/log instrumentation

Zero `Effect.withSpan`/`Effect.fn`/`Effect.log*` anywhere. The custom PubSub event system is
partially reinventing tracing. Per the standards, the operations themselves should be `Effect.fn`
named spans; the PubSub lifecycle events can remain as a *consumer-facing hook*, but they should
not be the only observability channel.

### Tests are plain vitest

All tests are `it()` + `Effect.runPromise`/`runPromiseExit`, layers re-provided per test body.
Standards require `it.effect` + top-level `layer(...)` grouping. Coverage breadth is good
(~1.8k lines, integration tests with real fixtures, snapshot tests) — the migration cost is
mechanical, not conceptual.

## 3. v4 migration implications

| v3 construct (here) | v4 target |
| --- | --- |
| `Context.GenericTag<ConfigFileService<A>>(...)` factory | Keep a keyed-tag factory for the generic case (v4 tag/key creation supports generics fine), or better: expose a class factory so consumers write `class MyConfig extends ConfigFile.Service<MyConfigSchema>("my-tool/Config") {}` — identifier + shape in one consumer-owned artifact, matching the `Context.Service` standard |
| `Data.TaggedError("ConfigError")<{...}>` + `Base` export hack | `Schema.TaggedErrorClass` ladder (see §"Error redesign" below); the `*Base` re-export workaround disappears |
| `Schema.Union(Schema.TaggedStruct(...))` events + `Schema.Class` ConfigEvent | Near-1:1 port; verify v4 Schema union/tagged-struct API names, add `.annotate` metadata |
| `Schema.decodeUnknown(schema)(parsed)` | `Schema.decodeUnknownEffect`; normalize `SchemaError` to the domain error at this boundary via `catchTag("SchemaError", ...)` instead of `mapError(String)` |
| `import { FileSystem, Path } from "@effect/platform"` | v4: platform abstractions live in `effect` core — the `@effect/platform` peer disappears entirely; `@effect/platform-node` remains the consumer-provided optional peer |
| `Effect.gen` anonymous bodies | `Effect.fn("ConfigFile.load")` etc. for every service method; `Effect.withSpan` around codec parse / resolver probe sub-steps |
| `Layer.effect(tag, ...)` / `Layer.unwrapScoped` | Same concepts exist in v4; test layer stays `Layer` + scoped finalizers |
| `PubSub`, `Stream`, `Ref`, `Schedule`, `DateTime` | All present in v4; mechanical |
| Plain vitest tests | `@effect/vitest` `it.effect`, top-level `layer(...)` groups, `TestClock.adjust` for the watcher poll tests (currently real-time sleeps) |

### v4 core Config is directly relevant

v4 overhauled `Config`/`ConfigProvider` (simpler key-value provider model, provider composition/
fallback). This creates a design opportunity the v3 library couldn't have: expose a loaded +
merged config file **as a `ConfigProvider`**, so consumers can read it through standard
`Config.string("port")` accessors and layer it with env-var providers
(`ConfigProvider.orElse`-style: env → project file → git-root file → /etc). Notably,
`FirstMatch`/`LayeredMerge` semantics map naturally onto provider fallback/merge composition.
Recommendation: keep the schema-validated whole-document `load` as the primary API (that is the
package's core value — v4 Config has no schema-validated document story), and add
`ConfigFile.asConfigProvider` / a `Layer<ConfigProvider>` as an additive integration.

### Error redesign (do not port `ConfigError` as-is)

Replace the one mega-error with a small `Schema.TaggedErrorClass` ladder defined in the module
files of the concepts that raise them:

- `ConfigFileNotFoundError` (resolution produced zero sources — currently `operation: "resolve"`)
- `ConfigFileReadError` / `ConfigFileWriteError` (fs failures, `cause: Schema.Defect`)
- `ConfigCodecError` (parse/stringify, carries codec name + `cause`; encryption gets its own
  `ConfigEncryptionError` instead of the `"key-derivation"` operation string)
- `ConfigValidationError` (schema decode / custom validate, carries the structured schema issue,
  not `String(ParseError)`)
- `ConfigMigrationError` (version read/write + migration step failures, carries `version`, `name`,
  `cause` — no more reason-string assembly)

That is 5–6 errors for genuinely distinct recovery paths — not proliferation, and each becomes
`catchTag`-routable. Service methods' error unions narrow accordingly (`loadOrDefault` should not
be able to fail with NotFound, `write` cannot fail with NotFound, etc.).

## 4. Candidate module-per-concept layout

```text
src/
  index.ts             # re-exports only
  ConfigFile.ts        # the service: generic service/tag factory, ConfigFileOptions,
                       # Live + Test layers, load/save/... errors (NotFound, Read, Write,
                       # Validation) — replaces services/ConfigFile.ts,
                       # layers/ConfigFileLive.ts, layers/ConfigFileTest.ts, errors/ConfigError.ts
  ConfigCodec.ts       # codec seam + ConfigCodecError; built-ins as statics:
                       # ConfigCodec.json, ConfigCodec.toml (drops the unused `extensions` field
                       # or actually uses it) — replaces codecs/ConfigCodec.ts, JsonCodec.ts,
                       # TomlCodec.ts, errors/CodecError.ts
  EncryptedCodec.ts    # AES-GCM wrapper, key model (CryptoKey | Passphrase),
                       # ConfigEncryptionError — crypto internals move to internal/crypto.ts
  ConfigMigration.ts   # migration steps, VersionAccess, ConfigMigrationError; drop unused `down`
                       # or implement it
  ConfigResolver.ts    # resolver seam; six built-ins as statics: ConfigResolver.explicitPath,
                       # .staticDir, .upwardWalk, .workspaceRoot, .gitRoot, .systemEtc — the
                       # shared walk-up loop moves to internal/walkUp.ts
  MergeStrategy.ts     # rename of ConfigWalkStrategy; ConfigSource model (rename `tier`);
                       # statics MergeStrategy.firstMatch, MergeStrategy.layeredMerge —
                       # deepMerge moves to internal/deepMerge.ts
  ConfigEvent.ts       # payload union + ConfigEvent class + the ConfigEvents service/layer
                       # (merge events/ConfigEvent.ts + events/ConfigEvents.ts; prune the
                       # never-emitted variants or emit them)
  ConfigWatcher.ts     # watcher service + ConfigFileChange model + errors; redesign equality
                       # (Equal / schema equivalence) and drop AbortSignal
  internal/
    walkUp.ts          # shared ascend-until-root iteration
    deepMerge.ts
    crypto.ts          # PBKDF2 derivation, IV framing, base64 helpers
```

Nine folders + 17 files collapse to 9 concept files + 3 internal helpers. Every public name is a
file name.

## 5. Extraction / split / seam candidates; division of labor vs siblings

### Current state of the sibling edges

Despite the conceptual overlap, **no dependency edge exists today**: `package.json` runtime deps
are `smol-toml` only. jsonc-effect and yaml-effect each own a full parse/stringify/format/visitor
pipeline plus Schema integration (`makeJsoncSchema`, `YamlFromString`); json-schema-effect owns
JSON Schema generation/validation plus TOML tooling annotations (Taplo/Tombi) — none of them are
consumed here. `JsonCodec` uses bare `JSON.parse`; there is no YAML or JSONC codec at all.

### The right division

The pipeline seam already answers this: **format packages own parsing; config-file owns the
loading pipeline and the codec seam.**

- `ConfigCodec` interface lives in `@effected/config-file` (it is the package's plug contract).
- Ship only the zero-dependency JSON codec in core.
- **TOML**: move `ConfigCodec.toml` behind a subpath export (`@effected/config-file/toml`) or
  make `smol-toml` an optional peer, so JSON-only consumers do not carry the TOML parser. (With
  `sideEffects: false` tree-shaking mostly saves bundlers, but node consumers still install it.)
  Longer-term question for the monorepo: whether a `@effected/toml` sibling should exist and own
  this, given json-schema-effect already carries TOML *tooling* concerns.
- **JSONC / YAML**: provide adapter codecs over `@effected/jsonc` and `@effected/yaml` as subpath
  exports with optional `workspace:*` peers (`@effected/config-file/yaml` →
  `ConfigCodec.yaml` backed by yaml-effect). The format packages stay pure and unaware of
  config-file; the adapters are ~20 lines each. This keeps the dependency direction acyclic:
  config-file → format packages, never the reverse.
- **json-schema-effect**: keep it *out* of the core edge set. Its natural integration is DX
  tooling — emitting a `$schema`-referenced JSON Schema (or Taplo/Tombi headers) for a consumer's
  config schema so editors validate config files. That is a scaffolding concern that belongs
  either in an optional subpath (`@effected/config-file/scaffold`) or in the consuming app.
  In v4, `Schema.toJsonSchemaDocument` in core may cover part of what json-schema-effect does —
  re-evaluate that package's remit before wiring the edge.

### Split candidates within the package

- **EncryptedCodec** is the strongest split candidate: ~230 lines of WebCrypto orthogonal to
  config loading, useful for any string-at-rest encryption. Verdict: keep as a concept file in v1
  of the port (splitting adds a package for one consumer), but keep `internal/crypto.ts` clean so
  extraction stays cheap.
- **ConfigWatcher** could be deferred out of the initial port entirely — it needs redesign
  (equality, error visibility, `FileSystem.watch` vs polling) and no other feature depends on it.
- **Resolvers** (`WorkspaceRoot`, `GitRoot`) overlap with what a future `@effected/workspaces` /
  runtime-resolver package might own (monorepo-root detection is a general capability). For now
  they are small and self-contained; note the seam, do not split yet.
- **xdg-effect** is the known upstream consumer (this package was extracted from it) — the port
  should keep the "zero XDG coupling" property; XDG-specific resolvers belong in
  `@effected/xdg` composed on top of `ConfigResolver`.

## 6. Peer / dependency hygiene

Current state is **good for v3** — this is one of the cleaner repos:

- `peerDependencies`: `effect`, `@effect/platform`, `@effect/platform-node` (optional) — all
  `catalog:silkPeers`. The closure is complete: `@effect/platform` peers on `effect` (declared);
  `@effect/platform-node` peers on `@effect/platform` + `effect` (both declared). No unfulfilled
  transitive peers escaping to consumers.
- Runtime `dependencies`: `smol-toml` only. Minimal and honest (see §5 for making it optional).
- `devDependencies` pin the full silk catalog (`@effect/cluster`, `@effect/rpc`, `@effect/sql`
  present only to satisfy the dev-time catalog closure — they never appear in source).
- `sideEffects: false`, source-exports + build-time `publishConfig` transform per template
  standard.

**v4 changes**: `@effect/platform` peer disappears (merged into `effect` core — the v4 catalog has
no plain `@effect/platform`), leaving peers = `effect` (+ optional `@effect/platform-node` for the
consumer's edge only; the library itself should not need it even optionally, since it programs
against core abstractions). New optional-peer decisions arrive with the codec adapters:
`@effected/jsonc`, `@effected/yaml` (`workspace:*`, optional, subpath-gated), and
`smol-toml` (optional or subpath).

## Priority recommendations for the design doc

1. Preserve: pipeline decomposition, codec decorators, error-absorbing resolvers, scoped test
   layer, opt-in events, per-schema service identity.
2. Redesign: the error model (5–6 `Schema.TaggedErrorClass` types with `cause` fields, per-method
   narrowed unions) — this is the single biggest quality lift.
3. Restructure: 9 concept files per §4; kill the `Base` exports, `Impl` exports, and namespace
   const-objects in favor of v4 class-based services/statics.
4. Fix the type-safety debt: flow resolver/defaultPath R into the layer type instead of `any`
   casts; require `Path` at the boundary instead of internal `Effect.provide(Path.layer)`.
5. Add: `Effect.fn` spans on all service methods; `ConfigProvider` integration as an additive v4
   API; `it.effect` test migration with `TestClock` for watcher tests.
6. Defer/decide: watcher redesign (possibly phase 2); TOML/JSONC/YAML codec packaging (subpath
   exports with optional peers); json-schema-effect edge stays out of core.
