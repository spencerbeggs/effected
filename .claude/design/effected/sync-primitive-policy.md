---
status: current
module: effected
category: architecture
created: 2026-07-20
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 92
related:
  - effect-standards.md
  - formatter-convention.md
  - packages/semver.md
  - packages/jsonc.md
  - packages/yaml.md
  - packages/toml.md
  - packages/glob.md
  - packages/markdown.md
  - packages/templates.md
  - packages/spdx.md
  - packages/config-file.md
---

# The sync primitive policy

## Overview

What shape a **pure** kit boundary exposes. It is one rule with a scope test and a naming rule, and it applies to every pure boundary in the kit — not only to the format packages where it was first noticed, which is why it has its own document rather than a section of [formatter-convention.md](formatter-convention.md).

**Pure computation exposes the sync form as the primitive; the `Effect` form is derived from it and adds only the tracing span.**

## Scope test

A surface is in scope when it is a public boundary that returns `Effect` with `R = never`, has no async step and does no IO — i.e. the `Effect` wrapper carries nothing but a span and the error channel.

For those, the `Effect` is a tax: it forces `Effect.runSync` on every synchronous consumer, and synchronous consumers are real. A lint-staged handler must be synchronous ([C1 of the formatter convention](formatter-convention.md#the-driving-constraint)), and so must a config file evaluated before any runtime exists.

Out of scope: anything that does IO, anything with an async step, and anything whose `Effect` is load-bearing for reasons other than the span — see [where the policy stops](#where-the-policy-stops).

## The derivation

```ts
static parseResult(text: string): Result.Result<A, E> { /* the engine */ }
static readonly parse = Effect.fn("X.parse")((text: string) =>
  Effect.fromResult(X.parseResult(text)),
);
```

Three properties make this cheap and safe. Adding the sync form is **purely additive** — the `Effect` signature is unchanged, so no consumer breaks. The span is **preserved**, so observability is not traded away. And the two forms **cannot drift**, because one is defined in terms of the other rather than re-deriving the engine.

The derivation direction is the load-bearing half. A package that ships both forms over two independent copies of the engine has satisfied the letter of the policy and none of its value: `@effected/yaml` shipped exactly that for a while, with the `Effect` path calling the composer, the failure records and the alias budget inline while the sync path called the same three independently. Fixing the derivation, not adding the surface, was the real work.

## Why it pays inside Effect too

The payoff is easiest to miss because it looks like a concession to non-Effect hosts. It is not. `@effected/github`'s `GitTag.latestSemver` is a single pass over the tag stream, filtering and comparing inside one `Effect.sync`, **because** `@effected/semver` ships `parseResult` and `compare` synchronously. With only the `Effect` forms available, the same operation was several times longer — one `Effect` per candidate comparison. A sync primitive on a pure boundary is what lets an effectful consumer keep its own loop flat.

## Naming: `*Result`, never `*Sync`

The sync form is spelled `*Result`. Three arguments, in ascending order of force:

1. **Precedent.** `*Result` is where the policy started and what the plugin skills name.
2. **Accuracy.** `Sync` names a distinction that does not exist — **the `Effect` form is also synchronous**, which is the entire premise of the policy. `Result` names the one thing that actually differs: the return type.
3. **`*Sync` is already taken in this kit, for an incompatible meaning.** `@effected/workspaces` ships a sync facade family (`findWorkspaceRootSync`, `getWorkspacePackagesSync`, `readPackageSync`) whose members are **genuinely IO-performing** functions returning nullables, not `Result`s. Within one kit `*Sync` would mean both "does blocking IO, returns a nullable" and "pure computation, returns a `Result`".

## Where the policy stops

**It applies to the engine, not to every adapter over it.**

`@effected/config-file`'s four codecs shape-match the policy and are deliberately exempt. They do not own their signature — they implement the `ConfigCodec` interface, whose `Effect` is not a span wrapper but the **polymorphism that makes the seam composable**: the error type is generic precisely so decorator codecs can wrap a codec, widen the error channel and return a codec. A sync twin would mean a parallel sync interface and a parallel decorator stack for every decorator.

And the synchronous host does not exist one level down: a codec is consumed by a config-loading pipeline hosted by an application at startup, already in `Effect` and already reading files through `FileSystem`. The sync pressure is real one level **up**, in the format packages, and that is exactly where the fix belongs.

The second stopping rule is **do not complete the pattern for its own sake.** `@effected/templates` gives only `parse` the `*Result` + `Effect` twin pair, because only `parse` is a public boundary a consumer would otherwise want as an `Effect`; its instance methods on an already-parsed document return `Result`/`Option`/a total value with no `Effect` twin, and adding twins would mint dead surface.

## Adopters

Every pure-tier format and grammar package in the kit is built on this policy, plus the pure cores of some boundary packages. `grep -rl parseResult packages/*/src` is the roster; each package's own doc names its primitives.

A **missing twin on an in-scope boundary is a review finding**, not a nice-to-have — the policy is also stated in the plugin's `effect-v4-observability` skill so a reviewer meets it without reading this document.
