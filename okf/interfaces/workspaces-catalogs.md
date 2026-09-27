---
type: Interface
title: "@effected/workspaces catalogs and the config-dependency seam"
description: WorkspaceCatalogs and CatalogSet assembly, the release-age gate, the ConfigDependencySpec value model, and the ConfigDependencyHooks opt-in replay seam over pnpm config dependencies.
status: stable
kind: api
resource: ../../packages/workspaces/src/WorkspaceCatalogs.ts
tags:
  - architecture
  - compat
sources:
  - id: workspace-catalogs-ts
    resource: ../../packages/workspaces/src/WorkspaceCatalogs.ts
  - id: config-dependency-hooks-ts
    resource: ../../packages/workspaces/src/ConfigDependencyHooks.ts
  - id: internal-catalogs-ts
    resource: ../../packages/workspaces/src/internal/catalogs.ts
  - id: config-dependency-resolution-ts
    resource: ../../packages/workspaces/src/internal/configDependencyResolution.ts
  - id: config-dependency-fetch-ts
    resource: ../../packages/workspaces/src/internal/configDependencyFetch.ts
  - id: config-dependency-spec-ts
    resource: ../../packages/workspaces/src/ConfigDependencySpec.ts
  - id: config-dependency-spec-grammar-ts
    resource: ../../packages/workspaces/src/internal/configDependencySpecGrammar.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-27T07:39:04Z
  body_sha256: 6448337dd46b05bfe8ef28a056528d838dca14189442241ff9c962a8ad0dac8a
---

# @effected/workspaces catalogs and the config-dependency seam

Catalog assembly is where [`@effected/workspaces`](../modules/workspaces.md)
turns a workspace's several declaration sources into one resolvable set, and
where pnpm's config-dependency hooks are replayed to get the parts no file
records. Three outputs come off one memoized pass: the catalogs themselves,
the release-age gate, and the peer-dependency rules
[`PeerCheck`](workspaces-peer-check.md) needs.

## WorkspaceCatalogs and CatalogSet

`CatalogSet` is the immutable, fully-normalized catalog collection with one
resolution semantic, carrying statics for its three sources.[^workspace-catalogs-ts]
`WorkspaceCatalogs` assembles it with pnpm's precedence and memoizes. The
reader is package-manager-aware: file presence picks the reader, with the
pnpm workspace file taking the pnpm path and its absence falling to the root
manifest's bun-style catalog fields; lockfile catalogs are
package-manager-aware too, since pnpm and bun both carry them.

