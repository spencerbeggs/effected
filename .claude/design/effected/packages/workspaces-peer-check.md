---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - workspaces.md
  - workspaces-catalogs.md
  - lockfiles.md
---

# @effected/workspaces — peer-dependency checking

## Overview

`PeerCheck` computes a workspace's unsatisfied peer dependencies from a parsed [lockfiles](lockfiles.md) `Lockfile`. It is a **pure value class** — no service, no layer, nothing in `R`, no error channel — alongside `DependencyGraph`, `VersioningStrategy` and `ReleaseTag`. See `src/PeerCheck.ts`.

**It reads the graph rather than shelling out, and that is the design.** Each manager's own peer command was probed first and the approach does not survive contact with bun: bun has no peer command at all, its only signal is a stderr line emitted by the install that *changes* the tree, so a check step running after install sees nothing to parse. npm additionally hard-fails a peer conflict before it can be inspected. Every format, meanwhile, records the declarations, and lockfiles' instance model records what resolved — so one format-free algorithm serves all of them. **No per-format branch exists in this module, and none may be added**; `instanceId` is opaque here and is looked up, never parsed.

The walk starts at each importer's resolved dependencies and follows `resolved` edges, so a peer declared by a *transitive* dependency is attributed to the importer that pulls it in, with the chain in `parents`. That mirrors how pnpm attributes them, and the chain is what makes a row actionable.

## The surface is a report, not an array

`PeerCheck.run(lockfile, options?)` is a total static returning the value class itself, carrying `supported`, `unsatisfied`, `unresolvedImporters` and `unverified`, plus a `required` getter narrowing `unsatisfied` to the non-optional rows — the list a gate acts on. An `UnsatisfiedPeer` row names the importer, the peer, what was wanted, what was found (`null` when nothing resolved at all), whether it is optional, and the `parents` chain from the importer to the declaring package.

**A row is one per `(importer, peer, declaring instance)` — never one per parent chain**, and that is pnpm's own collapse rather than a convenience. Measured on the `diamond` fixture, where a single importer reaches one package through two different parents (an override pins the two parents onto one instance; without it pnpm resolves two versions and there is no diamond to observe): `pnpm peers check --json` emits that instance's unsatisfied peer **once**, carrying the chain it reached first and saying nothing about the other. So **`parents` is *a* route to the declaring package, not the set of routes**, and a consumer must not read it as exhaustive. The emit-time key is what holds that invariant even if the walk is ever replaced by a per-chain one.

The shape is the design. **A bare array would make every limitation below indistinguishable from a clean workspace**, so each one occupies a field of its own and a consumer has to walk past it deliberately.

## Limits are surfaced in the value, never swallowed

An empty result is the most dangerous success shape in this domain — it is indistinguishable from "this could not be checked" — so the return is a report, not an array:

- **yarn cannot be answered.** It resolves peers virtually, giving a peer-bearing package one `@virtual:` locator per consumer, and the lockfile does not record which satisfied which. `supported: false` says so.
- **The npm and bun root importer cannot be joined to instances.** Neither records a resolved version per importer dependency, and neither emits a package row for the root. Those importers are named in `unresolvedImporters` rather than passing silently. pnpm records the version and is unaffected.
- **pnpm records no peer declarations for workspace projects themselves**, so a pnpm workspace package's own unsatisfied peers are not in the lockfile at all — and `pnpm peers check` does not report them either. npm and bun do record them, so under those managers `PeerCheck` answers a question pnpm structurally cannot.

One judgement is worth stating because it was **found by the oracle rather than reasoned out**: an *absent* optional peer is satisfied, since that is what optional means, while an optional peer resolved at the wrong version is still reported with the flag set. The first implementation reported both, and the differential test caught the false positive.

## Joining an importer to an instance: compose, then verify

