---
type: Decision
title: memfs takes zero @effected/* edges, ever
description: memfs never depends on another @effected package — runtime, peer or dev — because it is the filesystem double every other kit package's tests devDepend on.
status: stable
sources:
  - id: package-json
    resource: ../../packages/memfs/package.json
  - id: claude-md
    resource: ../../packages/memfs/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: 2e91ea77fea6cf3f
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 7b32c749191c886c
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# memfs takes zero @effected/* edges, ever

## Context

`@effected/memfs` exists to be the filesystem test double every other
kit package devDepends on, `@effected/glob` included. Its `FileSystem.glob`
member needs glob-matching capability, which `@effected/glob` already
ships as a full-fidelity minimatch engine.

## Decision

`@effected/memfs` takes no `@effected/*` edge of any kind — not a
runtime dependency, not a peer, not even a devDependency.[^package-json]
Its `FileSystem.glob` member never imports `@effected/glob`. It is
core's own glob, which `FileSystem.make` derives from the engine's
`readDirectoryEntries`, so the law costs no duplicated matching code:
the engine carries no glob of its own and serves no public matching API.

A new package was created for this role rather than folding the
capability into an existing one, because every existing candidate host
either inverts the law or is the wrong domain: `@effected/glob` would
have to be devDependency-consumed *by* its own test double, which is
circular; `walker`, `xdg` and `commands` are simply the wrong domain for
a filesystem engine; and `store` is both the wrong domain and integrated
tier, which would make every pure-tier consumer of the double take on an
integrated-tier dependency just to run its tests. A test-support leaf
package that everything may devDepend on and that itself depends on
nothing is the only shape without cycles.

## Alternatives rejected

**Import `@effected/glob` for `FileSystem.glob` and "deduplicate" the
matching logic.** Rejected because any edge from `memfs` back into the
kit creates exactly the cycle the zero-edges law exists to prevent:
`@effected/glob`'s own tests devDepend on `memfs`, so `memfs` depending
on `@effected/glob` at runtime would form a cycle through the dependency
graph the moment both packages are resolved together. Core's derived
glob gives `fs.glob` what the host gives it, which is all a filesystem
double owes.

**Fold the memory filesystem into an existing package (`glob`, `walker`,
`xdg`, `commands`, or `store`).** Rejected for each candidate on
independent grounds: `glob` inverts the law (see above); `walker`, `xdg`
and `commands` are domain mismatches — none of them is where a
filesystem engine belongs conceptually; and `store` compounds a domain
mismatch with a tier mismatch, since `store` is integrated tier and
folding a pure-tier test double into it would force every pure-tier
consumer to accept an integrated-tier edge.

## Consequences

Every kit package, at any tier, can devDepend on `@effected/memfs`
without tier or cycle consequences, because the edge only ever runs one
direction — from a package's tests into `memfs`, never the reverse.
`fs.glob` matches exactly as core's glob does on the host, so a test of
glob behaviour against `memfs` is a test against core's semantics, never
against `@effected/glob`'s.

[^package-json]: `packages/memfs/package.json` — `effect` as the only
    peer dependency; no `@effected/*` entry anywhere in the manifest.
