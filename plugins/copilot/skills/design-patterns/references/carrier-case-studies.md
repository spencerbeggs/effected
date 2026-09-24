# Carrier case studies

Three real repositories implement the carrier pattern (see
[carrier-package.md](./carrier-package.md)). None of the three is complete
on its own — the prescriptive rule across the other references in this
skill is a best-of-three composite. This file is where each repository's
own shape, strengths and gaps live, so a reader can go straight to a real
example instead of taking the composite on faith.

All three first tried peer-dependency and hoisting tricks and rejected
them — including `autoInstallPeers`, which also pulled the wrong Effect
versions in — before landing on the carrier shape. See
[carrier-package.md](./carrier-package.md) for why bin-linking can't be
fixed that way at all.

## okfit — canonical, cleanest shape

Repository: <https://github.com/spencerbeggs/okfit>

```text
core -> profiles -> engine -> {cli, mcp, lsp} -> plugin (carrier: okfit, okfit-mcp, okfit-lsp)
```

What it does best:

- **The only one of the three with real version threading** — the
  `Distribution` `Context.Reference`, `engine_version` as the comparable
  version, and a `--version` line that reports carrier, CLI and engine
  versions together. See
  [carrier-version-threading.md](./carrier-version-threading.md) for the
  full mechanism.
- The cleanest engine/front-end split: `packages/engine` owns everything
  both `cli` and `mcp` would otherwise duplicate, down to the shared
  `DistributionField` schema.
- **The only one of the three that builds out the optional app-layer and
  config-schema extension**: core owns the config Schema, its version and
  its published `HostedSchema` identity; the engine owns the platform
  layer and config discovery; `App`/`AppStore`/`AppCache` are excluded
  unless a tool needs persisted state. See
  [carrier-app-and-schemas.md](./carrier-app-and-schemas.md).
