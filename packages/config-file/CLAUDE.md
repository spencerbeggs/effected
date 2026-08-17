# @effected/config-file

Composable config file loading for Effect: pluggable codecs, resolution
strategies and merge behaviors. The repo's **first boundary-tier port**.

**Boundary tier:** it reads and writes files through `effect`-core platform
abstractions — `FileSystem`/`Path` arrive from the consumer's platform layer —
and depends on `effect` and `@effected/*` alone: **zero external runtime
dependencies**. `@effected/*` peers do not change that (tier does not propagate,
R3), but an *external* format parser or crypto library would make it
**integrated** — hence the codecs wrap `@effected/{jsonc,yaml,toml}` and
`internal/crypto.ts` is hand-rolled over **WebCrypto**: `globalThis.crypto.subtle`
for PBKDF2 derivation and AES-GCM, `globalThis.crypto.getRandomValues` for salts
and nonces. **There is no `node:crypto` import, and adding one is a regression** —
the platform global keeps the module runtime-agnostic as well as dependency-free.

**Design doc:** `@../../.claude/design/effected/packages/config-file.md` — load
when changing the pipeline seams, the error set, or the codec boundaries.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `src/ConfigCodec.ts` — `ConfigCodec` (**the interface, type-only**),
  `ConfigCodecError`
- `src/JsonCodec.ts`, `src/JsoncCodec.ts`, `src/YamlCodec.ts`,
  `src/TomlCodec.ts` — one free-standing codec each: `JsonCodec`, `JsoncCodec`,
  `YamlCodec`, `TomlCodec`
- `src/ConfigResolver.ts` — `ConfigResolver` (+ `explicitPath`, `staticDir`,
  `upwardWalk`, `workspaceRoot`, `gitRoot`, `systemEtc`)
- `src/MergeStrategy.ts` — `MergeStrategy` (`firstMatch`, `layeredMerge`),
  `ConfigSource`, `NonEmptySources`
- `src/ConfigFile.ts` — `ConfigFile` (`Service`, `layer`, `testLayer`, `read`),
  `ConfigFileShape`, `ConfigFileOptions`, `ConfigFileTestOptions`,
  `ConfigReadOptions`, and five
  errors: `ConfigFileNotFoundError`, `ConfigFileReadError`,
  `ConfigFileWriteError`, `ConfigDefaultPathMissingError`,
  `ConfigValidationError`
- `src/ConfigEvent.ts` — `ConfigEvent`, `ConfigEventPayload`, `ConfigEvents`,
  `ConfigEventsShape`, `ConfigSourceRef`
- `src/ConfigMigration.ts` — `ConfigMigration`, `ConfigMigrationError`,
  `VersionAccess`, `ConfigFileMigration`, `ConfigMigrationOptions`
- `src/EncryptedCodec.ts` — `EncryptedCodec`, `EncryptedCodecKey`,
  `ConfigEncryptionError`
- `src/ConfigProvider.ts` — `asConfigProvider`, `layerConfigProvider`,
  `LayerConfigProviderOptions`

`ConfigFile`, `ConfigMigration` and `ConfigResolver` are static classes with a
private constructor, not `as const` namespace objects — an `as const` object's
member types are inferred in the built `.d.ts` and lose their TSDoc entirely,
while a class's `static readonly` declarations keep it (the `@effected/commands`
precedent, `11a121e0`). `MergeStrategy` and `EncryptedCodecKey` stay `as const`
objects: both share a name with a same-file generic interface/type declared
without a default type parameter (`MergeStrategy<A>`, `type EncryptedCodecKey`),
and merging a class into either is a TS2300/TS2428 compile error — confirmed
against the installed TypeScript, not assumed. `VersionAccess` also stays `as
const`: its one member is a data value, not a function, so there is no member
TSDoc for the class form to preserve.

## Architecture: codec × resolver × strategy

Three orthogonal seams, composed by `ConfigFile.layer`:

- **Codec** — bytes ⇄ document. Error-generic (`ConfigCodec<E>`) so decorators
  *widen* rather than flatten: `EncryptedCodec` and `ConfigMigration.make` each
  wrap a codec and return one, so encryption + migrations + format compose.
- **Resolver** — where the file is. `resolve`'s error channel is `never` **by
  contract**: `absorb` catches every filesystem failure into `Option.none()`, so
  one unreadable tier never aborts the chain.
- **Strategy** — many sources → one value. Cannot fail; the empty case raises
  `ConfigFileNotFoundError` before a strategy is consulted.

**`parseOptions` threads `SchemaAST.ParseOptions` into every decode**, on
`ConfigFileOptions` and `ConfigReadOptions` alike. It exists for
`onExcessProperty`: core defaults to `"ignore"`, so a config loader silently
drops a user's unknown keys and can report neither a typo'd section nor a field
the schema deliberately removed — the migrating user keeps a dead credential and
is told nothing. `validate` cannot cover it (it runs post-decode, after the
excess keys are gone). A `StructWithRest` rest switches excess checking **off for that struct**, not
merely for the keys it covers — measured, since the shape suggests the reverse.
A deliberate pass-through section therefore survives `"error"`, and structs
without a rest stay strict independently. Default absent = core's
behavior, so it is additive.

`ConfigFile.read(path, { schema, codec })` is the **one-shot** escape from all
three seams: read + decode + validate one explicit path, no service, no layer,
no tag, only `FileSystem` in `R`, schema per CALL rather than per layer. Keep it
read-only and discovery-free — wanting a resolver chain or a write path means
reaching for `ConfigFile.layer`, not growing this. **Never add extension-based
codec inference to it**: the codec is an explicit argument precisely so a
JSON-only consumer never references the JSONC/YAML/TOML modules, and a
"convenience" that picked one by file extension would reach all four and
silently undo the tree-shaking rule below.

