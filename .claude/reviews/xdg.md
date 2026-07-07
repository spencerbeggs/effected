# Review: xdg-effect → @effected/xdg

Source: `/Users/spencer/workspaces/spencerbeggs/xdg-effect` (v2.1.0, Effect 3.21, ~2,100 LOC in `src/`)
Target: `@effected/xdg`, Effect v4-first redesign, **boundary tier** (filesystem + env IO; optional SQLite via `@effect/sql-sqlite-node`).

The library is the composition layer of a three-package family (xdg-effect, config-file-effect, json-schema-effect). It provides five concepts: XDG env-var resolution (`XdgResolver`), app-namespaced directory resolution with on-demand creation (`AppDirs`), platform-native directory mapping (`nativeDirs`), a SQLite key/value cache (`SqliteCache`), and a SQLite migration-ledger connection (`SqliteState`), plus resolver bridges and preset layers that wire everything into config-file-effect.

---

## 1. What is done well

**Progressive-adoption layer ladder.** The README's table (`XdgResolver.Live` → `XdgLive` → `XdgConfigLive` → `XdgFullLive`) is genuinely good DX: each rung adds exactly one capability and one requirement. Whatever the v4 shape becomes, preserve the *concept* — a consumer can adopt only env resolution without ever touching SQLite peers.

**Clean separation of resolution concerns.** `XdgResolver` (raw env vars, no namespace, no FS), `nativeDirs` (pure platform → path mapping, no IO, explicitly documented as taking `platform`/`home`/`appData` as inputs), and `AppDirs` (namespace + 5-level precedence + `ensure*` FS side effects) are three distinct responsibilities and the code keeps them distinct. The documented 5-level precedence in `resolveDir` (override → XDG env → native → fallbackDir → `~/.namespace`) with an honest note about where it deviates from the XDG spec is exemplary.

**IO isolation is already good for a boundary library.** All filesystem access goes through `@effect/platform` `FileSystem` (never `node:fs` in production code paths — the only raw `node:fs` is the scoped temp dir in `XdgResolverTest`, a defensible test-infrastructure choice). Env access goes through Effect `Config`. SQL goes through `SqlClient` from `@effect/sql`, with the concrete `SqliteClient` appearing only in the convenience layers (`*Test`, `*XdgLive`) that intentionally pick a driver. The core `SqliteCache.Live`/`SqliteState.Live` layers require an abstract `SqlClient` — the consumer chooses the driver. This is exactly the boundary-tier posture the standards want; port it as-is.

**Statics on the Tag (`AppDirs.Live`, `SqliteCache.Test`, `SqliteState.XdgLive`).** This is a proto-v4 pattern: the service identifier is the discoverable namespace for its layers. `yield* AppDirs` and `AppDirs.Live(config)` from one import. In v4 `Context.Service` this becomes the natural co-located form — the migration validates the instinct.

**Transactional `onRemoved` callbacks with error-channel preservation.** `invalidate`/`invalidateByTag`/`invalidateAll`/`prune` accept an effectful callback that runs *inside* the delete transaction, rolls back the delete on failure, and suppresses the PubSub event. Crucially, `mapSqlError` narrows only `SqlError` to `CacheError` and lets the caller's `E` survive in the signature (`CacheError | E`). This is sophisticated, correct API design — keep the semantics verbatim.

**PubSub event observability on the cache.** `CacheEvent` (timestamped, discriminated `Hit`/`Miss`/`Set`/`Invalidated`/`Pruned`/`Expired` payloads as a schema union) is a well-modeled event stream, and `emit` swallowing its own failures so telemetry never breaks the operation is the right call.

**Test layers with scoped resources.** `XdgResolverTest` acquires a temp dir via `acquireRelease` and returns a `Layer.scoped` — tests get hermetic homes with guaranteed cleanup. `SqliteCacheTest`/`SqliteStateTest` use `:memory:`. The pattern of every service shipping a `Test` layer is worth preserving as a house rule.

**Documentation discipline.** Every public symbol has TSDoc with `@remarks` explaining *behavior* (e.g., the `invalidate` transaction semantics, `nativeDirs` per-platform rules, why Linux returns `Option.none()`). The `docs/` walkthroughs and per-error catch guidance are unusually complete.

