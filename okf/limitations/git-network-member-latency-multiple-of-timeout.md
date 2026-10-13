---
type: Limitation
title: A network-touching Git member's worst-case latency is a multiple of GIT_TIMEOUT
description: "Each ssh-pin config probe is a full classified run with its own 30-second ceiling, so a network member can spend up to 30s probing before its own 30s run, and fetchAny doubles that again."
status: stable
bounds: ../modules/git.md
tags:
  - performance
sources:
  - id: git-service
    resource: ../../packages/git/src/Git.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: aad7fa63e446cd2d
---

# A network-touching Git member's worst-case latency is a multiple of GIT_TIMEOUT

## Condition

A caller invokes one of the seven network-touching `Git` members
(`lsRemote`, `fetch`, `fetchUnshallow`, `push`, `pull`, `submoduleAdd`,
`submoduleUpdate`) and reasons about its worst case from the documented
per-operation ceiling of 30 seconds.

## Symptom

The member can take longer than 30 seconds before its own git process is
even spawned. Under [the ssh pin decision](../decisions/git-ssh-pin-appends-and-declines.md)
each network member first resolves `core.sshCommand` and `ssh.variant`
at the call's `cwd`, and each probe is a full `runFor` carrying its own
`GIT_TIMEOUT` ceiling. A network member can therefore spend up to 30s
probing before its own 30s run, and `fetchAny` — two fetch rounds — can
double that again.[^git-service]

## Why this is acceptable

A local `git config --get` does not hang in practice, so this is a ceiling
change rather than an observed cost: the probes are skipped when their
environment counterpart (`GIT_SSH_COMMAND`, `GIT_SSH_VARIANT`) already
decides, the two run concurrently, and only the network members pay them.
The alternative — one shared deadline across probes and run — would make
a slow probe steal budget from the operation the caller actually asked
for.

## What the fix would take

Making the probes conditional on something cheaper than a spawn, or
sharing one deadline across probes and run. Either change must account
for the ceiling described here rather than rediscover it.

[^git-service]: `packages/git/src/Git.ts` — `resolveSshEnv` runs each
    probe through `runFor`, which wraps `runClassified`'s
    `Effect.timeoutOrElse({ duration: GIT_TIMEOUT })`.
