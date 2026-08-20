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

That exemption has been *measured*, not assumed. Across every npm and bun fixture, every declared name the walk does not find is a `peerDependencies` entry nothing installed — an unmet optional peer of `vite`, `vitest` or `react-redux` — and not one is in `dependencies`, `devDependencies` or `optionalDependencies`. Making the two resolvers report those (the shape `pnpm` and `yarn` return) was tried as a mutant: it raises `unresolvedEdges` on ordinary lockfiles, and `PeerCheck` turns straight to `unverified: ["unresolvedEdge"]` for a workspace with nothing wrong with it. `Lockfile.test.ts` pins the exemption in both directions, with the pnpm `unnameablelink` fixture as the control that the field is reachable at all.

## Per-format identity and resolution

- **pnpm** emits one row per `snapshots:` entry, with peer declarations joined on from the per-version `packages:` entry — peer variants therefore become distinct rows. A `packages:` entry no snapshot covers is emitted as an **orphan carrying no resolution** rather than dropped. Importer rows resolve registry versions by composition and `link:` targets by path normalization; **snapshot edges do too**. pnpm spells a linked resolution two ways — a readable `link:<path>` in the snapshot body, and a mangled `name@packages+dir+parts` inside peer suffixes — and *neither* composes to a key. Snapshot `link:` targets are root-relative (importer ones are importer-relative) and match a workspace importer's id. Dropping those edges was not a harmless gap: one layer up, a peer with no recorded provider reads as an unsatisfied peer, so a satisfied link became a false positive. **A `link:` target that names no importer still resolves to nothing** — this widens what legitimately matches; it does not soften compose-then-verify into compose-and-hope. One further widening, importer edges only: under a **`workspace:` specifier**, a target that is no importer resolves to the longest ancestor importer path, because pnpm's `publishConfig.linkDirectory` records the link against the package's publish directory (`link:../bundler/dist/dev/pkg` for importer `packages/bundler`). The specifier is the evidence — a hand-written `link:` target may be a vendored stub with its own identity, so it stays unnameable — and the root importer is excluded, being an ancestor of everything. Snapshot edges carry no specifier and are therefore untouched.
- **npm** and **bun** resolve positionally by replaying the walk their key scheme encodes, **deepest-first**. Reversing that direction returns the hoisted copy and silently mis-reports every shadowed dependency — mutation-checked.
- **yarn** identifies by locator and resolves dependency edges through the lockfile's own descriptor→locator index. Peers are deliberately absent: yarn resolves them virtually, and the lockfile does not record which virtual instance satisfied which peer. `devDependencies` is absent for a different reason — **a Berry lockfile has no such section**: yarn folds a workspace's dev declarations into the entry's `dependencies` map, and the lockfile is byte-identical whether a dependency is declared dev or not (probed against yarn 4.9.1; `yarn/devdeps` is the fixture). Dev edges are therefore already resolved, and iterating `entry.devDependencies` is dead code — adding it changes no test in either package.

## Consumer

`@effected/workspaces`' `PeerCheck` is the consumer these fields exist for; its `"unresolvedEdge"` fail-closed reason is `unresolvedEdges` read one layer up.
