---
type: Limitation
title: bun below 1.4.4 hoists api-extractor's typescript over the tool's peer
description: A consumer installing @effected/plugin with bun 1.4.3 or older gets typescript 6.0.3 hoisted from @microsoft/api-extractor over the tool's typescript peer range, so effected-mcp and effected package build fail at startup while --version still works; declare typescript directly or use bun 1.4.4 or newer.
status: stable
stale_after: "2027-05-07T00:00:00Z"
bounds: ../interfaces/build-commands.md
tags:
  - compat
  - deps
generated:
  by: "claude-code/fable-5.1"
  at: 2026-11-07T02:00:52Z
integrity:
  generated:
    body: fd1812c033d52303
---

# bun below 1.4.4 hoists api-extractor's typescript over the tool's peer

## Condition

A consumer installs `@effected/plugin` (or `@effected/cli`, `@effected/mcp`,
`@effected/bundler`) with bun 1.4.3 or older and declares no `typescript` of
its own. The tool packages peer on `typescript` at
`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, while `@microsoft/api-extractor`,
a regular dependency of `@effected/bundler`, pins `typescript@6.0.3` exactly.

## Symptom

bun 1.4.3 and older hoist the exact `6.0.3` to the consumer's root
`node_modules/typescript` and only warn about the unsatisfied peer. At
runtime `@effected/bundler`'s declaration pass imports `typescript/ast`,
which TypeScript 6 does not ship, so `effected-mcp` fails at startup with
`ERR_MODULE_NOT_FOUND` on `node_modules/typescript/ast` and
`effected package build` fails the same way. `effected --version` still
works, because the version path never reaches the bundler, which makes a
broken install look healthy until the first build.

bun 1.4.4 resolves the peer range to its own install and the problem is
gone. npm, pnpm and yarn never showed it, which is why CI (npm and pnpm
only) does not catch it. The kit's own packed-install e2e fails on the bun
leg under a 1.4.2 binary and passes under 1.4.4 on the same tree.

## Why it is acceptable

The hoist is the package manager's resolution choice against a declared
peer, not a kit defect, and the fix on the consumer's side is one line:
declare `typescript` directly in the consumer's manifest at a version the
peer range admits, or use bun 1.4.4 or newer. The
[package-manager support policy](../conventions/package-manager-support-policy.md)
covers the current major and one back per manager, which bun 1.4.4 within
the 1.x line satisfies.

## What a fix would take

Pinning `typescript` as a regular dependency of `@effected/bundler` would
remove the hoist on every manager, at the cost of shipping a second
TypeScript copy beside the consumer's own and of tying the tool's
TypeScript to the kit's release cadence. That trade is deferred until a
second manager shows the same resolution.
