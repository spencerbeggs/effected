# @effected/config-file

Composable config file loading for Effect: pluggable codecs, resolution
strategies and merge behaviors. Fifth migrated package and the **first
boundary-tier port** (`@effected/package-json`, which also does file IO, is
integrated tier for its lone external dependency).

**Boundary tier:** it reads and writes files through `effect`-core platform
abstractions — `FileSystem`/`Path` arrive from the consumer's platform layer —
and depends on `effect` (its only peer) and `@effected/*` alone. That
effect-only-plus-IO profile *is* boundary tier; it takes no external runtime
dependency. Taking a format parser or a crypto library would make it
**integrated**, which is exactly why those live in sibling packages.

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

## Package family

The JSON codec lives in core because it is free. Format codecs live in siblings
— `@effected/config-file-jsonc`, `@effected/config-file-yaml`, later
`@effected/config-file-toml` — because this monorepo **does not use subpath
exports**, so each optional dependency becomes a package. Dependency direction is
strictly acyclic: **config-file → format packages, never the reverse.**

**`internal/walkUp.ts` is gone.** `@effected/walker` landed and the resolvers
— `upwardWalk`, `rootAnchored` (and through it `gitRoot`/`workspaceRoot`) — are
now expressed over `Walker.ascend`, `Walker.findUpward` and `Walker.findRoot`.
`@effected/walker` is **boundary tier**; depending on it does not change
config-file's own tier — tier 2 does not propagate (R3), so config-file stays
boundary. The new edge is `"@effected/walker": "workspace:*"` in both
`devDependencies` and `peerDependencies`, matching how
`@effected/config-file-jsonc` declares its workspace deps. Runtime
`dependencies` is still empty.

## Testing and building

Tests live in `__test__/` (11 files, 124 passing), use `@effect/vitest`, and
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