**Preset factories reduce real boilerplate.** `XdgConfigLive.toml({ namespace, filename, tag, schema })` collapsing codec/strategy/resolvers/savePath into 4 required options, and `.layered` wiring the full project→user→system chain, is the right "opinionated" move for this library's audience (CLI authors).

---

## 2. What is confusing or awkward

**Kind-based folder sprawl with forced import cycles.** `errors/`, `layers/`, `schemas/`, `services/`, `resolvers/` — exactly the layout the standards supersede. The tell is the **eleven** `biome-ignore lint/suspicious/noImportCycles` comments: every service file imports its layer file and vice versa, because the Tag lives in `services/` while the implementation lives in `layers/`. The design *wants* co-location; the folder scheme forbids it. Module-per-concept dissolves all eleven cycles for free.

**`*ErrorBase` export ceremony.** Each error ships as a pair (`AppDirsErrorBase` + `AppDirsError`) purely to appease declaration bundling of the `Data.TaggedError(tag)<Props>` intermediate class. Four extra public symbols, four identical `@remarks` apologies. `Schema.TaggedErrorClass` in v4 eliminates the intermediate entirely.

**Stringly-typed error payloads that destroy cause structure.** All four errors carry `reason: string` populated via `String(e)`. `wrapCacheError` even initializes `reason: ""` and spreads over it. A `SqlError` with a stack becomes an opaque string; a defect and a failure become indistinguishable text. The standards' `cause: Schema.Defect` field is the fix. Similarly, `errors/types.ts` existing solely to export the union `XdgEffectError` is a central-error-registry smell — the union belongs where it is consumed, or nowhere.

**Layer factories everywhere; memoization broken by design.** `SqliteCache.Live()` and `XdgResolver.Live` take *no parameters* yet produce a fresh layer per access — `XdgResolver.Live` is a `static get` that calls `XdgResolverLiveImpl()` each time, so two independent `XdgLive(...)` composites in one app get two non-memoizable resolver layers. The standards are explicit: layers memoize by reference; bind unparameterized layers to constants. Only `AppDirs.Live(config)`, `SqliteState.Live({ migrations })`, and the `XdgLive`-family composites are genuinely parameterized.

**`Effect.orDie` laundering expected failures.** `SqliteCacheXdgLive`/`SqliteStateXdgLive` `orDie` the `AppDirsError` from `ensureCache`/`ensureData` and the `SqliteClient.layer` construction error, advertising `Layer<SqliteCache, never, AppDirs>`. "The cache directory could not be created" is an expected, recoverable boundary failure, not an invariant violation. Worse, `SqliteStateLive` runs user migrations with `migration.up(sql).pipe(Effect.orDie)` and then `catchAllDefect`s the defect back into a `StateError` — a failure→defect→failure round-trip that exists only to dodge the `unknown` error type on `StateMigration.up`.

**`Option` leaking into the construction API.** `AppDirsConfig` uses `Schema.optionalWith(Schema.OptionFromUndefinedOr(...))`, so callers write `fallbackDir: Option.some(".test-app"), dirs: Option.none()` (see `__test__/app-dirs.test.ts`). Consumers configuring a namespace should write plain optional fields; `Option` is an internal representation, not an ergonomic input format. Same for the nested `dirs` struct requiring `Option` per field.

**Naming fog around "Xdg\*Live".** `XdgLive`, `XdgConfigLive`, `XdgFullLive`, `XdgResolverLive`, `SqliteCacheXdgLive`, plus `XdgConfigResolver` (a resolver, not a layer) and the deprecated alias `XdgConfig` for it. The `Live` suffix does triple duty (implementation layer, composite layer, preset factory), and `Object.assign(_xdgConfigLive, { toml, json, multi, layered })` callable-with-methods hybrids are clever but hostile to docs generation, tree-shaking, and discoverability. `XdgFullLive` in particular is a grab-bag whose name says nothing about what "full" includes.

