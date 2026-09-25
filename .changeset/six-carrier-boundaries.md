---
"@effected/workspaces": minor
---

## Features

- `SourceBoundary` gains a `{ forbidTokens }` rule: forbid an exact piece of
  text wherever it appears in code (comments, strings, template text and
  regex bodies are blanked first), and confine it to named files with the
  matching `allowRules.forbidTokens` glob — the house pattern for something
  like `process.env.__PACKAGE_VERSION__`, which is forbidden everywhere
  except `version.ts`.

- `PackedInstall` gains a set of primitives for exercising an installed
  consumer's own bins and dependency closure:
  - `InstalledConsumer.runBin` runs an installed bin to completion and
    collects its output; `InstalledConsumer.command` builds the same
    command for a caller that wants to drive the child itself (an
    `McpProbe`, say).
  - `InstalledConsumer.carrierCommand` / `runCarrierBin` resolve and run the
    carrier's own bin script directly through `node`, whichever package won
    the `node_modules/.bin` slot — the tool for proving the carrier's own
    shim works when bins are shared.
  - `InstalledConsumer.binProvenance` reports which installed package a
    `node_modules/.bin` symlink actually resolves into.
  - `PackedInstallResult.scratch` is the scratch root holding the tarballs
    and every consumer, removed when the run's scope closes.
  - `PackedInstall.closure(carrier, options)` returns the packages a run
    would pack, in order, without packing anything, and
    `PackedInstall.timeoutBudget` / `timeoutBudgetFor` size a test's timeout
    from a run's managers, packages and per-consumer work (one bin run's
    minute unless the test says otherwise).
  - `overrides` and `workspaceOverrides` steer a scratch consumer's
    dependency resolution to a local directory or tarball outside the
    workspace — the dogfood case, where a closure member needs a sibling
    checkout's unreleased build.
  - `packTimeout` bounds each package's `npm pack`, alongside the existing
    `installTimeout`.

- `PackedInstallOptions.bins` now fails the run before any install with a
  new `BinConflict` error when a packed package other than the carrier
  declares one of the carrier's own bin names — under a flat layout (npm,
  bun, Yarn's `node-modules` linker) either package can take the `.bin`
  slot, so an unflagged conflict lets a check or a bin run silently pass on
  the wrong package. Set `allowSharedBins: true` to allow it explicitly, for
  a carrier whose front ends declare the carrier's bin names on purpose.

## Breaking Changes

- `PackedInstallResult.scratch` is a new **required** field. A hand-built
  `PackedInstallResult` — a test double standing in for a run — must now
  supply it.
- `InstalledConsumer.runBin` applies `options.env` **after** the install's
  scrubbed environment, not before, so an explicit entry there always wins
  over the scrub.
- `BinConflict` is checked by default. A closure member or `overrides`
  package that declares one of the carrier's own bin names now fails the
  run unless `allowSharedBins: true` is set.
