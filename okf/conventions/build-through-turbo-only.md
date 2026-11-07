---
type: Convention
title: Build through turbo
description: "Build with `pnpm build --filter <pkg>`, which runs `effected package build` through turbo after the typecheck; a direct run is allowed but skips the typecheck gate and the cache."
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - ci
sources:
  - id: turbo-json
    resource: ../../turbo.json
  - id: root-package-json
    resource: ../../package.json
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T20:01:27Z
integrity:
  generated:
    body: 1f7ff8f1a79e035f
---

# Build through turbo

Build a package with `pnpm build --filter <pkg>`. Turbo runs the package's `types:check`, chained over its workspace dependencies, and then `effected package build`.[^turbo-json][^root-package-json]

Running `effected package build` directly in a package directory is allowed, and it produces the same artifacts. It skips the typecheck gate and turbo's cache, so a type error goes unreported and the result is not a gate.

`build` has no `^build`: workspace links resolve to each sibling's source, so no sibling is built first.

`@effected/plugin` is a root devDependency and must never be a package's dependency. It carries the `effected` bin, and a package dependency would ship a build tool inside the published package.

A turbo cache hit replays the previous run's output and log verbatim. See [the matching gotcha](../gotchas/turbo-cache-hit-replays-clean-log.md) for the two checks that tell a genuine build from a replay.

[^turbo-json]: `turbo.json`: `build` has `dependsOn: ["types:check"]`, and `types:check` has `dependsOn: ["^types:check"]`.
[^root-package-json]: `package.json`: `"build": "turbo run build --filter=!docs --log-order=grouped --log-prefix=none"`.