The root importer has no package row under any format, so it is joined by composing the identity its entry describes — `name@version` plus the recorded `peerSuffix` — and **verifying** that against the real id set. Compose-then-verify, never compose-and-hope: a composed identity matching nothing skips the dependency, and there is deliberately **no name-and-version fallback**, because two peer variants of one `name@version` cannot be told apart without the suffix and guessing would attribute one variant's peers to an importer that resolved the other. Composing is not parsing — nothing splits or indexes an `instanceId`, and a format spelling its ids differently simply fails to match.

That rule was not free. The first implementation joined on name and version alone and *skipped* the ambiguous case, which silently dropped a real unmet peer from the root importer of any workspace holding two peer variants — the shape this repository's own lockfile has. It was found by adding the fixture the verification pass asked for, which is the second false negative the oracle discipline has caught in this module.

## Peer-dependency rules: pnpm's suppression policy, seeded not merged

`PeerCheck` reads the lockfile, but pnpm's verdict is not a pure function of the lockfile. pnpm computes the same peer violations and then **suppresses** the ones `peerDependencyRules.allowedVersions` permits — measured in both directions: remove the rules and the rows appear, restore them and they vanish. A checker without them reports findings pnpm calls clean, which is a false positive of exactly the class this work exists to remove.

**The root cause is an asymmetry in what pnpm persists, and it is worth stating plainly because it bounds every lockfile-only checker, not just this one: pnpm records resolution-affecting config into the lockfile and discards reporting-affecting config.** `overrides` contributed by a pnpmfile *are* written into the lockfile; `peerDependencyRules` appears in it zero times, under any spelling. That is not an oversight to route around — overrides change which tree gets installed and must therefore be part of the tree's identity, while suppression rules change only what pnpm *says* about a tree it would have built identically. So a lockfile-only peer check cannot be correct without external input, by construction, and the config-dependency seam exists to supply that input rather than to guess at it.

