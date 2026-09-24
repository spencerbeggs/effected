---
type: Interface
title: "@effected/workspaces discovery and detection"
description: "Root finding, the packages: enumerator, the WorkspacePackage located-member model, and package-manager detection."
status: stable
kind: api
resource: ../../packages/workspaces/src/WorkspaceDiscovery.ts
tags:
  - architecture
sources:
  - id: workspace-discovery-ts
    resource: ../../packages/workspaces/src/WorkspaceDiscovery.ts
  - id: workspace-package-ts
    resource: ../../packages/workspaces/src/WorkspacePackage.ts
  - id: workspace-root-ts
    resource: ../../packages/workspaces/src/WorkspaceRoot.ts
  - id: package-manager-name-ts
    resource: ../../packages/workspaces/src/PackageManagerName.ts
  - id: enumerate-ts
    resource: ../../packages/workspaces/src/internal/enumerate.ts
  - id: traverse-ts
    resource: ../../packages/workspaces/src/internal/traverse.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
  body_sha256: 4638344c8824e788fda2b83ac63e088b030525bb480e791f3249357b919ba0eb
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:49.503Z
---

# @effected/workspaces discovery and detection

Discovery is the half of [`@effected/workspaces`](../modules/workspaces.md)
that answers where the workspace is, what is in it, and which package
manager runs it. The services live in `WorkspaceRoot`,[^workspace-root-ts]
`WorkspaceDiscovery`,[^workspace-discovery-ts] and `PackageManagerName`,
each with its layer in the same module; the
located-member model is `WorkspacePackage`.

## The packages: enumerator

`internal/enumerate.ts` compiles the `packages:` list once, with no options
surface to diverge on, and enumerates the workspace.[^enumerate-ts] Literal
entries fast-path to an exact manifest existence check. Wildcards read from
the compiled enumeration prefix: a single-level read when the pattern cannot
cross segments, and a bounded iterative descent from that prefix when it
can, testing each visited directory's root-relative POSIX path against the
pattern. Excludes drop candidates after positive matching, and a directory
counts as a workspace package only if it holds a manifest.

The descent is a worklist, not a recursion, so it cannot overflow the stack.
It is bounded three ways: an integer-guarded depth cap (so `NaN` and
fractional caps fail as a defect rather than silently enumerating nothing),
a visited-directory budget, and unconditional pruning of `node_modules` and
`.git`. A wildcard whose prefix names a nonexistent directory fails typed.
This exists to fix a real degradation: a trailing globstar could silently
collapse to a single-level wildcard, leaving a nested package undiscovered
with no diagnostic.

### One traversal, two entry points

