# @effected/xdg

XDG Base Directory resolution. Eleventh migration, and the XDG half of the
`xdg-effect` split — the SQLite half is `@effected/store`.

**Design doc:** `@../../.claude/design/effected/packages/xdg.md`

## Tier: boundary

`effect`, `@effected/walker` and `@effected/config-file` are the peers; there are
**no runtime dependencies**. IO goes through `effect`-core `FileSystem` and
`Path`, arriving via the `R` channel. Both workspace edges are boundary→boundary,
and tier 2 does not propagate (R3), so xdg's consumers pay nothing for them.

**xdg does NOT depend on `@effected/store`, and must not.** Store is integrated
tier; depending on it would propagate (R2) and drag `@effect/sql-sqlite-node`
into every consumer. That split is the whole reason this package is small. The
glue that wires an `AppDirs` path into a `Store` belongs in `@effected/app`.

Needs **no platform package, even in tests** — `Path.layer` and
`FileSystem.layerNoop` come from core.

## Resolve once, at layer construction

The load-bearing shape decision. `Xdg`'s service shape **is** `XdgPaths`, and
`AppDirs.dirs` is a plain `ResolvedAppDirs` **value**, not an `Effect`. The
environment is fixed when the layer is built, so that is where it is read.

Three consequences, and they are why the design holds together:

- Reading a path cannot fail. The only fallible members are the `ensure*` ones,
  which touch the filesystem.
- `AppDirs.layer`'s error channel is `never`. The one resolution failure — `HOME`
  unset — surfaces on `Xdg.layer` as `XdgEnvError`, before an `AppDirs` exists.
- `XdgConfig.savePath` gets a `never` channel, which is the **only** way it fits
  config-file's `defaultPath?: Effect<string, never, RR>` slot without an
  `orDie`. v3 recomputed all eight env reads on every property access, so this
  did not typecheck without laundering.

## Invariants

- **The five-level precedence** per directory kind: explicit override → XDG env
  var namespaced → native dir (`native: true` only) → `$HOME/<fallbackDir>` →
  `$HOME/.<namespace>`. Rungs 4 and 5 are deliberately **not** the XDG spec's
  per-kind defaults (`~/.config`, `~/.local/share`); that is inherited v3
  behaviour, and a caller wanting spec defaults passes them as `dirs` overrides.
- **The runtime directory has no fallback ladder.** An override, or
  `$XDG_RUNTIME_DIR` namespaced, or nothing. It must be user-owned and mode 0700,
  so inventing a fallback would be a lie — the key is simply absent.
- **`NativeDirs.resolve` returns `Option.none()` on Linux.** XDG *is* the native
  convention there, so the rung is skipped rather than filled with a duplicate of
  the XDG answer. Filling it would shadow the rung below.
- **The platform is a `Context.Reference`, never a global read.** `CurrentPlatform`
  defaults to `process.platform`. This is what makes the darwin/win32 matrix
  testable with no platform IO — do not reintroduce `globalThis.process.platform`
  inside the resolution code, which is what v3 did in two places.
- **A namespace is one path component.** Empty, or containing `/` or `\`, or
  `..` — all are **defects** at layer construction, not typed errors. It can only
  come from code, and `namespace: "../.."` would resolve the app's directories
  outside `$HOME`.
- **Every join goes through `Path.Path`**, never string interpolation. v3 built
  every path with `${home}/Library/...`, which emits forward slashes on Windows.

## Absorption is per candidate — the one real bug fixed

`XdgConfig.resolver` searches the whole config search path (`~/.config/<ns>`,
then each `$XDG_CONFIG_DIRS` entry) through **`Walker.firstMatch`**. v3 wrapped
its whole resolver in one `Effect.catchAll(() => Option.none())`, which absorbs
at the wrong granularity: an `EACCES` on the first candidate aborted the probe
and hid a perfectly readable config behind it.

Both the absorption and the ordering are pinned by tests that have been **watched
failing** against the v3 shape. Do not replace `Walker.firstMatch` with a local
loop plus a trailing `catch`.

`$XDG_CONFIG_DIRS` / `$XDG_DATA_DIRS` are modeled here for the first time — v3
ignored the search-path half of the spec entirely. Without them `firstMatch`
would be a one-element loop and the walker edge would be ceremony.

## Testing and building

51 tests in `__test__/`, `@effect/vitest`, `assert.*` — never `expect`.

```bash
pnpm vitest run packages/xdg
pnpm build --filter @effected/xdg   # from the repo root
```

- The environment is driven with
  `ConfigProvider.layer(ConfigProvider.fromUnknown({...}))`. Never mutate
  `process.env`.
- The platform is pinned with `Layer.succeed(CurrentPlatform, "win32")`.
- **A `FileSystem.layerNoop` stub must record inside `Effect.suspend`.** The
  `AppDirs` shape builds its `ensure*` effects once, at layer construction, so a
  stub that pushes eagerly in its body records four directories that were never
  created — and every assertion measures construction instead of execution. This
  bit during the port.
- `savvy.build.ts` carries the **narrow** `_base` suppression. Never widen it.
- Never run `node savvy.build.ts --target prod` directly.
