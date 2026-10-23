---
type: Convention
title: Sync-primitive policy
description: A pure kit boundary exposes the sync form as its primitive; the Effect form is derived from it and adds only the tracing span.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T22:03:44Z
integrity:
  generated:
    body: fe52855b0c58ee10
---

# Sync-primitive policy

**Pure computation exposes the sync form as the primitive; the `Effect` form
is derived from it and adds only the tracing span.** This applies to every
pure boundary in the kit, not only the format packages where it was first
noticed — it is the generalized form of the [format-package
convention](format-package-convention.md)'s return-type decision.

## Scope test

A surface is in scope when it is a public boundary that returns `Effect` with
`R = never`, has no async step and does no IO — i.e. the `Effect` wrapper
carries nothing but a span and the error channel.

For those, the `Effect` is a tax: it forces `Effect.runSync` on every
synchronous consumer, and synchronous consumers are real. A lint-staged
handler must be synchronous, and so must a config file evaluated before any
runtime exists.

Out of scope: anything that does IO, anything with an async step, and
anything whose `Effect` is load-bearing for a reason other than the span —
see [where the policy stops](#where-the-policy-stops).

## The derivation

```ts
static parseResult(text: string): Result.Result<A, E> { /* the engine */ }
static readonly parse = Effect.fn("X.parse")((text: string) =>
  Effect.fromResult(X.parseResult(text)),
);
```

Three properties make this cheap and safe. Adding the sync form is purely
additive — the `Effect` signature is unchanged, so no consumer breaks. The
span is preserved, so observability is not traded away. And the two forms
cannot drift, because one is defined in terms of the other rather than
re-deriving the engine.

The derivation direction is the load-bearing half. A package that ships both
forms over two independent copies of the engine has satisfied the letter of
the policy and none of its value: `@effected/yaml` shipped exactly that for a
while, with the `Effect` path calling the composer, the failure records and
the alias budget inline while the sync path called the same three
independently. Fixing the derivation, not adding the surface, was the real
work.

## Why it pays inside Effect too

The payoff is easiest to miss because it looks like a concession to
non-Effect hosts. It is not. `@effected/github`'s `GitTag.latestSemver` is a
single pass over the tag stream, filtering and comparing inside one
`Effect.sync`, because `@effected/semver` ships `parseResult` and `compare`
synchronously. With only the `Effect` forms available, the same operation was
several times longer — one `Effect` per candidate comparison. A sync
primitive on a pure boundary is what lets an effectful consumer keep its own
loop flat.

## Naming: `*Result`, never `*Sync`

The sync form is spelled `*Result`, on three arguments in ascending order of
force:

1. **Precedent.** `*Result` is where the policy started and what the kit's
   own skills name.
2. **Accuracy.** `Sync` names a distinction that does not exist — the
   `Effect` form is also synchronous, which is the entire premise of the
   policy. `Result` names the one thing that actually differs: the return
   type.
3. **`*Sync` is already taken in this kit, for an incompatible meaning.**
   `@effected/workspaces` ships a sync facade family
   (`findWorkspaceRootSync`, `getWorkspacePackagesSync`, `readPackageSync`)
   whose members are genuinely IO-performing functions returning nullables,
   not `Result`s. Within one kit, `*Sync` would mean both "does blocking IO,
   returns a nullable" and "pure computation, returns a `Result`".

The rule holds even where the `Effect` twin is not merely a span.
`@effected/jsonc`'s `JsoncFingerprint.hash` requires core's `Crypto.Crypto`,
so its synchronous twin is not a free derivation — it takes the digest from
the caller — and the accuracy argument above does not strictly apply, since
the `Effect` form really is the effectful one. It is still spelled
`hashResult` (`packages/jsonc/src/JsoncFingerprint.ts:487`), on the
precedent and naming-collision arguments: `Result` is what the kit's readers
have been taught to look for, and `*Sync` would still collide with the
workspaces meaning. A sync twin that needs the caller to supply the platform
is named for its return type like every other one, and takes that platform
as an explicit argument rather than importing `node:*` — the
`TsconfigLoaderSyncOptions` shape
(`packages/tsconfig-json/src/TsconfigLoaderSync.ts:91`) is the worked
example: it carries a `SyncFileSystem` and `SyncPath` supplied by the caller
rather than reaching for `node:fs`/`node:path` itself.

See [sync-form-named-result](../decisions/sync-form-named-result.md) for the
naming decision's alternatives-rejected record.

## Where the policy stops

It applies to the engine, not to every adapter over it.

`@effected/config-file`'s four codecs shape-match the policy and are
deliberately exempt. They do not own their signature — they implement the
`ConfigCodec` interface, whose `Effect` is not a span wrapper but the
polymorphism that makes the seam composable: the error type is generic
precisely so decorator codecs can wrap a codec, widen the error channel and
return a codec. A sync twin would mean a parallel sync interface and a
parallel decorator stack for every decorator. And the synchronous host does
not exist one level down: a codec is consumed by a config-loading pipeline
hosted by an application at startup, already in `Effect` and already reading
files through `FileSystem`. The sync pressure is real one level up, in the
format packages, and that is exactly where the fix belongs.

The second stopping rule is: do not complete the pattern for its own sake.
`@effected/templates` gives only `parse` the `*Result` + `Effect` twin pair,
because only `parse` is a public boundary a consumer would otherwise want as
an `Effect`; its instance methods on an already-parsed document return
`Result`/`Option`/a total value with no `Effect` twin, and adding twins would
mint dead surface.

## Adopters

As of this writing, `grep -rl parseResult packages/*/src` names: `git`,
`github`, `github-actions`, `jsonc`, `jsonl`, `markdown`, `npm`,
`package-json`, `sbom`, `schemastore`, `semver`, `spdx`, `templates`, `toml`,
`workspaces` and `yaml`. Every pure-tier format and grammar package in the
kit is built on this policy, plus the pure cores of some boundary packages;
each package's own documentation names its own primitives.

A missing twin on an in-scope boundary is a review finding, not a
nice-to-have — the policy is also stated in the kit's own Effect
observability guidance so a reviewer meets it without reading this document.
