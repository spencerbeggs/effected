# @effected/config-file

Composable config file loading for Effect: pluggable codecs, resolution
strategies and merge behaviors. Fifth migrated package and the **second
boundary-tier port**, after `@effected/package-json`.

**Boundary tier:** it reads and writes files. Even so it carries **zero runtime
dependencies** — `effect` is its only peer, and `FileSystem`/`Path` arrive from
the consumer's platform layer. Keep it that way: a format parser or a crypto
library belongs in a sibling package.

**Design doc:** `@../../.claude/design/effected/packages/config-file.md` — load
when changing the pipeline seams, the error set, or the package family
boundaries.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `src/ConfigCodec.ts` — `ConfigCodec` (+ `.json`), `ConfigCodecError`
- `src/ConfigResolver.ts` — `ConfigResolver` (+ `explicitPath`, `staticDir`,
  `upwardWalk`, `workspaceRoot`, `gitRoot`, `systemEtc`)
- `src/MergeStrategy.ts` — `MergeStrategy` (`firstMatch`, `layeredMerge`),
  `ConfigSource`, `NonEmptySources`
- `src/ConfigFile.ts` — `ConfigFile` (`Service`, `layer`, `testLayer`),
  `ConfigFileShape`, `ConfigFileOptions`, `ConfigFileTestOptions`, and five
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
`Schema.TaggedErrorClass` types** with per-method unions narrowed to what can
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
- **`internal/walkUp.ts`** absorbs **each probe individually**
  (`Effect.catch(exists(candidate), () => Effect.succeed(false))`), so one
  `EACCES` ancestor does not abort the ascent — absorbing only at the resolver
  boundary would turn that into a silent `Option.none()`. Error channel is
  `never`; `ascend` is bounded by `dirname`'s root fixpoint plus `maxDepth`.
- **`internal/crypto.ts`** uses PBKDF2 at **600,000** iterations (OWASP) and
  imports **nothing** from the package — it defines its own `CryptoFailure` union
  so Biome's error-level `noImportCycles` stays satisfied. `EncryptedCodec` lifts
  it into `ConfigEncryptionError`.

## Package family

The JSON codec lives in core because it is free. Format codecs live in siblings
— `@effected/config-file-jsonc`, `@effected/config-file-yaml`, later
`@effected/config-file-toml` — because this monorepo **does not use subpath
exports**, so each optional dependency becomes a package. Dependency direction is
strictly acyclic: **config-file → format packages, never the reverse.**

**Planned:** when `@effected/walker` lands, `internal/walkUp.ts` is deleted and
the resolvers are re-expressed over walker's primitives. `walkUp.ts` is already
pure with its probe injected, so the extraction is a move, not a redesign — the
core trades its zero-dependency property for one `workspace:*` edge.

## Testing and building

Tests live in `__test__/` (11 files, 120 passing), use `@effect/vitest`, and
assert with `assert.*` — **never** `expect`.

```bash
pnpm vitest run --project @effected/config-file
pnpm build --filter @effected/config-file   # from the repo root
```

- `it.effect` **always** installs a virtual `TestClock`, so `Effect.sleep`,
  `delay` and `timeout` hang silently until the vitest timeout.
- Never run `node savvy.build.ts --target prod` directly. It skips `build:dev`,
  emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a
  clean gate.
- `savvy.build.ts` carries a **narrow** suppression
  `{ messageId: "ae-forgotten-export", pattern: "_base" }`. Never widen it.
