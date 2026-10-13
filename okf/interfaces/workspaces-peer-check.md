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
  at: 2026-09-27T21:38:36Z
integrity:
  generated:
    body: 5e3f480d91f21917
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
class itself. Its options are three keys, each supplied from what the caller
already has: `peerDependencyRules` (from
`WorkspaceCatalogs.peerDependencyRules()`), `workspacePackages` (from
`WorkspaceDiscovery`) and `catalogs` (from `WorkspaceCatalogs.set()`). The
report carries `supported`, `unsatisfied`, `unresolvedImporters`,
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
`unresolvedEdge`, `peerRangeUnresolved` or `peerVersionUnresolved`, which rules do not touch.

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
confined to the catalogs module, with `@effected/npm`'s
`ReleaseAgeGate.matchesExclude` — the same `@pnpm/matcher` grammar, already
owned there for `minimumReleaseAgeExclude` — as the single-pattern
primitive): a lone `*` matches everything; otherwise
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

## Failing closed: the four unverified reasons

The union is closed at exactly four by measurement. With all three rule
axes applied, no supplied configuration leaves a suppression unreplicated;
with `workspacePackages` supplied, a covered `link:` target is a judged
parent rather than a structural unknown; and the one thing a joined manifest
can still withhold is a range the check cannot name, which is what the third
member says; the fourth is the same gap on the provider side, a version the
lockfile does not carry. Each reason follows the same presence-is-the-assertion rule:
omitting an option key says nobody looked, and the report says so.

- **`peerRulesNotApplied`** — no suppression policy was supplied, so
  pnpm's suppression could not be replicated and some rows may be ones
  pnpm hides. Presence of the option key is the assertion, not its
  contents: supplying `NoPeerDependencyRules` asserts the workspace has
  none, while omitting the key says nobody looked. Collapsing those two
  would tell a gate that an unchecked workspace is clean. Supplied rules
  never produce it, whatever their contents — all three axes are applied.
- **`unresolvedEdge`** — two triggers. Some instance records an edge the
  model could not name, so a peer that edge satisfies cannot be verified.
  Such a peer is declined rather than reported: reporting it would be a
  false positive, declining it silently would be a false negative, and
  only doing both halves is honest. Second, an importer dependency
  resolved through `link:` whose target was not judged for that importer:
  a linked parent's manifest peers are never in the lockfile, so they are
  declined rather than fabricated. That covers a target outside the
  supplied `workspacePackages`, every target when the key is omitted, and
  a covered target the walk never read — one the lockfile records no
  workspace row for (a `link:` outside the workspace globs), or one the
  importer's walk did not reach. Covering a path is not judging it; the
  marker clears only for an edge whose target's peers were actually read
  for the importer that recorded it.
- **`peerRangeUnresolved`** — a peer declared by a joined `link:` manifest
  carries a range that is still a protocol specifier, while something
  resolved for that peer, so the comparison was never performed. The
  triggers are a `catalog:` specifier with `catalogs` omitted, a
  `catalog:` specifier the supplied set names nothing for, and any other
  protocol (`workspace:*` and its kin). A peer with *nothing* resolved
  never produces it: "no provider" needs no range, so that row is reported
  as usual.
- **`peerVersionUnresolved`** — a peer resolved to a non-workspace provider
  whose version is a protocol specifier rather than a version: a `file:`
  directory or tarball, directly or through a `file:` override, and a git
  or remote-tarball provider, which pnpm keys by its URL
  (`https://codeload.github.com/…`, `git+https://…`) so the URL stands
  where a version belongs. The lockfile records
  no version for a `file:` directory, and the model carries the specifier
  (`file:vendor/react`) in its place. `pnpm peers check` reports such a peer
  as a `bad` row with the specifier as its found version, even when the
  directory's manifest satisfies the range; for a joined `link:` parent it
  reads the real version off disk instead. Neither is recoverable from the
  lockfile, so the peer is declined without a row and the report carries
  the marker, on the lockfile-row and joined-manifest paths alike. A
  workspace-row provider stays accepted without a version check, and a
  plain unparseable version is still skipped. The `filedep*` oracles pin
  it; a `file:` tarball is where pnpm itself moved, reporting the specifier
  under 12.6.0 and the tarball's real version under 12.7.0, over the same
  lockfile. pnpm 11 writes the same lockfiles and reports every `file:`
  directory provider clean, whatever its version, so the two supported
  majors disagree over identical input and the marker is the one answer
  consistent with both.

All four mean **fail closed**: a gate treats an unverified report as "not
proven clean", never as a pass.

`PeerCheck` reads `resolved` from `@effected/lockfiles`, which omits any
edge whose identity it cannot compose and verify — a rule that keeps this
package from ever being handed a wrong edge, but that means an absent key
carries two different meanings, "nothing resolved" and "something resolved
that could not be named", and this package treats the first as a positive
finding.

## Joining a `link:`-resolved parent

Under pnpm every `workspace:` dependency is recorded `link:`, and pnpm
records no peer declarations for workspace projects, so a linked parent
joins at best to a workspace row whose peers are empty by design — and, for
the root importer, to nothing at all. `pnpm peers check` nonetheless reports
that parent's peers, because it reads the linked manifest on disk.
`PeerCheck` answers the same question without reading the disk, so the
check stays a pure value over its inputs:

