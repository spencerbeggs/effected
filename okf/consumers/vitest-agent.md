---
type: Consumer
title: spencerbeggs/vitest-agent
description: The Vitest MCP server and plugin library — a carrier repo that is also the Vitest plugin it ships, with a native sidecar family and a multi-package-manager packed-install e2e.
repository: spencerbeggs/vitest-agent
status: stable
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:18:02Z
  body_sha256: ac6fabcae16f470f1e61dbb698811a17b594d3fa4d83952c90a909a8d203bea6
---

# spencerbeggs/vitest-agent

`spencerbeggs/vitest-agent` is an MCP server that serves a project's test
landscape — run results, failure detail, coverage, flakiness, and the TDD
lifecycle — to LLM coding agents. Verified against the checkout at
`/Users/spencer/workspaces/spencerbeggs/vitest-agent`, 2026-09-23.

It is a carrier (`@vitest-agent/plugin`, versioning the Claude Code
integration) that is *also* the Vitest plugin library it ships: `cli`,
`engine`, `mcp`, `plugin`, `reporter`, `sdk`, and `ui` sit beside a native
sidecar family (`sidecar`, `sidecar-darwin-arm64`, `sidecar-linux-arm64`,
`sidecar-linux-x64`, `sidecar-win32-x64`) — platform-specific binaries the
carrier pattern elsewhere in this register does not need to account for.
It holds itself to a ranked layering test over its own package graph, and
its packed-install e2e drives multiple package managers against a real
tarball rather than a workspace link.

## What it exercises

- `@effected/xdg` — `AppDirs`, bound once to a `const` layer
  (`packages/engine/src/layers/PathResolutionLive.ts`) so the layer
  memoizes by reference, over the `Xdg` layer it is provided over, and
  read again in `packages/engine/src/utils/resolve-data-path.ts` for
  XDG-namespaced data paths.
- [`@effected/schemastore`](../modules/schemastore.md) — the report schema
  its MCP tool results validate against.
- [`@effected/cli`](../modules/cli.md)'s live view, behind the optional peers
  `ink` and `react`: the reporter's live run view is `CliUi.live` over a
  `PubSub` subscription passed as `events`, with `close` as the lossless end
  (`packages/reporter/src/liveView.ts`), drawn through `UiProvider` and
  `DocView` so a `Doc` document is the same rows in a static report and in the
  live frame. `UiProvider` takes its value from `CliUi.context`.
- `CliRuntime.main` with `env` for its CLI entry point, reporting failures
  through `details.lines({ status: false })` under its own `vitest-agent:`
  prefix and `env.displayPath` relative to the project directory, in place
  of reporting by hand.
- The document IR for the report: `Doc.countsTable` for the per-project totals
  (a `labelHeader`, a `durationHeader` and a `Doc.strong` total row), `Doc.list`,
  `Doc.verbatim`, `Doc.line` with `truncate` and `Doc.diffText` for a failure,
  `Render.contextOf` for a pure context outside Effect, and `CliLog` for
  diagnostics, with `format: "auto"` and `argv: process.argv.slice(2)` so an
  audience flag decides NDJSON or plain.
- [`@effected/env`](../modules/env.md)'s `EnvOverride.readResult`, which
  reads its console-mode override variable without logging, so the host owns
  the warning's wording and stream.
- The tests: `CliUiTest.live` (every live-view behaviour is pinned against it)
  and `CliUiTest.view` for a display-only element such as a status icon.

## Open questions

- `process.exit` inside handlers — skips finalizers and uses ad-hoc exit
  codes 4 and 5, rather than routing through a kit `CliExit` primitive.
- `spawnSync` e2e throws on non-zero exit — its packed-install e2e cannot
  express "ran and failed as expected" the way a future `CliTest` would.
- Its two independent ports of `registerToolkit` — duplicated MCP toolkit
  registration logic that a shared `@effected/mcp` primitive would
  collapse (phase 2).
- `Glyphs.ascii` has no pass, fail or skip marks of its own, so the reporter
  draws those itself and a `TERM=dumb` assertion about kit glyphs needs a
  control to mean anything.
- `npm pack --json` read as an array — breaks under npm 12, which reports
  the same shape keyed by name rather than as an array; a phase 3 finding
  the kit's own `PackagePublish` already handles both shapes for.