**`NativeDirs.ts` lives in `services/` but is not a service.** It exports an interface and a pure function `nativeDirs(input)`. It is a floating function per the standards — and its lowercase name colliding with the PascalCase interface (`NativeDirs` type vs `nativeDirs` fn) is a small persistent paper cut. Also both `NativeConfigResolver` and `AppDirsLive` reach for `globalThis.process?.platform ?? "linux"` — a hidden global read inside otherwise dependency-injected code; platform identity should come from the environment/service the same way `HOME` does.

**Per-access recomputation.** `AppDirs.config` recomputes `resolveAllDirs` (8 env reads + native mapping) on every access, and `resolveSingleDir` resolves *all* directories to return one. Harmless for a CLI, but the layer already has an `Effect.gen` construction phase where resolution could be computed once — the config is fixed at layer build time.

**Re-export facade blurs package boundaries.** `index.ts` re-exports ~50 symbols from config-file-effect and **the entirety of json-schema-effect's surface, which nothing in `src/` uses** (only `index.ts` mentions it). That makes xdg-effect's version a hostage of two other packages' surfaces and makes `npm install xdg-effect` misleadingly load-bearing. In the monorepo, `workspace:*` deps make the facade pointless.

**Tests predate the testing standard.** All 14 files use plain `it()` + `Effect.runPromise` + `expect`, with `beforeEach`/`mkdirSync` and `Date.now()`-suffixed `/tmp` dirs. No `@effect/vitest`, no `layer()` group provisioning, no `TestClock` (TTL expiry tests presumably sleep or write past timestamps). Complete rewrite to `it.effect` + shared `layer(...)` is expected as part of the port, not a criticism of the v3 code per se.

**Zero observability.** No `Effect.fn`, no spans, no logging anywhere in `src/`. Every service method is an anonymous effect. The v4 port should define each operation with `Effect.fn("AppDirs.ensure")` etc.

---

## 3. v4 migration implications (this codebase specifically)

| v3 construct (here) | v4 target | Notes |
| --- | --- | --- |
| `class AppDirs extends Context.Tag("xdg-effect/AppDirs")<AppDirs, AppDirsService>()` + separate `AppDirsService` interface | `class AppDirs extends Context.Service` — identifier and shape in one declaration | Kills the interface/tag/impl three-file split and all `noImportCycles` ignores. Retag as `@effected/xdg/AppDirs`. |
| `Data.TaggedError("X")` base + subclass + exported `*ErrorBase` | `Schema.TaggedErrorClass` | Payloads are all serializable (strings/numbers) — no reason to fall back to `Data.TaggedError`. Add `cause: Schema.Defect` where an underlying error exists (FS failures, SQL failures, migration failures). Drop the four `*ErrorBase` exports and `errors/types.ts`. |
| `Schema.Class<X>("X")({...})` models (`XdgPaths`, `ResolvedAppDirs`, `CacheEntry`, `CacheEvent`, `MigrationStatus`, `AppDirsConfig`) | `Schema.Class` (v4) with static/instance methods | `Schema.optionalWith(Schema.OptionFromUndefinedOr(...), { default })` → `Schema.optionalKey` + plain optional inputs; construct via `X.make(...)`, never `new X(...)` (current code and tests use `new`). `CacheEventPayload` `Schema.Union` of `TaggedStruct`s carries over directly. |
| `import { FileSystem } from "@effect/platform"` | Platform abstractions from `effect` core | The `@effect/platform` peer disappears entirely; `NodeFileSystem` etc. come from `@effect/platform-node` (which the consumer provides at the edge, per boundary-tier rules). `XdgResolverTest`'s raw `node:fs` temp dir should become the platform `FileSystem` temp-dir helpers so even test layers stay abstract. |
| `Config.string(name).pipe(catchAll → Option.none)` (`optionalEnv`) | v4 `Config` API | The catch-and-swallow pattern also masks *invalid* vs *missing*; v4's option-aware config combinators express "optional env var" directly. Env access stays behind `Config` — good v4 story. |
| `Layer.succeed`/`Layer.effect`/`Layer.scoped`/`Layer.unwrapEffect` composites | Same concepts in v4 | Bind unparameterized layers to constants (`XdgResolver.Live` becomes a `static readonly` layer, not a getter). `SqliteCacheXdgLive`'s `Layer.unwrapEffect(...orDie)` should become an effectful layer whose error channel carries `AppDirsError`/`SqlError`-wrapped errors instead of dying. |
| `@effect/sql` / `@effect/sql-sqlite-node` | **Risk item** | These are separate v3-line packages; confirm v4-compatible releases exist in the v4 catalog before committing `SqliteCache`/`SqliteState` to the first cut. If they lag, ship the XDG/AppDirs/config concepts first and land the SQLite concepts in a follow-up (or a separate package — see §5). |
| Anonymous `Effect.gen` service methods | `Effect.fn("AppDirs.resolveAll")(function* () {...})` | Wholesale: every public operation gets a named span. `emit` and row-mapping helpers go to `src/internal/`. |
| Plain vitest + `Effect.runPromise` | `@effect/vitest` `it.effect`, group-level `layer(...)`, `TestClock.adjust` for TTL expiry | The cache TTL and prune tests are the big winners — deterministic clock instead of real timestamps. |
| Re-export facade of config-file-effect / json-schema-effect | Delete | `workspace:*` monorepo siblings; consumers import `@effected/config-file` directly. |

