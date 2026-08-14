# Dependency catalogs and peer closure — effected

Child context file for the pnpm catalogs, the interop catalogs and the peer-warning classes `pnpm peers check` reports. The catalog rules that bite live in the parent; this file explains what the warnings mean and which ones are expected.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

## The catalogs

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml` (`catalog:effect`, `catalog:effectPeers`, `catalog:silk`, plus the `effect3` / `effect3Peers` v3 interop catalogs), managed via `packages/pnpm-plugin-effect`.

Under the `lock` strategy every consumer resolves the one pinned beta, so `catalog:effectPeers` holds the same exact beta, not a caret floor. The `effect3` / `effect3Peers` interop catalogs track the latest Effect **v3** (caret-ranged, not synced to the vendored tree) for dual-version testing, and drop at the plugin's `1.0.0`.

## The exact `effect` peer is silently satisfiable in a consumer's tree

Every published `@effected/*` package advertises `"effect": "4.0.0-beta.107"` — **exact, no caret** — because `catalog:effectPeers` is locked to the pin. That is deliberate and kit-wide (it is not a per-package choice, so do not "fix" one package's peer to a range).

**The consumer-side hazard it creates, which nothing in the kit warns about:** under `autoInstallPeers: true` — pnpm's common default — an exact peer that *cannot* be satisfied is **glued anyway, without a resolution error**. A repo still on `effect@3.x`, or on an older beta, installs an `@effected/*` package cleanly and the mismatch surfaces later, from a different module, as a runtime failure:

```text
SyntaxError: The requested module 'effect' does not provide an export named 'FileSystem'
```

Nothing names the peer in that error. Reported by `@spencerbeggs/reposets` (2026-08-12), where it blocked builds, `pnpm exec` and `git commit` — commitlint runs through pnpm — until diagnosed. Its route in was a *third-party* package taking an `@effected/*` package as a **peer** rather than a dependency, which pushes the resolution decision onto a consumer that has no idea it is making one.

The diagnosis, when this shape arrives: check the installed `effect` against the peer the `@effected/*` package declares, before reading the `SyntaxError` as an Effect API problem. A missing v4-only named export (`FileSystem`, `Result`, `Schema` moved into core) from a v3 `effect` is this bug, not a rename.

## "It's CommonJS, so no named imports" is too coarse — and the coarse version costs a test

Node's ESM loader runs **`cjs-module-lexer`** over a CommonJS dependency and detects *some*
of its named exports. So the shorthand "CJS means `import pkg from` only" is wrong in the
direction that hurts: a named import may work for one symbol and throw for its neighbour in
the same module.

Measured on `blakejs` (2026-08-13, Node 26): the CJS object carries **ten** keys and exactly
**one** — `blake2b` — is detected as a named export. The other nine, `blake2bHex` among
them, are not.

```text
import { blake2b }    from "blakejs"   // OK
import { blake2bHex } from "blakejs"   // SyntaxError at runtime, builds cleanly
```

Two consequences worth keeping:

- **A "this named import throws" test must name the symbol it was written for.** A test
  asserting that *the module* rejects named imports passes green against a detected symbol
  while pinning a fiction — which is what a consumer nearly shipped here after generalising
  a real `blake2bHex` failure to the whole module.
- **Pin the detected set, not the module's format.** A test that asserts *which* symbols are
  importable fails when someone adds a call to an undetected one, with a reason, instead of
  at runtime in production.

The failure mode is the reason this is worth measuring rather than assuming: an undetected
named import **type-checks, bundles and builds cleanly**, then throws on first execution.

## The one expected `pnpm peers check` issue class

**`pnpm peers check` reports one known issue class, currently with a single occupant** (state as of the 2026-08-11 beta.107 wave adoption). It is the *toolchain* graph, not this workspace: `rolldown-pnpm-config@0.5.7` (the `pnpm-plugin-effect` build tool, not yet republished against the wave) hard-depends on beta.101-era artifacts, and `@effect/platform-node-shared@4.0.0-beta.107` inside that sub-graph sees the beta.101 it resolves against. It clears when `rolldown-pnpm-config` republishes against the current beta — which is why beta.101 and beta.107 legitimately coexist in the tree right now, and the island only executes during the user-run `pnpm:up`/`pnpm:export` flow. This is expected, not a defect to chase. (The 2026-08-11 advance also proved what the class becomes when an API is *removed* between betas: a hard module-init crash, bridged by temporary local shims until the republish — see PR #322.)

## Satellite drift is retired

The `@effect` satellite-drift warning class is permanently retired: `pnpm-plugin-effect` generates a version-qualified `peerDependencyRules.allowedVersions` table from the lock catalog (regenerated by the package's `pnpm:export` flow), so a satellite one beta ahead or behind the pin no longer warns while genuine v3 complaints stay live. The regenerated table so far only binds this repo's own checkout — it reaches external consumers, the `@savvy-web` toolchain graph among them, only once `pnpm-plugin-effect` publishes and the toolchain adopts that release, both still pending.

**Do not silence these warnings, and do not read their presence as license to tolerate an unrelated one: a warning outside the toolchain graph is a genuine closure defect to fix upstream.**

## Why the mechanics hold

The `autoInstallPeers` mechanics and the `lock` vs `interop` catalog strategies → `@./.claude/design/effected/architecture.md` — Load when: editing catalogs, catalog strategies, or peer declarations.

---

**Related context:** [CLAUDE.build-and-test.md](./CLAUDE.build-and-test.md) for the build pipeline that consumes these catalogs.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the repo overview.*
