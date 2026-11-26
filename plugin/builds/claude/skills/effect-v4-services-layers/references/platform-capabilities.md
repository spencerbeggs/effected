# Platform capabilities — require in R, never own a backend

Effect v4's consolidated core **declares** the platform service contracts —
`FileSystem`, `Path`, `Terminal`, `Stdio` as top-level `effect/*` modules, and
`ChildProcessSpawner` (subprocesses) under `effect/process` — while the
**implementations** live in `@effect/platform-*` (Node's `NodeServices.layer`
provides `ChildProcessSpawner | FileSystem | Path | Stdio | Terminal`
in one layer; crypto is not in it — the `effect/crypto` services such as
`Digest` come from `NodeCrypto.layer` or a family layer like
`NodeCrypto.layerDigest`, or core's `Digest.layerWebCrypto`; a consumer's own doc
comment saying `NodeServices.layer` provides crypto is stale, so fix it). All of these contracts are tagged `@stability unstable` — a
minor `effect` release may change their shape — which does not change the
rule below; it means a library re-verifies its usage when the installed
`effect` moves. That split fixes the house default:

- **A library that needs a platform capability requires the core-declared
  service in its `R` channel** and the application provides the platform layer
  once at the edge. Requiring-in-R is free — it adds no dependency edge and no
  tier cost. This is how `walker`, `xdg` and `config-file` consume
  `FileSystem`, and how anything subprocess-shaped consumes
  `ChildProcessSpawner`.
- **Taking `@effect/platform-*` as a dependency edge is categorically
  different** — it drags the platform package into every consumer's tree
  (integrated tier). Do not conflate the two: "platform-node is tier 3" is a
  statement about dependency edges, never about `R`.
- Platform packages are legitimate **devDependencies for integration tests**,
  and legitimate **dependencies only in applications and app-edge packages**
  (a CLI binary, a server entrypoint).
- **A direct `node:` import in library code is a code smell**, most of the
  time. The sanctioned exceptions are documented Node-only overlays — a
  default layer or a sync escape hatch — never a contract or a
  business-logic path.

Before designing any service or seam, grep the core source — the
`@stability unstable` namespace modules included, since they import exactly
like any other core module rather than living under a separate path — for an
existing contract (`effect-v4-source-lookup` resolves the tree). A parallel
subprocess vocabulary (`Command`/`CommandRunner` plus a hand-rolled
`node:child_process` layer) is exactly what this check prevents:
`effect/process` already declares all of it.