The rules have two sources: the `pnpm-workspace.yaml` block (`pnpm:export` materializes it) and config-dependency pnpmfiles, which never touch a file. [The `ConfigDependencyHooks` seam](workspaces-catalogs.md#configdependencyhooks--the-opt-in-replay-seam) already replays every hook over one threaded config object, so the rules are **carried as a third `HookInjection` slice** beside `catalogs` and `releaseAge`, not as a new subsystem. `releaseAge` is the exact precedent: also policy rather than resolution, also unrecoverable from the lockfile, and added as a slice for the same reason.

**The workspace-file rules are seeded into the threaded config, not merged afterwards.** That is the deciding design point and it was settled by measurement: pnpm hands its own config in and takes back what the hooks return, so "seeded value survives unless a hook replaces it" *is* pnpm's semantic, and the seam already enforces it. A kit-owned merge function would be a second, divergent implementation of a rule we already have — the same mistake as reimplementing `pnpm peers check`, rejected for the same reason.

One measured caveat, stated so nobody "fixes" it: **this repo's plugin merges onto the seed; another plugin could overwrite it.** Under seeding that is pnpm's own behaviour reproduced, not a defect introduced here.

Two axes ride along unapplied. `ignoreMissing` and `allowAny` are separate suppression mechanisms nobody has measured, and an unmeasured suppression is precisely what produced the bug being fixed — so they travel through the seam and no kit code acts on them. **Only `allowedVersions` is applied, and rules whose `ignoreMissing` or `allowAny` is non-empty make the report `unverified` (`peerRulesNotApplied`) rather than being silently ignored** — an unimplemented axis degrades to fail-closed instead of to a wrong answer, since a workspace suppressing missing optional peers that way would otherwise get exactly the false-positive class this work removes. A field that exists and does nothing reads as a feature; this one announces that it did nothing. Measuring the two axes and applying them is filed as **effected#430**; until it lands, the degradation above *is* the behaviour, not a stopgap to be quietly removed.

### How pnpm matches an allowedVersions key — measured, not documented

The key spelling is `parent>peer`, and both halves behave in ways pnpm's docs do not state. Measured against pnpm 11 on a crafted lockfile, one axis at a time, with the row's presence as the readout:

- **The version qualifier on the parent is ignored.** A rule keyed `@effect/platform-node-shared@4.0.0-rc.109>effect` suppresses an `rc.110` instance — and so do `@1.0.0` and `@^9.9.9`. Matching is by parent **name**. Replicating this is not optional: keying on the version would suppress a strictly smaller set than pnpm does, and every row in the difference is a false positive.
- **The parent is the DECLARING package, not an ancestor.** A rule keyed on a package higher in the chain does not suppress a peer declared further down, even when that ancestor declares the same peer itself.
- **A key with no `>` names no parent** and applies to every parent declaring that peer, which is also what pnpm does with it.

`PeerCheck` implements exactly this, and the two were verified against each other rather than assumed: the same lockfile and the same effective rules read from `pnpm config list --json`, both reporting the workspace clean — and both reporting the same rows when the rules are withheld. Those withheld-rule rows are the tell worth keeping: they are what `allowedVersions` is suppressing, so a caller that supplies the rules **wrongly** now gets a confident wrong answer where it previously got an honest `unverified`. That is the argument for presence-is-the-assertion stated from the other direction — a degradation that omits the key fails closed with no rows, while one that passes an empty rule set manufactures every suppressed row against a healthy repository.

There are **three key spellings, not two**:

| Key | What it names |
| --- | --- |
| `react-dom@18.3.1>react` | a parent with a version — how `pnpm:export` materializes the block |
| `react-dom>react` | a parent without one — how a config-dependency plugin injects it |
| `react` | **no parent at all** — pnpm applies it to *every* parent declaring that peer |

The bare spelling was skipped outright by a `separator <= 0` guard until it was measured, so the kit reported rows pnpm suppresses **while still reporting the result as verified** — the worst combination available, since the fail-closed marker would at least have said the policy was not applied. Suppression stays **range-driven under every spelling**: a bare `react: "17"` suppresses a `react@17.0.2` finding and a bare `react: "16"` does not. That second half is a committed oracle rather than an inference, and without it "pnpm suppressed it" would be indistinguishable from "a bare key suppresses everything". A key carrying a `>` with an empty parent (`">react"`) is malformed and suppresses nothing — it must never degrade into the bare case, which would silently widen suppression past what pnpm does.

A peer satisfied by a **workspace package is accepted without a version check**. That reads like a hole and is not: pnpm records no version for an importer, so a workspace row carries the placeholder `"0.0.0"`, and any comparison would be against a placeholder rather than the real version. An edge exists and a provider exists, so nothing indicates dissatisfaction — a declined answer beats a false one.

Measured end to end against this repository, every required row clears with the effective rules supplied, while `pnpm peers check` reports the same workspace clean. Of the rows that clear, most are pnpm-suppressed by rules and the rest are `link:`-satisfied peers the model could not name; one is suppressed by a rule that exists **only** in a config-dependency plugin — which is why the seam had to carry hook-injected rules and not merely the workspace file's.

## Failing closed: the two unverified reasons

`PeerCheck` returns a report, and the report knows what it could not check. Two reasons, closed by measurement rather than left open for future additions:

- **`peerRulesNotApplied`** — the effective suppression policy was not applied, so pnpm's suppression could not be replicated and some rows may be ones pnpm hides. **Presence of the option key is the assertion, not its contents.** Supplying `NoPeerDependencyRules` asserts the workspace has none; omitting the key says nobody looked. Collapsing those two would tell a gate that an unchecked workspace is clean, which is the failure the whole design exists to prevent. The same reason covers **supplied rules whose `ignoreMissing` or `allowAny` is non-empty**: only `allowedVersions` is applied, so the policy was not applied in full. It is deliberately not a third reason — the union is closed at two by measurement, and this semantic already fits.
- **`unresolvedEdge`** — some instance records an edge the model could not name, so a peer that edge satisfies cannot be verified. Such a peer is **declined rather than reported**, and the reason is surfaced: reporting it is a false positive, declining it silently is a false negative, and only doing both halves is honest.

### An absent edge is not evidence of absence

`PeerCheck` reads `resolved` from [lockfiles](lockfiles.md), which omits any edge whose identity it cannot compose and verify. That rule keeps this package from ever being handed a *wrong* edge — but it means an absent key carries two different meanings, "nothing resolved" and "something resolved that could not be named", and **this package treats the first as a positive finding**.

That inversion has produced two real false positives. A `link:`-satisfied peer whose identity pnpm spells two different ways yielded no edge, and the check reported an unsatisfied peer for a peer that was satisfied; and an ambiguous importer join, skipped for safety, dropped a genuine unmet peer. In both, the upstream rule was sound and the composition of the two layers was not.

**The rule to carry: a gap in a lower layer is only safe while the layer above does not read it as a fact.** A consumer of any omit-on-uncertainty API owes itself an explicit answer to "could this absence mean something other than zero?" — and where the underlying model cannot say, the honest result is a third state a gate can fail closed on, not a silent verdict either way.

## The differential oracle

`pnpm peers check --json` is the reference for peer semantics, and the suite checks agreement with it — but the oracle is **committed, not executed**. Its output is captured at fixture-generation time and stored beside the lockfile it describes, because this package forbids new local subprocess seams and a test requiring a live pnpm on `PATH` is neither hermetic nor reproducible in CI.

**What agreement establishes is bounded by how the fixtures are made.** Every one is generated by running a package manager over a purpose-built workspace, and none of those workspaces has config-dependency hooks. Oracle agreement therefore validates the computation **on workspaces without config-dependency hooks**, and says nothing either way about workspaces with them — a disagreement has been observed on one that uses them, and these fixtures can only report that it is not reproduced here. Stating the boundary matters because agreement across several cases reads like broader coverage than it is.

**An oracle is per verdict, not per lockfile, and the control run is half of it.** `barerule/` carries two verdicts over one byte-identical lockfile, because there the interesting variable is the *rule* rather than the tree: pnpm calls the workspace clean under a bare `react: "17"` and reports the row under a bare `react: "16"`. Only the pair establishes anything — a single clean run is equally consistent with "bare keys suppress unconditionally", which is a wrong rule that would hide real findings. **A fixture whose oracle cannot fail proves nothing**, so a suppression fixture owes a run that fires alongside the run that does not.

**Both of the semantics above were settled by the committed oracle against a reviewer's proposal, and in both cases the proposal was wrong** — one held that bare keys need no handling, the other that a diamond should yield a row per parent chain. Neither is decidable by reading pnpm's docs or reasoning about what would be tidy; both took one generated workspace and one `pnpm peers check --json`. That is what the oracle is *for*, and it is the working method rather than a changelog entry: in this module a disagreement about pnpm's behaviour is a request for a fixture, never an argument to win.

Where the two differ, the difference is investigated and recorded rather than tuned away: a disagreement may be pnpm seeing something the model cannot (or the reverse, as with workspace-project peers under npm), which is a documented capability difference, not a bug.

## Test edges

The edges most likely to be optimized away, and the reason each exists:

- **The two fail-closed states.** Omitting the rules option reports `peerRulesNotApplied` while supplying `NoPeerDependencyRules` does not — the assertion is the **key's presence**, not its contents — and a peer whose edge the model could not name is declined *and* reported as `unresolvedEdge`, never one without the other.
- **Rule-key semantics, all three spellings**, each against its own oracle, with the negative cases that discriminate them: a different parent, a different version, a bare key whose range does not cover the found version, a bare key naming a different peer, and the malformed `">react"` that must not degrade into the bare case.
- **The diamond collapse**, asserted twice deliberately: against the oracle, and directly on the row count with the second chain shown to be reachable — the oracle comparison alone would still pass if both sides grew the second chain.
- **The ambiguous-join skip and its disambiguation**, driven by a fixture holding two peer variants of one `name@version` — the false negative that shape once hid.
- **Format agnosticism**, asserting npm and bun answer identically through one code path, and yarn returns `supported: false` rather than an empty pass.