---

## 4. Candidate module-per-concept layout

~~~text
src/
  index.ts          # re-exports only
  Xdg.ts            # XdgPaths (Schema.Class) + XdgError + Xdg service (env-var
                    # resolution; v3 "XdgResolver") + Xdg.layer / Xdg.layerTest
  AppDirs.ts        # AppDirsConfig + ResolvedAppDirs + AppDirsError +
                    # AppDirs service (5-level precedence, ensure*) +
                    # AppDirs.layer(config) / AppDirs.layerTest(config)
  NativeDirs.ts     # NativeDirs Schema.Class with static resolve(...) — the
                    # pure platform mapping as a static method, not a floating fn
                    # (alternatively fold into AppDirs.ts as internal; keep public
                    # only if consumers genuinely use it standalone — README says they do)
  XdgConfig.ts      # config-file-effect bridge: XdgConfigResolver,
                    # NativeConfigResolver, XdgSavePath, and the toml/json/
                    # layered/multi presets as statics (XdgConfig.toml(...), ...)
  SqliteCache.ts    # CacheEntry + CacheEvent(+Payload) + CacheError +
                    # SqliteCache service + layer (needs SqlClient) +
                    # layerXdg (needs AppDirs) + layerTest (:memory:)
  SqliteState.ts    # StateMigration + MigrationStatus + MigrationResult +
                    # StateError + SqliteState service + layer / layerXdg / layerTest
  internal/
    sqliteRows.ts   # row-shape casts, JSON tag encode/decode, ISO date mapping
    errors.ts       # wrap-foreign-error helpers (mapSqlError successor)
~~~

Notes:

- `XdgLive`/`XdgConfigLive`/`XdgFullLive` composites shrink to statics on their owning concepts (`AppDirs.layerWithXdg`, `XdgConfig.layer(...)`) or disappear — with layers co-located and memoized by reference, `Layer.mergeAll(Xdg.layer, AppDirs.layer(cfg))` at the consumer's edge is two lines and clearer than a named grab-bag. Recommend dropping `XdgFullLive` entirely; document the composition instead.
- The `Object.assign` callable hybrids become plain named statics: `XdgConfig.toml(...)`, `XdgConfig.json(...)`, `XdgConfig.layered(...)`, `XdgConfig.multi(...)`.
- Error count stays at four, one per concept file — this codebase does *not* have error proliferation; it has error *under*-structuring (see §2), fixed by `cause` fields rather than more classes.

---

## 5. Extraction / split / seam candidates

**Seam 1 — SQLite concepts are not XDG concepts.** `SqliteCache` and `SqliteState` are generic `@effect/sql` services; their only XDG content is the two ~20-line `*XdgLive` layers that ask `AppDirs` for a directory and pick a db filename. Options:

