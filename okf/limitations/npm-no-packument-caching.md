---
type: Limitation
title: NpmRegistry does not cache repeated packument reads
description: Several NpmRegistry read paths fetch the same registry document more than once in a single program — most visibly the per-version read's 405 packument fallback — and nothing caches it; the fix is deferred until a consumer's call pattern demonstrates the cost rather than the redundancy alone.
status: stable
bounds: ../modules/npm.md
tags:
  - performance
sources:
  - id: npm-registry-source
    resource: ../../packages/npm/src/NpmRegistry.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5ff0da77a9939006
---

# NpmRegistry does not cache repeated packument reads

## The condition

`NpmRegistry` methods each read from the registry per call, keyed on
`(registry, package, version)` with no request-level or process-level
cache. Several call patterns then fetch the same document more than once:
the per-version read's fallback to the whole packument on a 405 makes an
existing redundancy one call site larger, since a caller reading several
versions of the same package now re-fetches the packument once per
version rather than once per package.

## The observable symptom

A program that reads multiple versions, or multiple fields, of the same
package pays a full HTTP round trip to the registry for each read, even
when the underlying document has not changed and was already fetched
moments earlier in the same run.

## Why it is acceptable

The fix is well understood and not blocked on any design question: a
core `Cache` keyed on registry and package name, with the failure and
absence TTL rules already established by the `@effected/commands` work.
What is missing is evidence that any real consumer's call pattern
actually pays for the redundancy rather than merely exhibiting it — the
package's evidence-gated posture defers the work until a named consumer
demonstrates the cost, rather than building caching speculatively ahead
of a need `packages/npm/src/NpmRegistry.ts`'s current callers have not
shown.[^npm-registry-source]

## What the fix would take

A `Cache` service keyed on `(registry, package)`, reusing the TTL and
failure-caching rules `@effected/commands` already established elsewhere
in the kit, wrapping `NpmRegistry`'s packument and per-version reads so a
repeated read inside one program's lifetime resolves from the cache
rather than re-fetching. The trigger to build it is a consumer's observed
call pattern showing the waste, not the redundancy existing in principle.

[^npm-registry-source]: `packages/npm/src/NpmRegistry.ts` — the read
    methods (`version`, `versions`, `distTags`, `publishTimes`) with no
    caching layer between them and core `HttpClient`.
