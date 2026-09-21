# Peer checking — @effected/workspaces

`PeerCheck`: what it answers, the three limits it cannot answer, the three suppression axes it applies, and the two `unverified` reasons it fails closed through.

**Parent:** [@effected/workspaces context](./CLAUDE.md)

## It answers from the resolved graph, never from a subprocess

`PeerCheck` is a **pure value** over a parsed `@effected/lockfiles` `Lockfile`, reading `instanceId`, `resolved` and `peerDependencies`. **No per-format branch exists and none may be added.** Shelling out to each manager's own peer command cannot deliver bun — bun has no such command, and its one stderr line appears only on the install that *changes* the tree.

`PeerCheck.run(lockfile, options?)` returns `{ supported, unsatisfied, unresolvedImporters, unverified }` plus a `required` getter. `UnsatisfiedPeer` and `PeerParent` are the report's value classes; `PeerCheckOptions` and `UnverifiedReason` are its types.

## Three limits are contract, and each is surfaced in the value

Nothing here is swallowed — a limit appears in the report rather than as a missing row:

- **yarn cannot be answered** (`supported: false`) — yarn resolves peers virtually, so the lockfile does not record which virtual instance satisfied which peer.
- **The npm/bun root importer cannot be joined to instances** (`unresolvedImporters`) — neither format records a per-importer resolved version.
- **pnpm records no peer declarations for workspace projects at all**, so those rows are empty by construction.

## `unverified` fails closed, through exactly two reasons

**Both reasons mean "fail closed".** Do not design a distinction between them.

- **`"peerRulesNotApplied"`** — no suppression policy was applied. It fires **only** when the `peerDependencyRules` **key is absent**: presence is the assertion, contents are the value, so `NoPeerDependencyRules` means "I looked, there are none" and omitting the key means "nobody looked". The two must produce different results or a gate cannot tell clean from unchecked. Supplied rules never produce it, whatever they populate.
- **`"unresolvedEdge"`** — some instance carries `ResolvedPackage.unresolvedEdges`. Such a peer is **declined rather than reported**: reporting it is the false positive, declining it silently would be the false negative, so it does both halves.

**The union is closed at two by measurement — never grow a third `UnverifiedReason`.** All three rule axes are applied — `allowedVersions`, `ignoreMissing` and `allowAny` — each with semantics measured against pnpm (the list axes on pnpm 12.5.1, oracle runs under `__test__/fixtures/peers/allowany/` and `ignoremissing/`, effected#430), so no supplied configuration leaves a suppression unreplicated and there is nothing for a third reason to name. Before that measurement a populated list axis forced `"peerRulesNotApplied"`; that fail-closed degrade is gone, and reintroducing it would turn every verified report on a workspace using those axes back into "unchecked".

## Matching rules the report depends on

- **pnpm ignores the parent version in a rule key**, so both spellings must match: versioned (from the workspace file) and unversioned (from a plugin). A **third** spelling names no parent at all (`react: "17"`) and pnpm applies it to every parent that declares the peer — measured against pnpm 11.22.0, where the same workspace it calls clean under `react-dom>react` it also calls clean under a bare `react`, and still reports the row when the bare key's range does not cover what resolved (`peers/barerule`, which carries both oracle runs). Skipping bare keys reported rows pnpm suppresses while the report still called itself verified — a false positive dressed as an applied policy. A key whose parent is EMPTY (`">react"`) is malformed and suppresses nothing — it must not degrade into the bare case.
- **`ignoreMissing` and `allowAny` are PATTERNS over the peer name, never `parent>peer` keys.** The `allowedVersions` grammar does not carry over: `react-dom>react` (versioned or not) matches nothing on either axis, because there is no parent in the grammar — measured, `peers-check-parent-key.json` in both directories. The pattern semantics are `@pnpm/matcher@1000.1.0`'s, restated in `src/internal/peerPatterns.ts` rather than imported so the `@pnpm/*` edge stays in `internal/catalogs.ts`: a lone `*` matches everything, otherwise `*` is a wildcard within the name and a starless pattern is plain equality; a leading `!` negates; a list of only negations matches everything not excluded (`["!redux"]` clears every `react`); a mixed list walks in order and a later negation resets an earlier include, so `["*", "!redux"]` and `["!redux", "*"]` differ. Test the helper directly for the cases the fixtures cannot reach (scoped names, order).
- **The axes never cross, and the partition is on `found`.** `ignoreMissing` hides only rows where **nothing resolved** for a required peer (`found: null`), direct and transitive declarers alike; `allowAny` hides only rows where something resolved **outside the range** (`found !== null`), required and optional alike; `allowedVersions` is range-driven on the same wrong-version rows and rescues no missing peer either. Both halves are oracle-pinned by the cross-axis files (`ignoremissing/peers-check-allowany-react.json` keeps all three missing rows, `allowany/peers-check-ignoremissing-react-redux.json` keeps both bad rows) and by a direct no-cross test that goes red if the two predicates are swapped inside `suppressedByRule`.
- **A package an importer reaches by several chains yields ONE row**, not one per chain. Measured on `peers/diamond`, where `use-sync-external-store@1.2.2` is reached through both react-redux and zustand: pnpm emits its unsatisfied `react` once, with the chain it reached first. `parents` is therefore *a* route, never the set of them, and the dedup key at the emit site says `(importer, peer, instance)` because that is the fact being counted.
- **A peer satisfied by a workspace row is accepted without a version check.** pnpm records no importer version, so the row carries the `"0.0.0"` placeholder and any comparison would be against a placeholder. A declined answer beats a false one.
- **An absent optional peer is satisfied.** Reporting it is a false positive — caught by the differential oracle, pinned by a mutant.
- **The root importer is joined by compose-then-verify, never compose-and-hope.** It has no package row under any format, so its identity is composed from `name@version` plus the importer entry's `peerSuffix` and then **verified** against the real id set. A composed identity matching nothing skips the dependency rather than falling back to a name-and-version guess: two peer variants of one `name@version` are indistinguishable without the suffix, and guessing attributes one variant's peers to an importer that resolved the other.

## The oracle is committed, never shelled out to

`__test__/fixtures/peers/*/peers-check.json` is pnpm's verbatim `pnpm peers check` output, captured at fixture-generation time (provenance in that directory's `README.md`). A test needing a live pnpm on PATH would breach the no-new-subprocess-seam rule and would not be reproducible in CI.

**Rules plumbing:** [catalogs](./CLAUDE.catalogs.md) — `peerDependencyRules` seeding, `WorkspaceCatalogs.peerDependencyRules()`, `NoPeerDependencyRules`.

**Related:** [surface](./CLAUDE.surface.md) · [discovery](./CLAUDE.discovery.md) · [snapshots](./CLAUDE.snapshots.md)