- **(a) Split out** `@effected/sqlite-cache` / `@effected/sqlite-state` (or one `@effected/sqlite-kit`), leaving `@effected/xdg` with only `Xdg`, `AppDirs`, `NativeDirs`, `XdgConfig`. `@effected/xdg` then loses all `@effect/sql*` peers, and the `layerXdg` convenience layers move to the sqlite package (peering on `@effected/xdg`) or into an example. This is the cleanest tiering: xdg becomes a small fs+env boundary library.
- **(b) Keep in-package** with `@effect/sql`/`@effect/sql-sqlite-node` as optional peers (status quo). Acceptable, but the v4 readiness of the sql packages then gates the whole port (§3 risk).

Recommendation: (a). The `Duration`-TTL/tags/PubSub cache and the migration ledger are independently reusable and independently versionable, and the sql-v4 timing risk stops being a blocker for the xdg core.

**Seam 2 — the config-file-effect bridge.** `XdgConfig.ts` (resolvers + presets) is the only part of the package that depends on config-file-effect. If `@effected/config-file` migrates on a different schedule, the bridge could ship as a subpath export (`@effected/xdg/config`) or live in `@effected/config-file` as an xdg resolver module instead. Keeping it in xdg behind a subpath export is the least churn; decide per the config-file-effect review. Either way the dependency edge should become explicit (`workspace:*`) rather than facade re-export.

**Seam 3 — drop the json-schema-effect edge entirely.** Nothing in `src/` uses it; it exists only to power the `index.ts` facade. In the monorepo, cut the dependency.

**Seam 4 — `nativeDirs` as shared pure logic.** The platform→directory mapping is pure and could serve other tools (e.g. anything needing macOS/Windows app-dir conventions). Not worth its own package yet; keep as a public class in `@effected/xdg` and revisit if a second consumer appears.

---

## 6. Peer / dependency hygiene

Current state:

- **peers:** `effect`, `@effect/platform`, `@effect/platform-node` (optional), `@effect/sql` (optional), `@effect/sql-sqlite-node` (optional)
- **deps:** `config-file-effect ^0.3.0`, `json-schema-effect ^0.3.0`

Problems against the peer-closure rule (systems#228 / vitest-agent#127 class of defect):

1. **`@effect/experimental` is missing.** `@effect/sql@0.51` and `@effect/sql-sqlite-node@0.52` both declare a **non-optional** peer on `@effect/experimental ^0.60.0`. xdg-effect declares neither, so the transitive peer escapes to the consumer's importer — exactly the failure mode the standards call a defect. Must be declared (optional, gated with the sql peers).
2. **`@effect/platform-node`'s peers are unclosed.** `@effect/platform-node@0.107` non-optionally peers on `@effect/cluster` and `@effect/rpc` (this is *why* those two sit oddly in xdg-effect's devDependencies — the local install needed them, which is the smoking gun that consumers will too). If `@effect/platform-node` stays a peer, `@effect/cluster` and `@effect/rpc` must be declared optional peers as well. (In v4 this whole cluster/rpc coupling reportedly changes; re-derive the closure from the actual v4 catalog rather than porting this list.)
3. **`@effect/sql-sqlite-node` is imported but absent from devDependencies.** `SqliteCacheTest`/`SqliteStateTest`/`*XdgLive` import it directly at runtime, yet only `@effect/sql` is in devDeps — the build works via lockfile/transitive resolution, which is fragile. Dev-time self-fulfillment of every declared peer should be explicit.
4. **Regular deps on config-file-effect / json-schema-effect** are semver-range npm deps today; in the monorepo they become `workspace:*` (config-file) and *deleted* (json-schema, per §5). Whether the config-file edge is peer or regular is a per-edge design-time call — given the bridge exposes config-file-effect types (`ConfigResolver`, `ConfigFileOptions`) in its public signatures, **peer** is the safer choice to guarantee a single copy in the consumer's graph.

Target closure for `@effected/xdg` after the §5(a) split, in v4 terms: peer on `effect` (required) + `@effected/config-file` (required or subpath-gated) — and nothing else, since `FileSystem` lives in effect core and the consumer provides `@effect/platform-node`/bun at the edge. The sqlite package carries the `@effect/sql*` closure (including `@effect/experimental` or its v4 equivalent) instead.
