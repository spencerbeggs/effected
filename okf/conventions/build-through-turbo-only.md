---
type: Convention
title: Build through turbo, never by invoking the bundler script directly
description: "Always build with `pnpm build --filter <pkg>`, which drives turbo's full task graph, and never invoke a package's savvy.build.ts directly or list @savvy-web/bundler as a runtime dependency."
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
  at: 2026-09-14T02:44:47Z
  body_sha256: d3ba71f4783de297076dd1f9ac6ffae48c3b82915db19e69f8ce966f300cc036
---

# Build through turbo, never by invoking the bundler script directly

Always build a package with `pnpm build --filter <pkg>`, which drives
turbo's task graph (`types:check` → `build:dev` → `build:prod`,
transitively over `^build:dev` for upstream workspace
dependencies).[^turbo-json][^root-package-json] Never run `node savvy.build.ts --target prod`
directly — see [the gotcha this shortcut
produces](../gotchas/direct-prod-build-fakes-a-clean-gate.md) for the
truncated, clean-looking output it leaves behind.

`@savvy-web/bundler` is a `devDependency` of every package that builds, and
must never move into `dependencies`. It is what `savvy.build.ts`
imports to run the build; declaring it as a runtime dependency would ship a
build tool inside the published package rather than using it only to
produce that package's artifacts.

A turbo cache hit can replay a stale artifact's log verbatim — see [the
matching gotcha](../gotchas/turbo-cache-hit-replays-clean-log.md) for the
`generatedAt` check that distinguishes a genuine build from a replay.

[^turbo-json]: `turbo.json` — the `build:prod` task's
    `dependsOn: ["types:check", "build:dev"]`, and `build:dev`'s own
    `dependsOn: ["^build:dev"]` for upstream workspace dependencies.
[^root-package-json]: `package.json:22` — `"build": "turbo run build:dev
    build:prod --log-order=grouped --log-prefix=none"`.
