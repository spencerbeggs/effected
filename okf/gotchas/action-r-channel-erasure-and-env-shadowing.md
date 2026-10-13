---
type: Gotcha
title: An `as never` cast and a second process.env read both compile clean and fail at runtime
description: Casting an unclosed R channel to never, and reading process.env outside ActionEnvironment, both typecheck and pass review — the failure surfaces only at run time, and only when the omitted layer or the shadowed variable actually matters.
status: stable
resource: ../../packages/github-actions/src/ActionEnvironment.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 889d84e7905c0f6c
---

# An `as never` cast and a second process.env read both compile clean and fail at runtime

## What a reader sees

A production entry point's `R` channel is coerced with `as never` to
satisfy `Effect.runPromise`'s zero-argument requirement, or a step reads
`process.env.GITHUB_SHA` directly instead of through
`ActionEnvironment`, sitting next to another read of the same variable
elsewhere in the codebase with a different fallback.

## What they would wrongly conclude

That both are harmless local shortcuts, since the build is clean, the
suite is green, and the cast or the direct read type-checks without
complaint.

## What is actually true

An `as never` cast on the `R` channel silences the compiler's proof that
every dependency the program needs is actually provided — a dropped
layer becomes a runtime failure at the first call site that needed it,
exactly where the type system exists to catch it at compile time instead.
Reading `process.env` outside the one designated environment authority
similarly compiles fine while creating a second source of truth: one real
incident found duplicate `GITHUB_SHA` reads with divergent fallback
values, so which fallback wins depended on which code path ran first, not
on anything visible in either read site.

## The check

Never cast the `R` channel to `never` — a production entry point should be
zero-arg by construction because every dependency is genuinely closed,
not because the type system was told to stop checking. Route every
runner-environment read through `ActionEnvironment` rather than a direct
`process.env` access, so there is exactly one place a variable's name and
fallback are decided, and grep for direct `process.env` reads outside it
as part of any review.
