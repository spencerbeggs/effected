---
type: Limitation
title: "@effected/commands does not supervise or archive processes"
description: Reap-after-detach, readiness polling, and archive helpers are deliberately absent, and stay a level up; the one exception is RunOnce's signal-0 liveness probe, which asks whether a lock owner exists and never signals or supervises it.
status: stable
bounds: ../modules/commands.md
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: d77327d7ecede403
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

One thing that looks like supervision does exist, and is not:
[`RunOnce`](../decisions/run-once-trust.md) asks whether the pid recorded
in a lock file is still alive, through the kit-declared `ProcessLiveness`
contract. Its Node binding, `nodeProcessLiveness` in `./node-sync`, is
`process.kill(pid, 0)`: signal 0 sends nothing and only reports whether the
process exists (`EPERM` counts as alive, since the process belongs to
another user). It never signals a process, never waits on one, and never
reaps one; it answers one question, so a dead owner's lock can be taken
over. It lives in `./node-sync`, never on the main entry, which still
imports no `node:` module.

## Why this is acceptable

Signalling a bare pid later needs `node:process.kill`, which the
boundary main entry may not import (the liveness probe's signal-0 call
sits behind `./node-sync`, and sends no signal), and no handle survives an Actions `main` → `post`
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
