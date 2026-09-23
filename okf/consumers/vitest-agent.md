---
type: Consumer
title: spencerbeggs/vitest-agent
description: The Vitest MCP server and plugin library — a carrier repo that is also the Vitest plugin it ships, with a native sidecar family and a multi-package-manager packed-install e2e.
repository: spencerbeggs/vitest-agent
status: stable
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:36:08Z
  body_sha256: b71f97b7d8ffd1e09eaf8eb7e0f34ab0325e04f85be0146fbd862806bdb0fb8c
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

- `@effected/app` — `AppDirs`, bound once to a `const` layer
  (`packages/engine/src/layers/PathResolutionLive.ts`) so the layer
  memoizes by reference, and read again in
  `packages/engine/src/utils/resolve-data-path.ts` for XDG-namespaced data
  paths.
- `@effected/xdg` — the `Xdg` layer `AppDirs` is provided over.
- [`@effected/schemastore`](../modules/schemastore.md) — the report schema
  its MCP tool results validate against.

## Open questions

- `process.exit` inside handlers — skips finalizers and uses ad-hoc exit
  codes 4 and 5, rather than routing through a kit `CliExit` primitive.
- No `CliLogger` / `reportFailures` — its CLI entry point reports failures
  by hand rather than through `CliRuntime.main`.
- `spawnSync` e2e throws on non-zero exit — its packed-install e2e cannot
  express "ran and failed as expected" the way a future `CliTest` would.
- Its two independent ports of `registerToolkit` — duplicated MCP toolkit
  registration logic that a shared `@effected/mcp` primitive would
  collapse (phase 2).
- `npm pack --json` read as an array — breaks under npm 12, which reports
  the same shape keyed by name rather than as an array; a phase 3 finding
  the kit's own `PackagePublish` already handles both shapes for.
