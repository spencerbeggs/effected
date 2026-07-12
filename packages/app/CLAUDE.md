# @effected/app

The application control plane: one layer wiring XDG-namespaced directories, a
migrated SQLite `Store`, a TTL `Cache` and a config file to the same place.
The **fifteenth and final** migration — and the seventeenth workspace package,
after the sixteen merged before it. The only greenfield one: it is the honest
successor to the v3 glue the `xdg` and `store` ports deliberately parked
(`XdgFullLive`, `SqliteStateXdgLive`, `SqliteCacheXdgLive`).

**Design doc:** `@../../.claude/design/effected/packages/app.md`

## It owns no domain logic — that is the whole identity

This is a **composition layer**. It defines **no service, no schema, no error
class**, and it **re-exports nothing** from the packages beneath it. The entire
public surface is layer factories, one config preset and one type alias.

If a change here wants a `Context.Service`, that is the signal the change
belongs in `xdg`, `store` or `config-file` instead. A consumer who wants config
files alone takes `config-file` alone.

## Tier: integrated

Integrated by **R2 alone**: `@effected/store` is tier 3 (through
`@effect/sql-sqlite-node`) and tier 3 propagates. This package has **zero
runtime dependencies of its own** and does no IO the three packages beneath it
do not already do. Its tier is inherited, not earned.

`peerDependencies` is `effect` plus `@effected/xdg`, `@effected/store` and
`@effected/config-file` (each `workspace:*`, mirrored into `devDependencies`).
They are **peers, not regular dependencies**, because each appears in this
package's public signature types — a second copy of `AppDirs` or `Store` in a
consumer's graph would mint two service tags for one concept and the layer would
silently fail to satisfy the requirement.

**Nothing may depend on `@effected/app`.** A library taking an application
control plane drags tier 3 into its consumers under R2 — the leak the taxonomy
exists to prevent. This is also why no consumer was blocked on it and why it
could be sequenced last.

## Four modules, and the split is load-bearing

`App.ts` (`AppOptions`, `AppTestOptions`, `AppError`, `App.layer`,
`App.layerTest`) · `AppStore.ts` · `AppCache.ts` · `AppConfig.ts`. No
`internal/` — there is no engine, only composition.

`App.ts` imports `AppStore.ts` and `AppCache.ts`. **`App.ts` does not import
`AppConfig.ts`**, and that is the point: `AppConfig` reaches `xdg` +
`config-file` only, while `App` / `AppStore` / `AppCache` reach `store` and
through it the SQLite driver. A consumer who wants XDG-placed config files and
no database must be able to import `AppConfig` without pulling a driver into
their graph.

**There is no namespace object here, and never will be** — this is
config-file's rule one level up (it measured 506 bytes versus 129.4 kB).
Collecting the four concepts into one `App = { … }` would destroy the split
silently.

## The ensure-before-open contract

**The entire reason this package exists.** `SqliteClient.layer` has **no error
channel** and **defects** on a missing parent directory; `AppDirs.ensure*` is a
`mkdir -p` on a **typed** `AppDirsError` channel. `AppStore.layer` and
`AppCache.layer` run the ensure inside `Layer.unwrap`, *before* the store layer
is built, which converts a defect surface into a typed one.

Nothing is `orDie`d — v3's `SqliteStateXdgLive` laundered the `AppDirsError`
away to advertise a `never` channel. "The state directory could not be created"
is an expected, recoverable boundary failure and it stays on `E`. The
integration suite watches a naive `Store.layerSqlite`-without-`ensureState`
composition defect; do not reorder the two.

## Invariants

- **The namespace is never an `AppConfig` parameter.** It is read from the
  ambient `AppDirs` service at layer build time, so it is typed **exactly once,
  in `App.layer`**. This kills the two-strings drift where an app passes
  `"myapp"` to `App.layer` and `"my-app"` to its config preset and then reads
  config from a directory nothing else ever writes to. If someone adds a
  `namespace` option "for flexibility", the namespace-once test should fail.
- **The codec stays required** on `AppConfigOptions` — never defaulted, never
  inferred from the filename's extension. Hard-coding a *format* choice into a
  composition layer is exactly what `XdgFullLive` was killed for, and the named
  import is what keeps the other three engines out of the consumer's bundle.
- **`App.layer` always provides both databases.** Passing no `cache` options
  **still opens `cache.db`** — `CacheOptions` are all-optional, so absence means
  defaults, not absence. An app that wants only one composes `AppStore.layer` or
  `AppCache.layer` directly.
- **`AppOptions` is `AppDirsOptions` pass-through.** `namespace`, `native`,
  `fallbackDir`, `dirs` mean what xdg says they mean, five-level precedence
  ladder included. This package re-documents none of it.
- **A `filename` must be a single path component**, or it dies at construction —
  for all three filename options. The guard rejects the empty string, anything
  containing `/` or `\`, and the traversal names `.` and `..`. Do not weaken it
  to "empty or contains a separator": `filename: ".."` contains no separator and
  still escapes the namespace directory. It can only come from code — the same
  wiring-defect rule xdg applies to `namespace`.
- **`AppError` is a type-only alias** (`XdgEnvError | AppDirsError | StoreError
  | StoreMigrationError | CacheError`). It erases, so it costs nothing in the
  module graph. It is the copy-pasteable `catchTags` list for the app edge, **not
  a new error model** — every constituent error flows through unwrapped with its
  structure intact. Do not turn it into a wrapper class.
- **No new spans, deliberately.** Every fallible operation inside the glue is
  already spanned by the package that owns it; the glue joins paths and composes
  layers. A span here would wrap another package's span.

## The memoization trap, at maximum cost

Every export is a **parameterized layer factory**, and Effect memoizes layers
**by reference**. Calling `App.layer(…)` inline at two provide sites opens **two
databases**: two connections onto one file, two migration ledgers, and two
independent `CacheEvent` PubSubs whose subscribers each see half the events.

**Bind the result to a `const` once and reuse that binding.** Say so at the top
of any example — this is the package where an application is most likely to
compose the same layer twice.

## App.layerTest and its documented limit

`layerTest` provides `Path.layer` and `FileSystem.layerNoop` **internally** via
`Layer.provide` — not merged into the output, not exposed — over
`Xdg.layerFrom` on synthetic paths and `:memory:` databases. A consumer's first
test is one line and needs **no platform package**. This is sound because the
layer *satisfies* those requirements rather than imposing them; `R` is `never`
by construction, not by a cast.

**The limit:** code paths that actually exercise `ensure*` **die** against
`FileSystem.layerNoop` — it is a stub, not a working filesystem. `layerTest` is
for testing logic that *uses* the control plane. Real directory behaviour is
tested through `App.layer` with a temp-directory `HOME`, which is what the
integration suite does.

## Testing and building

28 tests in `__test__/`, integration under `__test__/integration/*.int.test.ts`;
`@effect/vitest`, `assert.*` — never `expect`. `@effect/platform-node` is a
devDependency for the real-filesystem integration tests only.

```bash
pnpm vitest run packages/app       # from the repo root
pnpm build --filter @effected/app  # from the repo root
```

- `savvy.build.ts` carries **no `_base` suppression** — this package defines no
  class factories of its own, so there is nothing to suppress. Do not add one
  speculatively.
- Three workspace peers mean the **`prepare` script is load-bearing**: `xdg`,
  `store` and `config-file` link at their `dist/dev/pkg` and must be built before
  this package's tests resolve them in a fresh checkout.
- Never run `node savvy.build.ts --target prod` directly.
