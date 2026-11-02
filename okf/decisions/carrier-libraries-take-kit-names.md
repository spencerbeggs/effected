---
type: Decision
title: The carrier libraries take -kit names, with no shim
description: "@effected/cli, @effected/mcp and @effected/engine are renamed @effected/cli-kit, @effected/mcp-kit and @effected/kit so the freed names can be the effected tool's own packages; the renamed packages continue their version lines, no compatibility shim is published, and @effected/app keeps its name because it is the application control plane, not a front-end carrier library."
status: stable
tags:
  - architecture
  - release
  - compat
sources:
  - id: design
    resource: ../../docs/superpowers/specs/2026-11-02-effected-plugin-design.md
    title: "The rename section"
  - id: issue-1223
    resource: https://github.com/spencerbeggs/effected/issues/1223
    title: "This branch's slice of 1147"
  - id: ledger-0048
    resource: ../../plugin/skills/effected-renovate/references/ledger
    title: "The breaking ledger entry that tells consumers what to change"
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-02T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T16:44:32Z
integrity:
  generated:
    body: a2ff22bdf2517c9c
  verified:
    by: human:spencer
    at: 2026-11-02T17:04:46Z
    content: 190eb864f16bac73
verified:
  - by: human:spencer
    at: 2026-11-02T17:04:46Z
---

# The carrier libraries take -kit names, with no shim

## Context

With a downloadable `effected` command and `effected-mcp` server, libraries named `@effected/cli`, `@effected/mcp` and `@effected/engine` read as the tool itself, and the tool needs those names (see [one tool beside the libraries](one-tool-beside-the-libraries.md)).

## Decision

The three front-end carrier libraries move: `@effected/cli` to [`@effected/cli-kit`](../modules/cli-kit.md), `@effected/mcp` to [`@effected/mcp-kit`](../modules/mcp-kit.md), `@effected/engine` to [`@effected/kit`](../modules/kit.md). The `-kit` suffix marks the front-end carrier family: the primitives a tool's front ends are built from.

- **No shim.** The old names are not republished as forwarding packages; the freed names belong to the tool's packages. The owner accepts the break: the kit works toward 1.0.0 and its consumers are the owner's own repositories. A consumer's install still succeeds, because the old names stay in the `effected` catalog as the new tool packages, and the stale imports then fail at build, where the upgrade ledger's breaking entry finds them by their import specifiers.
- **Version lines continue.** The `-kit` packages carry on the old numbers, so thresholds in existing ledger entries keep their meaning. npm never reuses a version, so the tool packages that reuse the old names start above the old lines.
- **`@effected/app` keeps its name.** It is the application control plane (XDG, config file, store, cache), not part of the carrier family the suffix marks, and nothing collides with it.
- **The silent-resolution trap.** A consumer still writing `"@effected/cli": "catalog:effected"` after the upgrade resolves the new tool package instead of the kit library, with no install error. The ledger entry exists to catch it.
- **The old ranges are deprecated** on npm after the release, with a message naming the `-kit` package; the owner runs `npm deprecate`.

## Alternatives rejected

- **Give the tool other names** (`@effected/effected`, `@effected/tool-*`). Rejected by the owner: the okfit shape (`cli`, `mcp`, `engine`, `plugin`) is the one consumers already know.
- **Publish forwarding shims under the old names.** Rejected: the names are needed for the tool, so a shim would collide with it.
- **Rename `@effected/app` too.** Rejected: it is not a carrier library and collides with nothing.
