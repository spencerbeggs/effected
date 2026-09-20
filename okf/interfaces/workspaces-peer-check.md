---
type: Interface
title: "@effected/workspaces peer-dependency checking"
description: PeerCheck — a lockfile-only reproduction of pnpm peers check, returning a report rather than an array and failing closed on what it cannot verify.
status: stable
kind: api
resource: ../../packages/workspaces/src/PeerCheck.ts
tags:
  - architecture
  - testing
sources:
  - id: peer-check-ts
    resource: ../../packages/workspaces/src/PeerCheck.ts
  - id: peer-fixtures
    resource: ../../packages/workspaces/__test__/fixtures/peers/README.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-20T05:41:00Z
  body_sha256: 9cb33f48086d7faa8e638d013d228d36cb9ed4cd78f970423d9b280e4d07470b
---

# @effected/workspaces peer-dependency checking

`PeerCheck` computes a workspace's unsatisfied peer dependencies from a
parsed `@effected/lockfiles` `Lockfile`. It is a pure value class — no
service, no layer, nothing in `R`, no error channel — alongside
`DependencyGraph`, `VersioningStrategy`, and `ReleaseTag`.[^peer-check-ts]

It reads the resolved graph rather than shelling out to each package
manager's own peer command, because that approach does not survive contact
with bun: bun has no peer command at all, and its only signal is a stderr
line emitted by the install that changes the tree, so a check step running
after install sees nothing to parse. npm additionally hard-fails a peer
conflict before it can be inspected. Every format, meanwhile, records the
declarations, and the lockfile's instance model records what resolved, so
one format-free algorithm serves all of them — no per-format branch exists
in this module, and none may be added.

The walk starts at each importer's resolved dependencies and follows
`resolved` edges, so a peer declared by a transitive dependency is
attributed to the importer that pulls it in, with the chain carried in
`parents`, mirroring how pnpm attributes them.

## The surface is a report, not an array

`PeerCheck.run(lockfile, options?)` is a total static returning the value
class itself, carrying `supported`, `unsatisfied`, `unresolvedImporters`,
and `unverified`, plus a `required` getter narrowing `unsatisfied` to the
non-optional rows. An `UnsatisfiedPeer` row names the importer, the peer,
what was wanted, what was found (`null` when nothing resolved at all),
whether it is optional, and the `parents` chain from the importer to the
declaring package.

A row is one per `(importer, peer, declaring instance)`, never one per
parent chain — pnpm's own collapse rather than a convenience: when a single
importer reaches one package through two different parents, `pnpm peers
check --json` emits that instance's unsatisfied peer once, carrying the
chain it reached first and saying nothing about the other. So `parents` is
*a* route to the declaring package, not the set of routes, and a consumer
must not read it as exhaustive.

The report shape exists because a bare array would make every limitation
below indistinguishable from a clean workspace, so each limit occupies a
field of its own and a consumer has to walk past it deliberately.

## Limits are surfaced in the value, never swallowed

An empty result is the most dangerous success shape in this domain — it is
indistinguishable from "this could not be checked" — so the return is a
report, not an array:

- **yarn cannot be answered.** It resolves peers virtually, giving a
  peer-bearing package one `@virtual:` locator per consumer, and the
  lockfile does not record which instance satisfied which peer.
  `supported: false` says so.
- **The npm and bun root importer cannot be joined to instances.** Neither
  records a resolved version per importer dependency, and neither emits a
  package row for the root. Those importers are named in
  `unresolvedImporters` rather than passing silently. pnpm records the
  version and is unaffected.
- **pnpm records no peer declarations for workspace projects themselves**,
  so a pnpm workspace package's own unsatisfied peers are not in the
  lockfile at all, and `pnpm peers check` does not report them either. npm
  and bun do record them, so under those managers `PeerCheck` answers a
  question pnpm structurally cannot.

