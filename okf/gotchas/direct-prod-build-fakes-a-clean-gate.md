---
type: Gotcha
title: Running the bundler script directly fakes a clean build gate
description: "node savvy.build.ts --target prod skips build:dev, emits no .d.ts, and leaves a truncated issues.json shaped exactly like a passing gate."
status: stable
resource: ../../turbo.json
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: d00b4e5b5cc9f85bb28ffd6d358bb1ae9e4ff11c75f128b664669686d3f0ecb2
---

# Running the bundler script directly fakes a clean build gate

## What a reader sees

Running `node savvy.build.ts --target prod` inside a package directory
completes without error and produces a `dist/prod/issues.json` — the same
file turbo's `build:prod` task produces, with a `suppressed:` count that
can read as zero, which is the shape of a genuinely clean gate.[^turbo-json]

## What they wrongly conclude

That the package built and typechecked cleanly, because the file the gate
inspects exists and looks like every other passing run's output.

## What is actually true

The turbo task graph runs `build:prod` only after `types:check` and
`build:dev` have both succeeded — `build:prod` depends on them. Invoking
`savvy.build.ts --target prod` directly skips that dependency chain
entirely: it never runs `types:check`, so a real type error is never
caught, it never runs `build:dev`, so no `.d.ts` declarations are emitted
at all, and the `issues.json` it writes is truncated relative to what the
full pipeline produces — shaped exactly like a clean gate's output, with no
signal distinguishing it from a genuine pass.

## The check

Always build through `pnpm build --filter <pkg>`, which drives the turbo
task graph (`types:check` → `build:dev` → `build:prod`) rather than the
bundler script by name. If `dist/prod` exists without a corresponding
`dist/dev`, or without `.d.ts` files, the build did not go through the
real pipeline regardless of what `issues.json` reports.

[^turbo-json]: `turbo.json` — `build:prod`'s `dependsOn: ["types:check", "build:dev"]`
    is the dependency chain a direct `savvy.build.ts --target prod`
    invocation bypasses.
