---
type: Convention
title: Require the consolidated core's contract in R; never re-implement or re-declare it
description: Effect v4 folded platform, rpc and cluster contracts into core; a library needing one requires the core service in R and lets the app provide the platform layer, and never builds its own backend for a contract core already declares.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
sources:
  - id: effect-process
    resource: ../../.repos/effect/packages/effect/src/process/ChildProcessSpawner.ts
  - id: effect-filesystem
    resource: ../../.repos/effect/packages/effect/src/FileSystem.ts
  - id: git-src
    resource: ../../packages/git/src
  - id: commands-src
    resource: ../../packages/commands/src
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 8d8d95fc2e7882368a878e457d3b0c89558f6188686eec7ddfa237ac7fc2f89a
---

# Require the consolidated core's contract in R; never re-implement or re-declare it

Effect v4 consolidated what were separate packages into `effect` core:
functionality that lived in `@effect/platform`, `@effect/rpc` and
`@effect/cluster` now lives directly inside `effect`, including the
service **contracts** for platform concerns — `FileSystem`,[^effect-filesystem]
`Path`, `Terminal`, `Stdio`, and `effect/process`'s
`ChildProcess` plus `ChildProcessSpawner`.[^effect-process] The packages
that remain separate are platform-specific, provider-specific or
technology-specific **implementations** of those contracts:
`@effect/platform-*` (for example `@effect/platform-node`'s
`NodeServices.layer`, which provides
`ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal` in
one layer), `@effect/sql-*`, `@effect/ai-*`, `@effect/opentelemetry`,
`@effect/atom-*` and `@effect/vitest`.

## The standing rule

