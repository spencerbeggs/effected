# Instances and resolution — @effected/lockfiles

What a `ResolvedPackage` row identifies, how each format's edges are resolved, and why an unnameable edge is reported rather than dropped.

**Parent:** [@effected/lockfiles context](./CLAUDE.md)

## A row is one package *instance*, not one package

`instanceId` is the lockfile-native identity **verbatim** — pnpm's snapshot key, npm's full entry key, bun's `packages` key, yarn's locator — opaque and never synthesized. Look it up; never parse it.

`resolved` maps a dependency (and, where recorded, peer) name to the `instanceId` it actually resolved to. Every edge is **verified against the lockfile's own id set**: an edge that cannot be named honestly is **omitted**, never guessed.

`peerDependencies` (name→range) and `peerDependenciesMeta` (name→`{ optional: boolean }`) sit alongside `dependencies`. All three default to `{}` at construction and on decode, so an absent section is an empty record, never `undefined`. They are **declarations only** — what a package asks for, never what resolved. Populated from all four formats; bun's `optionalPeers` *array* is normalized into the meta shape, and pnpm workspace rows stay empty because a pnpm lockfile records no importer peer declarations at all (probed against pnpm 11.22.0, with and without `autoInstallPeers`).

## `unresolvedEdges` — recorded but unnameable, which is not absence

`unresolvedEdges` carries dependency names whose edge the lockfile **records** but the model could not name (a `link:` into a non-importer directory, a composed identity matching no instance). It exists because an absent key in `resolved` otherwise means two different things — "nothing is there" and "something is there I could not name" — and a consumer reading the first for the second turns this package's gap into its own false positive.

**npm and bun contribute nothing to it**: their sections are declarations resolved positionally, so "the walk found nothing" is genuine absence, and a fail-closed signal that is always on is a signal nobody reads. A dependency the lockfile does not record is an absence, never an unresolved edge.

## Per-format identity and resolution

- **pnpm** emits one row per `snapshots:` entry, with peer declarations joined on from the per-version `packages:` entry — peer variants therefore become distinct rows. A `packages:` entry no snapshot covers is emitted as an **orphan carrying no resolution** rather than dropped. Importer rows resolve registry versions by composition and `link:` targets by path normalization; **snapshot edges do too**. pnpm spells a linked resolution two ways — a readable `link:<path>` in the snapshot body, and a mangled `name@packages+dir+parts` inside peer suffixes — and *neither* composes to a key. Snapshot `link:` targets are root-relative (importer ones are importer-relative) and match a workspace importer's id. Dropping those edges was not a harmless gap: one layer up, a peer with no recorded provider reads as an unsatisfied peer, so a satisfied link became a false positive. **A `link:` target that names no importer still resolves to nothing** — this widens what legitimately matches; it does not soften compose-then-verify into compose-and-hope.
- **npm** and **bun** resolve positionally by replaying the walk their key scheme encodes, **deepest-first**. Reversing that direction returns the hoisted copy and silently mis-reports every shadowed dependency — mutation-checked.
- **yarn** identifies by locator and resolves dependency edges through the lockfile's own descriptor→locator index. Peers are deliberately absent: yarn resolves them virtually, and the lockfile does not record which virtual instance satisfied which peer.

## Consumer

`@effected/workspaces`' `PeerCheck` is the consumer these fields exist for; its `"unresolvedEdge"` fail-closed reason is `unresolvedEdges` read one layer up.