An absent optional peer is satisfied, since that is what optional means,
while an optional peer resolved at the wrong version is still reported with
the flag set.

## Joining an importer to an instance: compose, then verify

The root importer has no package row under any format, so it is joined by
composing the identity its entry describes — `name@version` plus the
recorded `peerSuffix` — and verifying that against the real id set.
Compose-then-verify, never compose-and-hope: a composed identity matching
nothing skips the dependency, and there is deliberately no
name-and-version fallback, because two peer variants of one `name@version`
cannot be told apart without the suffix, and guessing would attribute one
variant's peers to an importer that resolved the other.

## Peer-dependency rules: pnpm's suppression policy, seeded not merged

`PeerCheck` reads the lockfile, but pnpm's verdict is not a pure function of
the lockfile. pnpm computes the same peer violations and then suppresses
the ones `peerDependencyRules.allowedVersions` permits. A checker without
them reports findings pnpm calls clean, which is a false positive of
exactly the class this checker exists to remove.

The root cause is an asymmetry in what pnpm persists: pnpm records
resolution-affecting config into the lockfile and discards
reporting-affecting config. `overrides` contributed by a pnpmfile are
written into the lockfile; `peerDependencyRules` appears in it zero times,
under any spelling — overrides change which tree gets installed and must
therefore be part of the tree's identity, while suppression rules change
only what pnpm *says* about a tree it would have built identically. So a
lockfile-only peer check cannot be correct without external input, by
construction, and the [config-dependency
seam](workspaces-catalogs.md#configdependencyhooks-the-opt-in-replay-seam)
exists to supply that input rather than to guess at it.

The rules have two sources: the `pnpm-workspace.yaml` block and
config-dependency pnpmfiles, which never touch a file, carried as a third
`HookInjection` slice beside `catalogs` and `releaseAge` rather than a new
subsystem. The workspace-file rules are seeded into the threaded config,
not merged afterward, because pnpm hands its own config in and takes back
what the hooks return — "seeded value survives unless a hook replaces it"
*is* pnpm's semantic, and the seam already enforces it. A kit-owned merge
function would be a second, divergent implementation of a rule already
owned elsewhere.

All three axes of the rules are applied — `allowedVersions`,
`ignoreMissing` and `allowAny` — each with semantics measured against pnpm
rather than recalled, because an unmeasured suppression is precisely what
produced the bug this checker exists to remove. `allowedVersions` was
measured against pnpm 11 (below); the two list axes against pnpm 12.5.1,
with every oracle run committed under `__test__/fixtures/peers/allowany/`
and `ignoremissing/`.[^peer-fixtures] Supplied rules therefore never
produce `peerRulesNotApplied`, which is reserved for the case where no rules
were supplied at all; a report can still be unverified through
`unresolvedEdge`, which rules do not touch.

### How pnpm matches an allowedVersions key

The key spelling is `parent>peer`, and both halves behave in ways pnpm's
documentation does not state, measured against pnpm 11 on crafted
lockfiles:

- The version qualifier on the parent is ignored — matching is by parent
  name only, so a rule keyed to one version of the parent suppresses every
  version's instance.
- The parent is the declaring package, not an ancestor — a rule keyed on a
  package higher in the chain does not suppress a peer declared further
  down.
- A key with no `>` names no parent and applies to every parent declaring
  that peer.

There are three key spellings, not two: a parent with a version (how
`pnpm:export` materializes the workspace-file block), a parent without one
(how a config-dependency plugin injects it), and no parent at all (pnpm
applies it to every parent declaring that peer). Suppression stays
range-driven under every spelling. A key carrying a `>` with an empty
parent is malformed and suppresses nothing — it must never degrade into the
bare, no-parent case, which would silently widen suppression past what
pnpm does.

A peer satisfied by a workspace package is accepted without a version
check, because pnpm records no version for an importer, so a workspace row
carries the placeholder `"0.0.0"` and any comparison would be against a
placeholder rather than the real version.

### How pnpm matches ignoreMissing and allowAny, and why the axes never cross

The two list axes share one grammar and it is not the `allowedVersions`
key grammar: an entry is a pattern over the **peer name**, with no parent
in it at all. `react-dom>react` is a literal name nothing declares, so it
matches nothing on either axis, versioned or not — the parent-version quirk
above has nothing to attach to. The patterns are `@pnpm/matcher`'s
(restated in `src/internal/peerPatterns.ts` so the `@pnpm/*` edge stays
confined to the catalogs module): a lone `*` matches everything; otherwise
`*` is a wildcard within the name and a pattern without one is plain
equality; a leading `!` negates. Composition over a list is order-sensitive
when includes and negations mix — `["*", "!redux"]` is everything but
redux, while `["!redux", "*"]` is everything — and a list holding only
negations matches everything not excluded, so `["!redux"]` alone clears
every other name.

The axes partition the rows on `found` and never cross:

- `ignoreMissing` hides a row where **nothing resolved** for a required
  peer (`found: null`), whether the declarer is direct or transitive. It
  never touches a peer that resolved at the wrong version.
- `allowAny` hides a row where **something resolved outside the wanted
  range**, required and optional alike. It never rescues a missing peer.
- `allowedVersions` hides the same wrong-version rows `allowAny` can, by
  range rather than by name, and cannot rescue a missing peer either.

Both halves of the no-cross rule are pinned by cross-axis oracle runs:
`allowAny: ["react"]` leaves every missing `react` in place, and
`ignoreMissing: ["react", "redux"]` leaves both wrong-version rows in
place.

## Failing closed: the two unverified reasons

The union is closed at exactly two by measurement: with all three rule axes
now applied, no supplied configuration leaves a suppression unreplicated,
so there is nothing left for a third reason to name.

- **`peerRulesNotApplied`** — no suppression policy was supplied, so
  pnpm's suppression could not be replicated and some rows may be ones
  pnpm hides. Presence of the option key is the assertion, not its
  contents: supplying `NoPeerDependencyRules` asserts the workspace has
  none, while omitting the key says nobody looked. Collapsing those two
  would tell a gate that an unchecked workspace is clean. Supplied rules
  never produce it, whatever their contents — all three axes are applied.
- **`unresolvedEdge`** — some instance records an edge the model could not
  name, so a peer that edge satisfies cannot be verified. Such a peer is
  declined rather than reported: reporting it would be a false positive,
  declining it silently would be a false negative, and only doing both
  halves is honest.

`PeerCheck` reads `resolved` from `@effected/lockfiles`, which omits any
edge whose identity it cannot compose and verify — a rule that keeps this
package from ever being handed a wrong edge, but that means an absent key
carries two different meanings, "nothing resolved" and "something resolved
that could not be named", and this package treats the first as a positive
finding.

## The differential oracle

See [the yarn limitation](../limitations/workspaces-peer-check-yarn-and-suppression-axes.md)
for the gap this report surfaces rather than swallows.

`pnpm peers check --json` is the reference for peer semantics, and the test
suite checks agreement with it, but the oracle is committed, not executed:
its output is captured at fixture-generation time and stored beside the
lockfile it describes, because this package forbids new local subprocess
seams and a test requiring a live pnpm on `PATH` is neither hermetic nor
reproducible in CI. Agreement is bounded by how the fixtures are made —
every one is generated over a purpose-built workspace with no
config-dependency hooks, so oracle agreement validates the computation only
on workspaces without them.

[^peer-check-ts]: `packages/workspaces/src/PeerCheck.ts` — `PeerCheck`,
    `UnsatisfiedPeer`, `PeerParent`, `PeerCheckOptions`, `UnverifiedReason`.
[^peer-fixtures]: `packages/workspaces/__test__/fixtures/peers/README.md` —
    provenance of every oracle run, including the `allowany/` and
    `ignoremissing/` measurement pass.