`ConfigFile.Service<Self, A>()(id)` is a per-schema `Context.Service` factory.
`ConfigFile.layer` is a layer-*returning function*: bind its result to a const
and provide that const, or you mint two independent service instances.
`ConfigFile.testLayer` seeds files into a temp dir and runs the **real**
`makeImpl` over them — not a mock; it has no `defaultPath`, so `save`/`update`
honestly fail with `ConfigDefaultPathMissingError` under it.

`ConfigFile.update` is serialized by a `Semaphore` (`Semaphore.makeUnsafe(1)`,
then `withPermits(1)`) because load → transform → save is a read-modify-write.
`Effect.makeSemaphore` does not exist in v4 — `Semaphore` is a top-level module.
The lock guards one service instance in one process; it is not a file lock.

`ConfigEvents` is opt-in and zero-cost when absent: omit the `events` option and
`emit` is `Effect.void`, never even looking the service up. `ConfigProvider.ts`
bridges a loaded document into v4's `ConfigProvider`; a missing file stays a
failure rather than degrading to an empty provider.

## The error ladder

The headline port work: one stringly mega-error became **eight
`Schema.TaggedError` types** with per-method unions narrowed to what can
actually happen (`ConfigLoadError`, `ConfigReadError`, `ConfigWriteError`,
`ConfigSaveError`, `ConfigUpdateError`). Causes and schema issues are carried
**structurally** via `Schema.Defect()` — never stringified.

`ConfigDefaultPathMissingError` was added at port time. The design wanted
`save`-without-`defaultPath` to be a *compile* error; that is **unsound**.
`Context.Key<out Identifier, out Shape>` is covariant in `Shape`, so a full-shape
tag satisfies a narrower "no `save`" parameter type and the compile error never
fires. A typed runtime error with an empty field record — no fabricated `path` —
is the honest answer.

## Security-sensitive internals

Read the comments before touching these; each shape is load-bearing.

- **`internal/deepMerge.ts`** builds the result on the target's prototype via
  `Object.create` and copies keys with `Object.defineProperty`, **never**
  assignment and **never** `Object.assign`. A bare `result[k] = v` uses `[[Set]]`
  semantics and fires `Object.prototype`'s inherited `__proto__` accessor — that
  is prototype pollution, and it was a real regression caught in review.
  `__proto__` / `constructor` / `prototype` are filtered from **both** sides.
  Two values merge only if both are record-like **and share a prototype**, so a
  decoded `Schema.Class` survives a merge as a real instance.
- **`isWorkspaceRoot`'s `try`/`catch` around `JSON.parse`** (`ConfigResolver.ts`)
  is load-bearing. A parse throw is a defect, not a failure; `Walker.firstMatch`
  (which `findRoot` calls into) absorbs failures with `Effect.catch`, which does
  **not** catch defects. Without the `try`/`catch`, a malformed `package.json`
  would leak a defect through a predicate whose error channel is typed
  `PlatformError.PlatformError`, not `never`. Removing it is a regression, not a
  simplification.
- **`internal/crypto.ts`** uses PBKDF2 at **600,000** iterations (OWASP) and
  imports **nothing** from the package — it defines its own `CryptoFailure` union
  so Biome's error-level `noImportCycles` stays satisfied. `EncryptedCodec` lifts
  it into `ConfigEncryptionError`.

## The codecs: free-standing exports, never a namespace object

All four codecs live here; the `config-file-jsonc` / `-yaml` / `-toml` siblings
are **gone**, dissolved into this package. The **format** packages
`@effected/jsonc`, `@effected/yaml` and `@effected/toml` stay independent and
untouched — the codecs are thin adapters over them. Direction is strictly
acyclic: **config-file → format packages, never the reverse.**

**Never collect the codecs into a namespace object.** The old
`ConfigCodec = { json }` is deleted and must not return in any form — not
`ConfigCodec.json`, not a `Codecs` record, not a `codecs` map. A namespace object
is a barrel with different syntax: referencing it reaches *every* codec, each
codec reaches its parsing engine, and a JSON-only consumer drags the JSONC, YAML
and TOML engines into their bundle. **Tree-shaking dies silently** — no error, no
warning, just a fat bundle. Free-standing named exports, one module each, are the
whole reason the consolidation was safe to do.

`@effected/{jsonc,toml,yaml,walker}` are each a `workspace:^` peer (so a
published patch floats) mirrored by a plain `workspace:*` `devDependency` — the
two specifiers now deliberately differ (the `@effected/walker` precedent).
Runtime `dependencies` stays empty.

**`internal/walkUp.ts` is gone.** `@effected/walker` landed and the resolvers
— `upwardWalk`, `rootAnchored` (and through it `gitRoot`/`workspaceRoot`) — are
now expressed over `Walker.ascend`, `Walker.findUpward` and `Walker.findRoot`.

## Testing and building

Tests live in `__test__/` (14 files, 154 passing), use `@effect/vitest`, and
assert with `assert.*` — **never** `expect`.

```bash
pnpm vitest run --project @effected/config-file
pnpm build --filter @effected/config-file   # from the repo root
```

- `it.effect` **always** installs a virtual `TestClock`, so `Effect.sleep`,
  `delay` and `timeout` hang silently until the vitest timeout.
- `savvy.build.ts` carries a **narrow** suppression
  `{ messageId: "ae-forgotten-export", pattern: "_base" }`. Never widen it.