The catalog readers hard-fail by design, because their output is
load-bearing for diffing — a silently-empty read is the "every dependency
looks added" bug. A present-but-malformed shape fails typed, while an
absent or explicitly-null field yields empty, and a default catalog
declared twice is rejected, checked structurally so an explicitly-declared
empty catalog still counts as a declaration. This is a deliberate contrast
with [package-manager detection](workspaces-discovery.md#package-manager-detection),
which degrades gracefully on malformed hints because it is a heuristic with
a fallback chain, while the catalog readers' output is load-bearing. The
two live inline readers share one validator, so they fail typed on exactly
the same conditions rather than one hard-failing and the other normalizing
to `{}`; the at-ref readers a snapshot uses are deliberately tolerant of
the same shapes. The presence probe that picks the reader also
distinguishes genuine absence from a probe failure: a non-`NotFound`
`PlatformError` from the existence check fails typed rather than collapsing
to "absent" and selecting the wrong reader.[^workspace-catalogs-ts]

The workspace's effective pnpm release-age gate folds the inline config
keys and the hook contributions strictest-wins through `@effected/npm`'s
combining vocabulary, reusing the single memoized assembly pass so config-dependency
code runs exactly once. Present-but-malformed inline values hard-fail, the
same posture as a malformed inline catalog block. There is deliberately no
top-level convenience wrapper for it — the service method is the surface.

`WorkspaceCatalogs.peerDependencyRules()` returns the merged
peer-suppression rule set — the `pnpm-workspace.yaml` block seeded through
the hook replay — which is the input
[`PeerCheck`](workspaces-peer-check.md) needs to reproduce pnpm's
suppression. It is a sibling method rather than a second assembly pass,
which is what keeps config-dependency code running exactly once; an absent
block yields `NoPeerDependencyRules`, an assertion rather than a gap. That
call-site read is pinned by an integration test rather than a seam unit
test, because computing the rules inside the replay and then dropping them
at the call site would compile, pass every seam test, and return an empty
set indistinguishable from "this workspace declares none" — the
discard-by-projection defect the seam itself once had. Every
`WorkspaceCatalogs.layer*` static delegates to one builder,
`layerWithHooks(hooks, options)`, which is also how a test reaches
`layerFrom` through the real graph.

`src/internal/catalogs.ts` is the only module in the package that imports
`@pnpm/catalogs.*`.[^internal-catalogs-ts]

## ConfigDependencySpec — one configDependencies value

`ConfigDependencySpec` models one `configDependencies` value from
`pnpm-workspace.yaml`: an exact `version` (`@effected/semver`'s `SemVer`,
prereleases allowed, build metadata refused) and an optional SRI
`integrity`.[^config-dependency-spec-ts] It reads the bare form pnpm 11 and
12 write (`0.11.1`, the integrity living in the lockfile) and the deprecated
inline form (`0.11.1+sha512-<base64>`) that workspaces in the wild still
carry. The integrity field's schema IS `@effected/npm`'s `SriIntegrityHash`,
asserted by object identity in the suite.

- `parseResult(spec)` is the sync primitive under `parse`, failing with
  `InvalidConfigDependencySpecError`. Its `reason` is `"version"` for a
  range, dist-tag, partial, `v`-prefixed or padded version, and
  `"integrity"` for a tail that is not an SRI hash, a corepack
  `sha512.<hex>` tail and an empty `0.11.1+` tail included.
- `bare` renders `<version>`, the form to write when normalizing the field.
- `toString()` renders the form that was parsed, so a spec a tool only
  reads round-trips byte for byte. `FromString` is the matching string
  codec, encoding through `toString()`.

Only the **first** `+` separates version from integrity, because an SRI's
base64 alphabet contains `+` itself. That split lives in one internal
module, and the strict model and hook replay both call it rather than
re-deriving it.[^config-dependency-spec-grammar-ts]

## ConfigDependencyHooks — the opt-in replay seam

A contract service with four layers: an in-process layer that dynamically
imports each config dependency's pnpmfile and replays its config hooks over
the inline-catalog seed, a subprocess twin for bundled consumers, a
no-execution stand-in, and a hermetic `layerFrom` that replays
caller-supplied files with no resolution at all.[^config-dependency-hooks-ts]

The default composites wire the no-op layer — they never execute
config-dependency code, on the worktree side or the ref side; opting in is
an explicit composite choice. Opting in must not cost the git tier: a git
composite that hard-wired the no-op catalogs layer would force a consumer
wanting snapshots plus change detection plus hook replay to rebuild the
whole service graph by hand, so the git composites and their subprocess
twins are built over one internal helper that takes the hooks layer
explicitly and hands the same reference to both `WorkspaceCatalogs` and
`WorkspaceSnapshots` — one memoized layer, one policy for both sides of a
diff, and never a member of the public `WorkspacesServices` output. On the
git composites the subprocess variant is free, because its extra
requirement — core's `ChildProcessSpawner` — is already required for `Git`.

### The replaying layers resolve the declared version

Every replaying layer loads the pnpmfile of the version a
`configDependencies` entry declares — the text before the first `+` of its
`<version>+<integrity>` value, or the whole bare `<version>` — never
whatever `node_modules/.pnpm-config` happens to hold now. Replay takes that
text through the shared splitter but deliberately validates neither half,
unlike `ConfigDependencySpec`: it only matches the text against installed
manifests, store directory names and caller-supplied map keys, so an
unparseable version finds nothing and fails closed with the ladder's own
remediation. Adopting the strict model's rejections would newly fail
replay on specs it resolves today — a malformed integrity it never reads,
or a map key that is not strict SemVer. That entry is a
symlink into the pnpm store's `links/` tree, and the store keeps every
version ever installed on the machine, so a past ref's pnpmfile is
usually recoverable with no checkout, no fetch and no registry.[^config-dependency-resolution-ts]
The ladder runs in the parent for both replaying layers: the installed
copy when its manifest carries exactly the declared version; otherwise the
store's `links/<name>/<version>/*/node_modules/<name>` with the inner
manifest verified rather than the path trusted, the store located from
`.modules.yaml`, then the realpath of any `.pnpm-config` entry, then the
conventional environment and platform locations; otherwise, under the
subprocess layer alone, a verified fetch into the store (below); otherwise
a typed, fail-closed `hooks` assembly error with `reason: "notInstalled"`,
naming the package, the declared version and the ref that declared it,
what is installed, the stores searched and the remediation
(`pnpm add --config <name>@<version>` in a throwaway workspace). Two
honest store copies of one version in one store fail closed too, as
ambiguous: the hash directory is not derivable from the declared integrity
and the store records none, so the ladder names the store and both copies
rather than guessing which code to execute — while discovered stores are
deduplicated by realpath and the decision is scoped to the first store that
holds the version, so an aliased spelling or a second store never reads as
a second copy; the environment rung lists store formats newest first,
numerically, so `v11` outranks a `v10` a pnpm upgrade left behind. In the
resolved directory the first of `pnpmfile.mjs`, `pnpmfile.cjs`,
`pnpmfile.js` present in one directory listing is loaded; a listed but
unreadable file fails typed at import time, never as "ships no hook", and
a dependency shipping none contributes nothing. The ladder reads the real disk through `node:fs`
rather than the effect `FileSystem`, because the store is real even when a
caller's filesystem is virtual; `layerFrom` is the seam for that case,
keyed `"<name>@<version>"` to an absolute path and consulting nothing else.

### The fetch rung (subprocess layer only)

The store holds only what this machine installed, so the base side of a
diff across a config-dependency bump declares a version a fresh checkout
never installed (effected#842). The subprocess layer fetches it rather than
failing: pnpm runs `install --frozen-lockfile` in a scratch workspace,
removed afterwards, whose `pnpm-lock.yaml` env preamble pins the expected
integrity, with `--store-dir` set to the first store the ladder searched
(its parent, since pnpm appends the `v11` segment itself). The replay then
loads the copy the scratch `.pnpm-config` entry links to, and records
`source: "fetched"`; the next replay finds it on the store rung.[^config-dependency-fetch-ts]

The integrity is settled before anything is spawned, fail-closed. Its
sources are the inline `<version>+<integrity>` spec and the declaring
side's lockfile preamble, read through `@effected/lockfiles`'
`PnpmEnvLockfile.configDependencies`. Replay callers pass that side's
lockfile as `HookReplayContext`: the working tree's from
`WorkspaceCatalogs`, the ref's own from `WorkspaceSnapshots.at(ref)`. Two
sources that disagree fail `integrityMismatch`. No source, a non-SRI inline
integrity, or an unreadable lockfile fails `integrityUnavailable`. Nothing
is fetched in any of those cases. Pinning the scratch lockfile, rather than
hashing the result afterwards, is deliberate: the store records no
integrity beside a `links/` entry, so nothing after the fact could check
it, while pnpm checks the tarball against the pinned lockfile and refuses a
mismatch even from a warm store. That was probed on pnpm 11.27.1 and
12.6.0. Two guards cover a pnpm that did not honour the pin: the scratch
lockfile must be byte-identical afterwards, and the linked copy must be a
store entry for exactly that version. Any fetch failure, pnpm's own
integrity refusal included, fails `fetchFailed` with the not-installed
remediation. The in-process layer never fetches, because it has no
subprocess seam.

The scratch fetches through the declaring workspace's registry config, since a
scratch under the OS temp dir would otherwise see only user-level config and a
config dependency behind a scoped registry, a mirror or repo-level auth would
fail `fetchFailed` against the public registry. `<root>/.npmrc` is copied in
as-is, never read or logged, with `${VAR}` references left for pnpm to expand,
and it is removed with the scratch. The root `pnpm-workspace.yaml`'s `registry`
and `registries` keys are carried into the scratch's own; those are the only
registry keys pnpm 11.27.1 and 12.6.0 read from the workspace yaml, since a
flat `@scope:registry` key there is ignored and `npmrcAuthFile` is refused at
project level. `root` is the current checkout for both sides of a diff: a base
ref's `.npmrc` is not read through git, because registry config says where
this machine fetches from, not what a ref declared. Relative paths inside the
`.npmrc`, a `cafile=./ca.pem` for instance, resolve against the scratch and
not the root.[^config-dependency-fetch-ts]

Assembly precedence is lockfile, then inline, then hook-injected, merged
per-dependency within a catalog, with the hooks seeded by the inline
catalogs — matching pnpm's own behavior. Failure is typed, never silent: a
config dependency that fails to load or replay fails with a hooks-sourced
assembly error. The security guard rejects a dependency name containing a
`..` path segment before building the import target, so a malicious entry
cannot escape the intended directory.

The replay returns a structured injection, `HookInjection`, carrying four
slices: `catalogs`, `releaseAge`, `peerDependencyRules`, and `replays` —
the version and resolution rung (`HookReplaySource`) each declared
dependency was replayed from, recorded even for one that ships no pnpmfile
and exposed by `WorkspaceCatalogs.hookReplays()` off the same memo, empty
where config dependencies do not exist. The rung is live, machine-local
provenance; a snapshot keeps only the version. A sibling
method computing any one slice separately would re-execute
config-dependency code — the whole point of the seam is that one replay
over one mutable config object yields every output, exactly as pnpm replays
hooks. Release-age keys thread last-hook-wins, read off the one final
threaded config object, matching pnpm's single-mutable-config-object
behavior; a malformed release-age value is tolerantly dropped, keeping the
prior threaded value, because the assembly error stays reserved for a load
or replay mechanism failure, not a hook's returned data. Peer-dependency
rules are seeded, not merged: the workspace file's block goes in as the
threaded config's initial value, and whatever the hooks return comes back
out — a hook that overwrites overwrites for pnpm too, and this must never
be "fixed" into a kit-owned merger, which would be a second, divergent
implementation of a rule pnpm already owns. See
[peer-dependency rules](workspaces-peer-check.md#peer-dependency-rules-pnpms-suppression-policy-seeded-not-merged)
for the full rationale. Each rules axis threads independently, so a hook
that rewrites `allowedVersions` and leaves `ignoreMissing` alone — or
returns one axis malformed — cannot blank the others.[^config-dependency-hooks-ts]

### layerSubprocess

In-process replay is unreachable in a bundled consumer, because the
in-process layer computes its import target at runtime and a bundler
compiles a computed dynamic import into a context module that resolves
against a build-time directory listing, throwing a module-not-found error
at runtime. This layer is the same replay with every computed load moved
out of the bundle graph.

The replay program is a static string constant, passed via argv: static is
the whole mechanism, since a bundler rewrites the program text it can see,
so the text carries no interpolated runtime value — the root, the seed, and
the parent-resolved name-to-path pairs travel as arguments, never spliced
into the script, and the spawn uses no shell so argv is argv. Typed-semantics
parity with the in-process layer is the contract, pinned by integration
tests rather than by intent: the same declared-version ladder run in the
parent, the same pnpmfile candidate order, the same hook-locator shapes, the
same synchronous hook call, and the same tolerant threading; the child
performs no lookup of its own, so any import failure it reports is a real
load failure.

Per-dependency error attribution crosses the process boundary: the child
prints one final JSON line naming the offending dependency and exits through
the write callback so the payload flushes even if a hook left the event
loop occupied. The parent decodes that envelope through a strict union with
`@effected/commands`' JSON-line runner, which owns the last-line framing and
its noise tolerance, so a hook's own logging is not fatal. The `..`-segment
guard runs before any spawn, strictly earlier than the in-process guard,
never later, and empty config dependencies spawn nothing. Folding and
normalization stay in the parent — the child returns only the raw threaded
config slice, because the script cannot import kit code and duplicating
catalog semantics into a string literal is exactly the drift this package
refuses elsewhere. Transport failure is typed, never silent: a missing
runtime, an exit with no usable payload, or unparseable output are all
assembly errors.

[^workspace-catalogs-ts]: `packages/workspaces/src/WorkspaceCatalogs.ts` —
    `CatalogSet`, `WorkspaceCatalogs`, `ImporterVersions`,
    `CatalogAssemblyFailure`.
[^config-dependency-hooks-ts]: `packages/workspaces/src/ConfigDependencyHooks.ts` —
    the contract, `HookInjection`, `PeerDependencyRules` /
    `NoPeerDependencyRules`, `layerNoop` / `layerLive` / `layerSubprocess` /
    `layerFrom`.
[^config-dependency-resolution-ts]: `packages/workspaces/src/internal/configDependencyResolution.ts` —
    `resolvePnpmfiles`, `lookupPnpmfiles`, the store-discovery rungs and
    the fail-closed message.
[^config-dependency-fetch-ts]: `packages/workspaces/src/internal/configDependencyFetch.ts` —
    the fetch rung, `expectedIntegrity`, the scratch workspace and its guards.
[^config-dependency-spec-ts]: `packages/workspaces/src/ConfigDependencySpec.ts` —
    `ConfigDependencySpec`, `InvalidConfigDependencySpecError`.
[^config-dependency-spec-grammar-ts]: `packages/workspaces/src/internal/configDependencySpecGrammar.ts` —
    `splitConfigDependencySpec` and the header comment on the two policies
    over it.
[^internal-catalogs-ts]: `packages/workspaces/src/internal/catalogs.ts:1-12` —
    the header comment and the four `@pnpm/catalogs.*` imports.