This kit is in the business of business logic — schemas for data,
services for behaviour, layers that compose. It never re-implements
platform specifics. A library that needs a platform capability requires
the core-declared service in its `R` channel, and the application
provides the platform layer once at the edge. This is free under
[R3](dependency-policy.md#r3-tier-2-does-not-propagate) — it is how
`walker`, `xdg` and `config-file` consume `FileSystem` — and it is
categorically different from taking `@effect/platform-*` as a dependency
edge, which is what [R2](dependency-policy.md#r2-tier-3-propagates)
taxes. The two must not be conflated.

Three operating rules follow:

1. **Before designing any seam or contract, grep the vendored Effect
   source for the core contract first.** If core declares the service,
   require it in `R`; the seam already exists.
2. **A direct `node:` import in library code is a code smell, most of
   the time.** The sanctioned exceptions are documented Node-only
   overlays — a default layer or a sync escape hatch — never a contract
   or a business-logic path.
3. **Platform packages are legitimate devDependencies for integration
   tests, and legitimate dependencies only in applications and app-edge
   packages.**

## Two separate failure modes, not one

`@effected/commands` took two attempts to get right, because clearing
one failure mode does not clear the other:

- **Re-declaring a core concept.** The first design invented a
  `Command`/`CommandRunner` vocabulary for something core already
  declares. It survived several review gates because reviewers checked
  the code against the design brief instead of checking the brief
  against core.
- **Implementing a core concept.** The second design imported core's
  vocabulary faithfully and deleted every invented type — it passed the
  re-declaration check outright — and was still wrong, because it shipped
  a **backend** for a contract core already implements. A reviewer
  holding only "don't reinvent core" as a rule would have approved it.

The general form, and the invariant `@effected/commands` ships under:
every subprocess concept is core's, and no implementation of one is;
`@effected/commands`'s `Run` and `ToolDiscovery` require core's
`ChildProcessSpawner` in `R` rather than owning a spawn
backend.[^commands-src] `@effected/git` is the same invariant from the
consuming end — it simply requires the core `ChildProcessSpawner` in
`R`.[^git-src]

## Core owning a primitive is not the same as core's primitive fitting

The rule above answers *does core declare this?* It does not answer the
question that actually decides a call site: does core's version have the
shape this site needs? A sweep of the kit against the vendored core, for
hand-rolled re-rolls of the late-landing modules (`Crypto`, `Encoding`,
`Graph`, `encoding/Toml`/`Yaml`), found most candidates already
adopted and every remaining one kept for a shape mismatch rather than
inertia. The mismatches recur in five shapes, each invisible from the
module name alone and each cheap to miss:

1. **A sync call site against an `Effect` primitive.** `Crypto.digest`
   returns an `Effect` requiring `Crypto` in `R`; a sync function or a
   module-level constant cannot call it without becoming effectful or
   acquiring a runtime, which is a public-surface change to buy a
   dependency removal.
2. **A streaming site against a one-shot primitive.** `Crypto.digest`
   takes the whole payload with no `update`/`digest` accumulator, so
   hashing a stream through it means buffering the stream — fine for a
   key or a short manifest, wrong for an artifact of unbounded size.
3. **A canonical value against a lenient codec.** Core's base64 decoder
   maps several textual spellings onto identical bytes and strips
   embedded CRLF while rejecting an unpadded form some grammars allow.
   Where a value's text is load-bearing — an integrity hash, a signature,
   a cache key — a decoder that accepts synonyms is not a drop-in for one
   that denies them, and encoding is unaffected by the same argument
   because core's encoders emit the canonical spelling either way.
4. **A typed error channel against a throwing API.** Core's `Graph`
   traversals throw a `GraphError` on a cycle, arriving as a defect
   outside the declared error channel rather than a typed failure — a
   reason to adopt the module only where the throw is unreachable or the
   payload does not matter, not a reason to avoid it outright.
5. **A superset against a subset.** Core's `encoding/Toml` and
   `encoding/Yaml` export a single `parse`. The kit's
   `@effected/toml` and `@effected/yaml` are strict supersets — parse,
   edit, format, comment fidelity — so a same-named core module is not
   evidence of duplication, and there is nothing to fold in.

Absence is its own answer and the cheapest one to check first: core's
`Crypto` has no HMAC, no signing, no key derivation and no cipher, so an
AWS SigV4 signer or a PBKDF2 + AES-GCM envelope is not a migration
candidate at all — it is `node:crypto` or WebCrypto `subtle` under
operating rule 2's overlay exception, decided before the tier and peer
decisions are made rather than discovered mid-implementation.

Two standing rules come out of the sweep. **Probe the shape, do not read
the name** — every judgement above came from running the primitive
against the call site's actual inputs, and three of the five shapes are
undetectable from a signature alone. And **record the verdict at the
site, in both directions** — an adoption and a considered keep are
equally worth a comment naming the core module, the version probed and
the deciding fact, because otherwise the next audit re-runs the probe and
the one after that "fixes" the keep.

## The vendored source is the style oracle, not just the API authority

The vendored `effect` source settles more than existence and signatures:
it is the paradigm reference. Core source is written with one concept per
module and a consistent `@since`-annotated public surface, contracts
shaped as `Context.Service` classes with a `make` that derives the rich
surface from one primitive (`ChildProcessSpawner.make(spawn)`), branded
scalars for domain numbers (`ExitCode`, `ProcessId`), `dual`
data-first/data-last combinators, values that are themselves `Effect`s
where yielding is the natural verb, and doc-comment examples that
compile.[^effect-process] When designing a kit module, read how core
writes the analogous module and match its paradigms — naming, factoring,
where options objects go, how errors are shaped. The more the kit's
constructs read like core's, the cheaper every consumer's mental model
gets, and the easier the kit's pieces compose with the wider ecosystem.
Divergence is allowed, but it must be a recorded decision with a reason,
never a habit.

[^effect-process]: `.repos/effect/packages/effect/src/process/ChildProcessSpawner.ts`
    — the core contract, its `make` factory deriving the rich surface
    from one `spawn` primitive, and the doc-comment style this repo's
    modules match.
[^effect-filesystem]: `.repos/effect/packages/effect/src/FileSystem.ts` —
    the core-declared `FileSystem` service contract, implemented by
    `@effect/platform-node` and required in `R` by boundary packages
    such as `walker` and `config-file`.
[^git-src]: `packages/git/src/` — requires core's `ChildProcessSpawner`
    in `R` rather than owning a subprocess backend.
[^commands-src]: `packages/commands/src/` — `Run` and `ToolDiscovery`
    require core's `ChildProcessSpawner` in `R`.
