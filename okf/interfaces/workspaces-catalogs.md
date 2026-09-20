---
type: Interface
title: "@effected/workspaces catalogs and the config-dependency seam"
description: WorkspaceCatalogs and CatalogSet assembly, the release-age gate, and the ConfigDependencyHooks opt-in replay seam over pnpm config dependencies.
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
generated:
  by: "okfit/claude-code"
  at: 2026-09-20T16:10:17Z
  body_sha256: b0f4b60a03e8521eee147ce6e271fed2eb60f3d76f7be0b18968d62364bc20d6
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
a fallback chain, while the catalog readers' output is load-bearing.

The workspace's effective pnpm release-age gate folds the inline config
keys and the hook contributions through `@effected/npm`'s combining
vocabulary, reusing the single memoized assembly pass so config-dependency
code runs exactly once. Present-but-malformed inline values hard-fail, the
same posture as a malformed inline catalog block. There is deliberately no
top-level convenience wrapper for it — the service method is the surface.

`WorkspaceCatalogs.peerDependencyRules()` returns the merged
peer-suppression rule set — the `pnpm-workspace.yaml` block seeded through
the hook replay — which is the input
[`PeerCheck`](workspaces-peer-check.md) needs to reproduce pnpm's
suppression. It is a sibling method rather than a second assembly pass,
which is what keeps config-dependency code running exactly once; an absent
block yields `NoPeerDependencyRules`, an assertion rather than a gap.

`src/internal/catalogs.ts` is the only module in the package that imports
`@pnpm/catalogs.*`.[^internal-catalogs-ts]

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
whatever `node_modules/.pnpm-config` happens to hold now. That entry is a
symlink into the pnpm store's `links/` tree, and the store keeps every
version ever installed on the machine, so a past ref's pnpmfile is
recoverable with no checkout, no fetch and no registry.[^config-dependency-resolution-ts]
The ladder runs in the parent for both replaying layers: the installed
copy when its manifest carries exactly the declared version; otherwise the
store's `links/<name>/<version>/*/node_modules/<name>` with the inner
manifest verified rather than the path trusted, the store located from
`.modules.yaml`, then the realpath of any `.pnpm-config` entry, then the
conventional environment and platform locations; otherwise a typed,
fail-closed `hooks` assembly error naming the package, the declared
version, what is installed, the stores searched and the remediation
(`pnpm add --config <name>@<version>` in a throwaway workspace). Two
honest store copies of one version fail closed too, as ambiguous: the
hash directory is not derivable from the declared integrity and the store
records none, so the ladder names both copies rather than guessing which
code to execute. In the
resolved directory the first of `pnpmfile.mjs`, `pnpmfile.cjs`,
`pnpmfile.js` present in one directory listing is loaded; a listed but
unreadable file fails typed at import time, never as "ships no hook", and
a dependency shipping none contributes nothing. The ladder reads the real disk through `node:fs`
rather than the effect `FileSystem`, because the store is real even when a
caller's filesystem is virtual; `layerFrom` is the seam for that case,
keyed `"<name>@<version>"` to an absolute path and consulting nothing else.

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
for the full rationale.

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
[^internal-catalogs-ts]: `packages/workspaces/src/internal/catalogs.ts:1-12` —
    the header comment and the four `@pnpm/catalogs.*` imports.