`internal/traverse.ts` owns the worklist, the dequeue discipline (a head
index, never `Array.shift()`, since `shift()` re-indexes the array on every
dequeue and makes draining a near-budget worklist quadratic), the depth
rule, the visit budget, and the prune list.[^traverse-ts] Both the Effect
enumerator and the [sync escape
hatch](../modules/workspaces.md#workspacessync-the-escape-hatch) drive this
one state machine, and neither re-decides any of it. The depth cap bounds
what is enumerated, not merely what is descended into. The one deliberate
divergence between the two entry points is what happens at a bound: the
Effect path fails typed, and the sync path truncates because it has no
error channel.

## WorkspacePackage

A `Schema.Class` carrying a located workspace member.[^workspace-package-ts]
It keeps a tolerant manifest projection rather than embedding
`@effected/package-json`'s strict `Package` model, because that model
requires a valid name and a parseable semver version — one member with a
non-semver version would otherwise fail discovery for the whole repository.
The as-read manifest record is captured at discovery, so a consumer needing
a field outside the typed slice reads it without a second file read or a
strict decode that can fail on odd manifests; a re-reading manifest method
stays available separately, because its point-in-time refresh semantics
depend on re-reading a captured record cannot provide.

`version` is optional, carried exactly as the manifest has it. A private
monorepo root without a `version` field is the ordinary pnpm shape, and pnpm
itself accepts a version-less private member anywhere in the tree, so the
former `missingVersion` discriminant is gone: `WorkspaceDiscoveryError.kind`
carries only `read`, `invalidJson`, `invalidShape`, `invalidYaml`, and
`missingName`. Absence stays absence (no `"0.0.0"` placeholder, no
present-but-`undefined` key), a string rides through verbatim, and a
`version` that is present but not a string — or present but empty — is
`invalidShape`, because an empty string was never a legitimate pnpm shape
and would otherwise reach a `workspace:` resolution as a bare `^`. A
root-only exemption was rejected because the class type cannot narrow per
member: the public type would have become optional anyway while the
runtime stayed needlessly strict.

`WorkspaceResolver.versionOf` answers the two questions discovery keeps
apart: `Option.none()` for a name that is not a workspace member at all, and
a typed `DependencyResolutionError` for a member that is one but declares no
`version` — because the `workspace:` contract reserves `none` for "not a
member", and answering it for a version-less member would read downstream
as exactly that.

`workspaceRoot` is a required carried field, not a derived getter.
Discovery resolved the root before enumerating and the sync facade is
handed it, so dropping it was pure information loss that consumers
repaired by counting `relativePath` segments and re-ascending. The
asymmetry with `manifestRecord`, which defaults to `{}`, is deliberate:
`{}` is an honest "no record", but there is no honest default root, and a
placeholder would hand back a wrong absolute path that a consumer then
resolves configuration against. A `WorkspacePackage` serialized before the
field existed therefore fails decode, which is the conservative direction
because re-running discovery is cheap.[^workspace-package-ts]

`getWorkspacePackagesSync`, the sync facade, has no error channel; its
totality pairs with an `onSkip` diagnostic (`WorkspaceDiscoverySkip`, whose
`kind` is the `WorkspaceDiscoveryError` vocabulary minus `invalidYaml`,
which describes the `pnpm-workspace.yaml` read rather than a manifest) so a
skip is never silent.

## Root finding and discovery

Root finding runs over `@effected/walker`'s upward ascent, inheriting
per-probe error absorption. Markers are checked in priority order: the pnpm
workspace file, then a manifest with a `workspaces` field.

The ascent is bounded on request: `find(cwd, { stopAt, maxDepth })` passes
both straight through to `Walker.ascend`, which already owned the two
concepts. `stopAt` is inclusive — the ceiling itself is probed — and is
resolved to an absolute path before the walk, because the walker compares
it to each ancestor by string equality and an unresolved ceiling would
never match, silently degrading to the unbounded ascent the option exists
to prevent. An unmarked ceiling fails typed with `stopAt` recorded on
`WorkspaceRootNotFoundError`, which is what distinguishes "no root anywhere
above me" from "none below my ceiling".[^workspace-root-ts] The sync facade's
`findWorkspaceRootSync` has not been given the same bounds.

Discovery reads
the packages list from whichever source the workspace uses, enumerates it,
reads each manifest, and absorbs the longest-prefix file-to-package lookup.

Discovery is bound to one root, and `listPackagesIn` / `infoIn` are the
escape from that binding, not a convenience — a long-lived host such as an
MCP server or a language server resolves its root once at startup and then
serves calls scoped to a git worktree of the same repository, a nested
repository, or another project entirely. These two take a directory,
resolve its root by the same upward walk, and re-read everything beneath
it. The re-read is the point: re-rooting the layer's existing package list
by rewriting each `path` onto the caller's directory would produce
correct-looking paths over the original root's manifests, so a worktree
whose branch adds, removes, or renames a package would silently report the
other branch's membership.

Memoization is per resolved root, kept in a map deliberately separate from
the layer-bound memo, so many directories inside one workspace can share one
discovery without every layer-bound call re-running the root ascent.
`refresh()` clears every per-root memo plus the layer-bound one;
`refreshIn(directory)` drops exactly one, invalidating the cell before
dropping the map reference so a fiber already holding that memo keeps its
own reference rather than replaying a discarded discovery. There is no
eviction policy, because the consuming host's roots are unbounded in
principle but single-digit in practice.

Root resolution takes an optional cwd, read lazily at first use inside a
suspend, so a directory change between provide and first call is honoured;
no service method reaches for the ambient cwd on its own.

## Package-manager detection

Lockfile evidence is the primary signal, because it is what says which
manager actually ran. The workspace tier checks the pnpm workspace file,
then a bun lockfile plus a manifest field naming bun, then a yarn lockfile
plus a manifest field naming yarn, then a `workspaces` field for npm — the
manifest conjunction on bun and yarn disambiguates a stray lockfile in an
npm repo.[^package-manager-name-ts]

Two further tiers close the single-package case, running only after every
workspace marker has missed, which makes the widening strictly additive: a
standalone tier, where a pnpm or npm lockfile stands alone because each is
written by exactly one manager (bun and yarn keep the manifest conjunction,
mirroring the workspace tier exactly), and a declaration tier, where no
lockfile exists at all but a manifest field names one of the four managers
— weaker evidence, consulted last, for a fresh clone before its first
install.

The detector refuses to guess: nothing matching is a typed error, never a
fabricated default, because choosing a default is policy, not detection,
and a library that makes that choice silently guarantees some caller is
wrong. A consumer wanting a default writes the fallback where a reader can
see it.

Within the workspace tier the npm `workspaces` field is still consulted
before any standalone lockfile, so a repository with both reports npm; this
known asymmetry is deliberately unchanged, because reordering would be a
behavior change to an already-shipped path.

The two manifest fields that can declare a manager — the top-level field and
`devEngines.packageManager` — are not interchangeable: the dev-engines name
is authoritative for the name where both are present and disagree, and the
top-level field is authoritative for the exact version because it carries
the integrity hash. A version is reported only when the field it came from
names the manager actually detected. A malformed manifest hint is ignored,
never fatal, but a root manifest that is present yet unreadable or
unparseable fails typed, because that is a real problem rather than a
missing hint.

## Test doubles

All three services ship `makeTest` / `layerTest` doubles, so the whole
discovery path stands up with no filesystem at all. The `WorkspaceRoot`
double honours `stopAt` — a hand-rolled `find` that ignores the ceiling
makes a bounded call pass under test and fail live, the very failure the
option exists to catch — and deliberately does not model `maxDepth`,
because it never walks, so there is no depth to cap and pretending
otherwise would encode a fiction; `WorkspaceRootShape` is exported so a
consumer can type a bespoke double against the contract.[^workspace-root-ts]
Both per-root methods
die unstubbed on the double, because deriving `listPackagesIn` from
`listPackages` would model a world in which every root holds the same
members — precisely the confusion the method exists to remove. Workspace
info and detection also die as defects rather than returning a fabricated
default: a double that answered a detection question with a manager would
contradict the defining property of the live detector, which is that it
refuses to guess, and failing typed would be the subtler mistake, because a
detection error reads as a legitimate "no manager here" answer a consumer
branches on and proceeds past.

[^workspace-discovery-ts]: `packages/workspaces/src/WorkspaceDiscovery.ts` —
    the `WorkspaceDiscovery` service, `WorkspaceInfo`, and its error union.
[^workspace-package-ts]: `packages/workspaces/src/WorkspacePackage.ts` —
    `WorkspacePackage`, `PublishConfig`, `DependencyDiff`,
    `WorkspaceManifestError`.
[^workspace-root-ts]: `packages/workspaces/src/WorkspaceRoot.ts` — the
    `WorkspaceRoot` service, `WORKSPACE_MARKERS`, `FindWorkspaceRootOptions`
    (`stopAt` / `maxDepth`), and the `makeTest` / `layerTest` double.
[^package-manager-name-ts]: `packages/workspaces/src/PackageManagerName.ts` —
    `PackageManagerName`, `DetectedPackageManager`, `PackageManagerDetector`.
[^enumerate-ts]: `packages/workspaces/src/internal/enumerate.ts` — the
    compiled-pattern enumerator.
[^traverse-ts]: `packages/workspaces/src/internal/traverse.ts` — the shared
    worklist traversal.
