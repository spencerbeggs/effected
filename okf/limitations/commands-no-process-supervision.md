---
type: Limitation
title: "@effected/commands does not supervise or archive processes"
description: Reap-after-detach, readiness polling, and archive helpers are deliberately absent, and stay a level up.
status: stable
bounds: ../modules/commands.md
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d0c735290241fa38
---

# @effected/commands does not supervise or archive processes

## The condition

A consumer wants to signal a detached process after the fact, poll a
long-running process until it becomes ready, or extract/create an archive
(tarball or similar) as part of a command pipeline.

## The symptom

None of this exists in `@effected/commands`. `Run.detach` hands back a pid
and stops — it does not signal that pid again later, and it does not poll
anything to readiness. There is no archive helper of any kind.

## Why this is acceptable

Signalling a bare pid later needs `node:process.kill`, which a boundary
package may not import, and no handle survives an Actions `main` → `post`
process boundary anyway — the pid is genuinely all that can cross it. The
reap half and the poll-until-predicate helper both belong to
`@effected/github-actions`, which is licensed for `node:` imports and
already owns the phase-boundary machinery that motivates them.

An honest archive API is not a thin `tar` wrapper: it has to answer
determinism (mtimes, uid/gid, entry order), `bsdtar`-versus-GNU flag
divergence, and whether extraction is in scope, and shipping a
half-answer here would sink that design into the wrong package. The
trigger to revisit is a second consumer needing archives, or an
attestation pipeline needing byte-reproducible artifacts — at that point
it is a new package (`@effected/archive`), built on this one, not a bolt-on
here.

Process supervision and package-manager or `PATH`/`which` detection are
similarly out of scope: package-manager detection is inverted to
`LocalExec` rather than duplicated, and probing a tool by spawning it
answers the only real question without a filesystem scan, `PATHEXT`
handling, or a `FileSystem` requirement.

## What the fix would take

A reap/poll helper is `@effected/github-actions`' to add when a second
consumer needs it outside the Actions runtime. An archive package is a new
kit package, designed once a second consumer's determinism requirements are
known, rather than guessed at here.