- **The manifest comes from the caller.** `workspacePackages` takes the
  discovery output the caller already has, matched to the `link:` target
  by `relativePath` — the POSIX workspace-relative directory the lockfile's
  importer paths are spelled in — or by the package's publish directory.
  pnpm links a workspace dependency INTO `publishConfig.directory` unless
  `publishConfig.linkDirectory` is `false`, which it defaults to true, so
  the lockfile then records `link:../a/dist`. A covered target contributes
  its manifest's declared peers to the walk, named from the manifest
  (`probe-a@1.0.0`, not the row's `packages/a@0.0.0`) in `parents`.
- **A publish-directory link reads the source manifest.** pnpm reads the
  peers from the manifest AT the link target — the built one — while
  `PeerCheck` reads the supplied source manifest and resolves its `catalog:`
  ranges through `catalogs`. The two agree when the build emits the peer
  ranges the source's specifiers resolve to, which is the contract a
  publish-directory build keeps.
- **Providers come from the importer's own dependency set**, which is where
  pnpm resolves them from — never a sibling importer's, and never a
  workspace-wide lookup by name. The consumer's own `react@18.3.1`
  satisfies the linked parent's `^18.0.0` peer; the same version installed
  only by a sibling does not; the consumer's own `react@17.0.2` is a row
  carrying the wrong version as `found`.
- **Attribution stops at a workspace package.** A linked package's manifest
  peers are judged only for the importer that links it DIRECTLY, and a
  linked package's own dependencies — registry or linked — are judged by
  that package's own importer. pnpm never surfaces either on a consumer one
  link further out, so the walk does not continue past a workspace package
  it reached from the importer. Each `link:` edge is therefore cleared by
  the walk of the importer that records it, or keeps `unresolvedEdge`.
- **The root importer's linked targets are walked too.** The root has no
  workspace row under pnpm to reach them through, so the walk seeds its
  covered targets directly and judges them against the root's own
  dependencies as provider context, exactly as for any other importer.
- **A `catalog:` peer range is resolved through `catalogs`**, and the
  resolved range is what is judged and reported as `wanted` — the value
  `pnpm peers check` reports as `wantedRange`. `WorkspaceCatalogs.set()`
  already folds in catalogs a config-dependency hook injects, so the
  caller passes it as-is.

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

The `link:` join is pinned by twelve fixtures, and the provider-version
reason by four more (`filedep*`). Six are over one probe workspace
(`linkWorkspacePackages: deep`, `probe-a` declaring a `react: ^18.0.0`
peer), each moving one variable:[^peer-fixtures]

- **`linkdeep/`** — `packages/b` depends on `probe-a` and nothing provides
  react: a missing row for `packages/b`, parents `probe-a@1.0.0`, which
  `PeerCheck` reproduces once the manifests are supplied and declines with
  `unresolvedEdge` when they are not.
- **`linkdeep-provided/`** — `packages/b` also depends on `react@18.3.1`:
  clean.
- **`linkdeep-sibling/`** — only a sibling importer has `react@18.3.1`: still
  missing, which is what rules out a workspace-wide provider lookup.
- **`linkdeep-bad/`** — `packages/b` depends on `react@17.0.2`: a wrong-version
  row.
- **`linkdeep-root/`** and **`linkdeep-root-bad/`** — the root importer links
  `probe-a` (`version: link:packages/a`), with no provider and with its own
  `react@17.0.2` respectively: a missing row and a wrong-version row for `.`.

Two move the link target: **`linkdeep-directory/`** (`publishConfig.directory`
alone, recorded as `link:../a/dist`) and **`linkdeep-directory-false/`**
(`linkDirectory: false`, recorded as `link:../a`), with the same missing row.
Four are chains: **`linkchain-parent-provides/`**,
**`linkchain-importer-provides/`** and **`linkchain-none/`** (`b` links `a`,
`a` links `c`, `c` peers on react) put the row on `packages/a` or nowhere,
never on `packages/b`; **`linkchain-registry/`** (`b` links `c`, `c` depends
on `react-dom` without react) reports the missing react on `packages/c` only.

The first four were measured with pnpm 12.5.1 and re-taken with 12.6.0,
identically; the root, directory and chain fixtures were recorded with
pnpm 12.6.0. A
`catalog:` variant of the probe workspace produces a lockfile and verdict
byte-identical to `linkdeep/` — nothing in that pair can record that a range
was catalog-sourced — so the catalog dimension is pinned on the manifest
side, through the `WorkspacePackage` a test supplies, rather than by another
oracle directory.

[^peer-check-ts]: `packages/workspaces/src/PeerCheck.ts` — `PeerCheck`,
    `UnsatisfiedPeer`, `PeerParent`, `PeerCheckOptions`, `UnverifiedReason`.
[^peer-fixtures]: `packages/workspaces/__test__/fixtures/peers/README.md` —
    provenance of every oracle run, including the `allowany/` and
    `ignoremissing/` measurement pass and the eight `linkdeep*` directories
    (`linkdeep`, `-bad`, `-directory`, `-directory-false`, `-provided`,
    `-root`, `-root-bad`, `-sibling`).
