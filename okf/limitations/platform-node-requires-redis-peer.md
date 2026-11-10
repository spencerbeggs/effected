---
type: Limitation
title: "@effect/platform-node declares redis as a required peer, so every kit package on it brings redis along"
description: "@effect/platform-node 4.x declares redis as a required peerDependency for its NodeRedis module. Every kit package that depends on platform-node (bundler, engine, cli, mcp, plugin, github-actions) therefore leaves redis unmet. Under pnpm's default autoInstallPeers a consumer's install silently adds redis and five @redis/* packages; under strictPeerDependencies it fails without them. Upstream ruled it intentional in Effect-TS/effect#8554. The kit imports only platform-node subpaths, a rule a root test enforces, so NodeRedis never loads, and the kit declares no redis and sets no ignoreMissing for it."
status: draft
bounds: ../conventions/peer-dependency-discipline.md
tags:
  - deps
  - compat
sources:
  - id: issue-8554
    resource: https://github.com/Effect-TS/effect/issues/8554
    title: "@effect/platform-node: root imports require redis even for non-Redis APIs"
  - id: platform-node-manifest
    resource: "@effect/platform-node@4.1.2 packages/platform/node/package.json:72-75, src/NodeRedis.ts:22, src/index.ts:108"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-10T01:56:33Z
integrity:
  generated:
    body: 5bf6391e8a198c5f
---

# @effect/platform-node declares redis as a required peer, so every kit package on it brings redis along

## What happens

`@effect/platform-node` declares `redis` as a **required** peer, with no `peerDependenciesMeta` entry. The only module that imports it is `NodeRedis`, but the package root re-exports `NodeRedis`.[^platform-node-manifest] Every kit package that depends on `@effect/platform-node` passes the obligation to its consumer: `@effected/bundler`, `engine`, `cli`, `mcp` and `plugin`, and `@effected/github-actions` through its platform-node peer.

- **Under pnpm's defaults** (`autoInstallPeers: true`) a consumer's install silently adds `redis` and five `@redis/*` packages that nothing loads.
- **Under `autoInstallPeers: false` with `strictPeerDependencies: true`**, the install fails until the consumer installs `redis`, even though the kit never loads it.
- **A root import of `@effect/platform-node` without `redis` installed** fails with `ERR_MODULE_NOT_FOUND`. A subpath import such as `@effect/platform-node/NodeRuntime` does not.

## Why it stays

Upstream ruled the peer intentional and closed the report as not planned: Node, Bun and Deno each recommend a different Redis client, so the client belongs to the platform package, and Effect will not split Redis into a package of its own.[^issue-8554] Their advice is to avoid the barrel import.

## What the kit does about it

- **The kit imports only `@effect/platform-node` subpaths**, so `NodeRedis` never loads in any kit package, and its docs and the plugin's skills teach the same. `__test__/platform-subpath-imports.test.ts` at the repo root holds this: it scans the tracked code, tests, scripts, TSDoc and plugin text for a root import of `@effect/platform-node` or `@effect/platform-bun` (static, dynamic or `require`), with a positive control, and fails naming each file and line. A new root import would break consumers that have no `redis`; import a subpath instead.
- **The kit declares no `redis`, as a dependency or as a peer.** That would make every consumer install a database client the kit does not use.
- **The pnpm plugin sets no `peerDependencyRules.ignoreMissing: ["redis"]`.** That would also hide the missing peer from a consumer who imports the platform-node root themselves, and turn their install-time failure into a runtime one.
- **A strict consumer** either installs `redis` or adds `ignoreMissing: ["redis"]` to its own `peerDependencyRules`, knowing it imports no platform-node root.

The 2026-11-10 peer-closure audit found this as the only unmet required peer across the kit's publishable packages.

[^issue-8554]: <https://github.com/Effect-TS/effect/issues/8554>, closed 2026-09-28 as not planned.
[^platform-node-manifest]: `@effect/platform-node` 4.1.2 (and 4.0.7): `package.json:72-75`, `src/NodeRedis.ts:22`, `src/index.ts:108`.