- The MCP crash-guard convention is documented in the module's own doc
  comment, not just tribal knowledge
  (<https://github.com/spencerbeggs/okfit/blob/main/packages/mcp/src/main.ts>).
- **What the kit now ships in its place:** the hand-rolled `Distribution`
  `Context.Reference` is `@effected/engine`'s `CurrentDistribution` — see
  [carrier-version-threading.md](./carrier-version-threading.md).

Gaps:

- **No manifest DAG test.** Nothing in the repository currently asserts
  the core→profiles→engine→front-ends→carrier edges programmatically —
  the shape is real but unverified by a test, unlike systems and
  vitest-agent (see [carrier-verification.md](./carrier-verification.md)).
- The plugin loader's `npx` fallback is **unpinned**
  (`npx --yes @okfit/mcp`, `npx --yes @okfit/lsp`) — see
  [carrier-plugin-loader.md](./carrier-plugin-loader.md) for why that is
  latent skew rather than a stylistic choice.

## vitest-agent — ranked layering, multi-PM e2e, no LSP

Repository: <https://github.com/spencerbeggs/vitest-agent>

```text
sdk (rank 1)
-> ui, sidecar-* (per-platform SEA binaries via optionalDependencies) (rank 2)
-> engine, reporter, sidecar (rank 3)
-> cli, mcp (rank 4)
-> plugin (rank 5, carrier AND the Vitest plugin library)
```

Two independent chains run through this graph rather than one straight
line: a **render** chain (`plugin -> reporter -> ui -> sdk`) and a **data**
chain (`plugin -> {cli, mcp} -> engine -> sdk`).

What it does best:

- **The only one of the three with a ranked layering test** —
  `LAYER_RANKS` as an explicit lookup table, asserted against the live
  workspace graph directly in TypeScript rather than a separate config
  file (<https://github.com/spencerbeggs/vitest-agent/blob/main/packages/plugin/__test__/workspace-layering.test.ts>).
- **The only one of the three with the packed-install e2e run across all
  four package managers** (npm, pnpm, yarn, bun), including the JSON-RPC
  `initialize` / empty-stderr assertion that proves the MCP crash-guard
  contract end to end
  (<https://github.com/spencerbeggs/vitest-agent/blob/main/packages/plugin/__test__/bins-packed-install.e2e.test.ts>).
- **Its plugin loader is the only one with a major-pinned `npx` fallback**
  (`npx --yes @vitest-agent/mcp@4`) — see
  [carrier-plugin-loader.md](./carrier-plugin-loader.md).
- `@vitest-agent/plugin` is the carrier **and** a library — it is the
  actual Vitest plugin a consumer's `vitest.config` imports, while also
  carrying the CLI and MCP bin shims. This is the carrier-as-library
  deviation from [carrier-package.md](./carrier-package.md), applied
  cleanly: the plugin's own library surface never imports a front end
  directly, only its bin shims do.
- **What the kit now ships in its place:** the hand-rolled
  `register-toolkit.ts` port (strict-by-default registration, naming every
  unknown key) is `@effected/mcp`'s `McpToolkit` — see `effect-v4-mcp`'s
  [tools.md](../../effect-v4-mcp/references/tools.md#strict-input).

Gaps and notable deviations:

- **No LSP front end at all** — only `cli` and `mcp`.
- **No version threading** — no `Distribution` equivalent anywhere in the
  graph. A lockstep runtime-version-drift check was built and then
  removed after producing false positives; no replacement exists.
- **A runtime coupling with no manifest edge.** The MCP server's
  `run_tests` tool loads a consumer's `vitest.config`, which in turn
  reaches plugin code — real coupling, but expressed through a shared
  `Symbol.for()` process-global slot rather than an import, specifically
  *because* an import back-edge (`mcp` importing `plugin`, when `plugin`
  already depends on `mcp`) would be a same-layer/reverse-layer cycle:

  ```ts
  const DISCOVERY_LAST_SCAN_SYMBOL = Symbol.for("vitest-agent:discovery:last-scan-at");
  ```

  (<https://github.com/spencerbeggs/vitest-agent/blob/main/packages/mcp/src/tools/run-tests.ts>,
  <https://github.com/spencerbeggs/vitest-agent/blob/main/packages/plugin/src/utils/discover-projects.ts>)

  This is real coupling the manifest DAG test cannot see, by construction
  — worth knowing as a limit of that verification layer, not a flaw in
  this particular use of it.

## systems (Silk) — layer-skipping carrier, non-vacuity DAG test, PM-dispatch hooks

Repository: <https://github.com/savvy-web/systems>

```text
silk-core (L1) -> silk-effects (L2, engine; re-exports core)
-> {cli, mcp, changelog} (L3) -> silk (L4, carrier + config shims)
```

The carrier (`silk`) depends directly on `silk-effects`, **skipping** the
L3 front-end layer — an allowed deviation as long as every edge still
points strictly downward, which this one does (L4 → L2 is still a lower
layer than L4, just not the adjacent one).

What it does best:

- **The most rigorous manifest DAG test of the three**, with explicit
  non-vacuity controls (declared-names-were-discovered, edges-were-found,
  known-load-bearing-edges-are-present) and two **positive-control**
  fixtures — a hand-built sideways edge and a hand-built 3-node cycle —
  that the checker must reject. See
  [carrier-verification.md](./carrier-verification.md) for the exact
  assertions.
- A documented host-adapter carve-out for its `process`-read boundary
  test: the engine (`silk-effects`) allows `process` reads, but **only**
  inside two specifically named directories — `lint/` and `commitlint/` —
  because those are entry points invoked *by* foreign host processes
  (lint-staged, commitlint) that must read `process` themselves to
  function. The test pins the carve-out to exactly those two directory
  names, with no per-file allowlist beyond that, and carries its own
  positive control asserting the carve-out is exactly `lint/` and
  `commitlint/`
  (<https://github.com/savvy-web/systems/blob/main/packages/silk-effects/__test__/boundaries.test.ts>).
  This is a **weaker** boundary than okfit's engine, which allows `process`
  in exactly zero files — worth naming as a deliberate trade-off for a
  package with real host-adapter entry points, not an oversight.
- **What the kit now ships in its place:** the hand-rolled `layers.json` +
  non-vacuity DAG test is `@effected/workspaces/testing`'s `LayerPolicy` +
  `WorkspaceLayering`, which already carries the five offence reasons and
  the `edgeCount > 0` guard this suite hand-built — see
  [carrier-verification.md](./carrier-verification.md).

Gaps and deviations:

- **`savvy --version` reports the carrier's own CLI version**, with no
  distribution threading at all — see
  [carrier-version-threading.md](./carrier-version-threading.md).
- **The plugin loader's `npx` fallback is unpinned**
  (`npx --yes @savvy-web/mcp`) — the same gap as okfit.
- **Hooks contradict the loader's own discipline.** The MCP/LSP loader
  scripts never dispatch through a package manager, but the hook library
  (`hooks/lib/run-cli.sh`) detects the package manager and returns a
  dispatch prefix (`pnpm exec` / `yarn exec` / `bunx` / `npx --no --`) for
  every hook call site to prepend — exactly the anti-pattern the loader
  itself avoids. Name this explicitly when reviewing systems' hooks: it is
  not a stylistic difference from the loader, it is the pattern's own
  documented anti-pattern, present in the same repository that also
  demonstrates avoiding it. See
  [carrier-plugin-loader.md](./carrier-plugin-loader.md).
- **`changelog` is a dependency nothing imports, and it is still
  hoisted.** `silk`'s `package.json` declares `"@savvy-web/changelog":
  "workspace:*"` in `dependencies`, but no file under `silk/src` imports
  it by name — it is resolved by id, at runtime, by the changesets engine
  itself rather than through a static import. This is the
  load-bearing-unimported-dependency shape from
  [carrier-package.md](./carrier-package.md), just triggered by a
  different mechanism (a tool resolving a package by name at runtime)
  than the usual peer-satisfaction case.

## What to take from all three together

No single repository is the complete reference — read the prescriptive
files in this skill as the composite of what all three got right, and use
this file to go straight to whichever repository actually built the piece
you need. The one property all three share, and the one worth keeping
above all the individual pieces: **the graph stays acyclic, and the
carrier is the only thing a consumer ever installs.**
