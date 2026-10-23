---
type: Module
title: xdg
description: XDG Base Directory resolution -- turning the environment into namespaced, precedence-ordered application directories and a config-file resolver chain, with no database and no runtime dependencies.
status: stable
kind: package
resource: ../../packages/xdg
layer: L1
tags:
  - architecture
sources:
  - id: xdg-package-json
    resource: ../../packages/xdg/package.json
  - id: xdg-claude-md
    resource: ../../packages/xdg/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T20:38:57Z
integrity:
  generated:
    body: 9f246f99ca18b5ab
---

# xdg

## Purpose and tier

`@effected/xdg` is XDG Base Directory resolution. Its one job is to turn
the environment into paths: read the XDG Base Directory environment, map
it onto a platform, namespace it for an application, create the
directories on demand, and expose that as a config-file resolver chain.
No database, no cache, no format parsing.

**Boundary tier** — see [the library-tier glossary
entry](../glossary/library-tier.md). IO happens exclusively through
`effect` core's `FileSystem` and `Path`, arriving via the `R` channel
from the consumer's platform layer, so there is no `@effect/platform`
peer and no platform-node devDependency even in
tests.[^xdg-package-json] `peerDependencies` is `effect`,
`@effected/walker` and `@effected/config-file`, plus `@effected/glob`,
`@effected/jsonc`, `@effected/toml` and `@effected/yaml`, which those two
bring into the closure; there are **no runtime dependencies**. The two
direct workspace edges, `walker` and `config-file`, are boundary→boundary
and therefore non-propagating; the other four are pure-tier peers that
complete the closure. `walker` depends on nothing, keeping the graph acyclic,
and `config-file` is a peer rather than a regular dependency because the
bridge exposes config-file's types in xdg's own public signatures, so a
single copy in a consumer's graph is load-bearing.

xdg **does not depend on** [store](store.md), and must not — see
[xdg does not depend on store](../decisions/xdg-does-not-depend-on-store.md).

xdg also **does not build on** core's `UserDirectories`
(`effect/persistence`, unstable): core folds the XDG variable and the native
directory into one answer per kind, so xdg's precedence ladder cannot sit on
it — see [xdg stays independent of core
UserDirectories](../decisions/xdg-stays-independent-of-core-userdirectories.md).
The two agree on absolute `XDG_*_HOME` values and on the macOS and Windows
native directories, a subset a parity test pins.

## Module layout

Module-per-concept, four files under `src/`: `Xdg.ts` (the environment),
`NativeDirs.ts` (the pure platform map), `AppDirs.ts` (namespace,
precedence, creation) and `XdgConfig.ts` (the config-file bridge). Import
direction is a DAG: `Xdg.ts` depends on nothing, `NativeDirs.ts` and
`AppDirs.ts` build on it, `XdgConfig.ts` builds on `AppDirs.ts`. There is
no `internal/` directory — there is no engine here, only
resolution.[^xdg-claude-md]

## Public surface

### Xdg — the environment

- **The service's shape IS the resolved paths.** The environment does
  not change during a process, so resolution happens once, at layer
  construction, and the service is the resolved value rather than an
  effect that computes one — the whole downstream chain is infallible as
  a result.
- `Schema.optionalKey` models an absent XDG variable as an absent key,
  read with a `??` fallback — no `Option` in the model.
- The **system search paths** are modeled too, not just the per-user home
  variables: the colon-separated `XDG_CONFIG_DIRS` and `XDG_DATA_DIRS`
  with their spec defaults. Modeling the search-path half of the spec is
  what makes [the walker edge](#where-walker-fits) load-bearing rather
  than decorative.
- **The platform is injected, never read from a global.**
  `CurrentPlatform` is a `Context.Reference` whose default reads
  `process.platform` once, so production is unchanged while a test pins
  macOS or Windows with a one-line `Layer.succeed`. Three sites read it
  — the `Xdg` layer, the `AppDirs` layer and the native config resolver —
  so an override is provided once, at the edge, beneath all three.
- **A relative value is ignored**, as the XDG Base Directory specification
  requires: a relative `XDG_*_HOME`, `XDG_RUNTIME_DIR` or search-path entry
  reads as unset, and a search path left empty takes the spec default.
  `XDG_*` values are judged by the platform's absolute rule; the Windows
  `APPDATA`/`LOCALAPPDATA` always by the Windows rule, so the answer never
  depends on the host. On win32 the search paths split on `;`.

A missing home directory is the only environment failure; everything else
is optional by construction. Home is `HOME`, or on win32 `USERPROFILE` then
`HOME` (the error then names `USERPROFILE`, meaning neither was set). Home is
deliberately not validated as absolute, and its absence fails the layer
eagerly even when every `XDG_*_HOME` is set. `layerFrom` supplies explicit
paths, trusted as given, and is the test layer.

### NativeDirs — the pure platform map

- **darwin** — config, data and state under
  `~/Library/Application Support/<ns>`; cache under `~/Library/Caches/<ns>`.
- **win32** — config and data under `%APPDATA%/<ns>`; cache and state
  under `%LOCALAPPDATA%`, falling back to the standard
  `AppData/Roaming`/`AppData/Local` locations under home when those
  variables are absent.
- **everything else** — `Option.none()`. On Linux, XDG is the native
  convention, so returning `none` lets the precedence ladder skip the
  rung cleanly rather than duplicating the XDG answer.

`NativeDirs.resolve` is pure — no IO, no env, no clock — joined through
`Path.Path` so a win32 `Path` layer produces win32 separators.

### AppDirs — namespace, precedence, creation

Resolution happens once, at layer construction, so reading a path cannot
fail — it is a `string`. The layer's error channel is `never`; the one
failure that could hide behind it, a missing home directory, surfaces on the
`Xdg` layer instead, before an `AppDirs` exists. That infallible channel
is also the only way the config-file save path fits config-file's
`defaultPath` slot without an `orDie`.

The **five-level precedence** per directory kind:

1. an explicit per-kind override;
2. the XDG environment variable, namespaced;
3. the native directory, when native mode is on and the platform has one;
4. a single dot-directory under the home directory that all four kinds
   collapse to;
5. `<home>/.<namespace>`.

Rungs 4 and 5 are **not** the XDG spec's per-kind defaults — a caller
wanting spec defaults passes them as per-kind overrides. Native mode
defaults **off**, because creating a native directory commits an
application to a location; the `ensure*` operations `mkdir -p` and
return the path, with the runtime one `Option`-returning since a runtime
directory exists only when the environment says so.

### XdgConfig — the config-file bridge

Statics on a concept class: a config-search-path resolver, a
native-directory resolver and a save path. The primary resolver searches
the whole XDG config search path — the app's own config directory, then
each system config directory, namespaced, in that order — placed ahead
of the native resolver so an existing `~/.config/<app>` still beats the
native directory. Both resolvers get a `never` error channel from walker
rather than a hand-rolled `catchAll`.

Deliberately not present: preset ladders and format-coupled factories
(that composition belongs in [app](app.md)), and a central error union
(each error lives with the concept that raises it).

## Where walker fits

Walker earns its edge in the one place xdg does a search: the config
resolver builds the ordered candidate list from the app's config search
path and hands it to `Walker.firstMatch`. That single call buys
per-candidate absorption (a permission failure on a system config
directory must not hide a readable `~/.config`), short-circuiting (the
first hit wins), and defect propagation (`firstMatch` uses `Effect.catch`,
not `catchCause`). The native resolver has exactly one candidate but goes
through `firstMatch` too, for the absorption contract. Nothing in xdg
ascends a directory chain — its candidates come from the environment, not
the tree — so [walker](walker.md)'s `ascend` and `findRoot` go unused
here.

## Errors

Two `Schema.TaggedError` types, one per fallible concept, each carrying
its underlying failure structurally in a `cause: Schema.Defect()` field:
an environment error naming the missing variable, and a
directory-creation error carrying the failing kind as a literal union
plus the path. `PlatformError` is wrapped, never leaked. Nothing is
`orDie`d — "the cache directory could not be created" is an expected,
recoverable boundary failure. Wiring errors are construction defects: an
empty namespace, or one containing a path separator, dies at layer
construction, because a namespace with a separator could silently escape
the app's directory.

## Observability

Named spans on every public fallible boundary, uniformly — the `ensure*`
set. Path reads are property accesses on a value and are unspanned; the
two resolvers have a `never` channel by contract and carry no spans; the
platform map is pure. No metrics, no logging, no
`@effect/opentelemetry` — telemetry-agnostic.

## Testing

Suites in `__test__/`, one per concept module, with suite-boundary
`layer(...)` blocks. The platform matrix is tested with **no platform IO
at all**: because the platform is a `Context.Reference` and the native
map is pure, a suite pins darwin/win32/linux behaviour by providing the
reference at the group boundary and asserting on strings. `AppDirs`'
filesystem behaviour runs on a real in-memory volume
([`@effected/memfs`](memfs.md), a devDependency) with `makeDirectory`
intercepted by a delegate-by-default spy: the handler records the path
and returns `undefined`, so the directory is genuinely created rather
than merely observed. **Never record eagerly** — `AppDirs` builds its
`ensure*` effects once, at layer construction, so a stub that records in
its body counts directories that were never created; a fault handler
consulted when the method is called gets the property for free.
`XdgConfig`'s suites run on memfs too, with an `exists` fault handler
that records each probe and denies seeded paths. The environment rules
run through the real `Xdg` layer under a pinned platform and a
`ConfigProvider` built from a record, and a differential suite compares
the agreed subset with core's `UserDirectories`.

## Hardening

Not a parser — no recursion, no untrusted text, no nesting cap, no
numeric option. The namespace is a path component, validated as one: an
empty namespace or one containing a separator is rejected at layer
construction as a defect. Every join goes through `Path.Path`, never
string interpolation. Absorption is per candidate, not per resolver.
Defects propagate — xdg adds no `catchCause` anywhere.

## Build

`savvy.build.ts` carries the standard narrow `{ messageId:
"ae-forgotten-export", pattern: "_base" }` suppression. The workspace
peers mean xdg needs the `prepare` script — see
[the package manifest and scaffold convention](../conventions/package-manifest-and-scaffold.md#cross-package-build-dependencies)
— since the peers link at their built output and must be built before
xdg's own tests can resolve them in a fresh checkout. Gate on a
zero-warning `dist/prod/issues.json` via `pnpm build --filter
@effected/xdg`.

[^xdg-package-json]: `packages/xdg/package.json` — `peerDependencies`
    lists `effect`, `@effected/walker`, `@effected/config-file`,
    `@effected/glob`, `@effected/jsonc`, `@effected/toml` and
    `@effected/yaml`; no `dependencies` block.
[^xdg-claude-md]: `packages/xdg/CLAUDE.md` — module layout and the
    resolve-once-at-construction design.
