---
type: Decision
title: "The git ssh BatchMode pin is appended to what git would have used, and declines rather than substitutes"
description: "Before a network-touching Git member spawns, the service walks git's own GIT_SSH_COMMAND > core.sshCommand > GIT_SSH order at that cwd and appends -o BatchMode=yes only where appending is meaningful; every other case leaves the environment unpinned."
status: stable
tags:
  - security
  - architecture
sources:
  - id: git-service
    resource: ../../packages/git/src/Git.ts
  - id: git-unit-tests
    resource: ../../packages/git/__test__/Git.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 067bc6f52b4db9bf
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 0deac17569b8e42c
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# The git ssh BatchMode pin is appended to what git would have used, and declines rather than substitutes

## Context

`Git`'s base environment pins (`LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`,
`GIT_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`) close every prompt git
itself can raise, but `ssh` reads a key passphrase and a host-key
confirmation from `/dev/tty` directly, so none of them reach it. Probed
under a real pty, first contact with an unknown host hangs a network
member indefinitely until the 30-second `GIT_TIMEOUT` fires; `-o
BatchMode=yes` is the only lever that makes `ssh` fail instead of
block.[^git-service] Pinning it, however, means setting `GIT_SSH_COMMAND`,
which outranks `core.sshCommand`, which outranks `GIT_SSH` (each rung
verified against git 2.55) — so a naive pin of a bare `ssh -o
BatchMode=yes` silently discards a configured deploy key or transport and
turns "prompts for a passphrase" into "cannot reach the remote at all".

## Decision

Before a network-touching member spawns, `resolveSshEnv` walks git's full
precedence order for **that `cwd`** — `GIT_SSH_COMMAND` from the
environment, else `core.sshCommand` in that repository's config, else
`GIT_SSH`, else plain `ssh` — and **appends** `-o BatchMode=yes` to the
resolved command through `withBatchMode`. The result is `BASE_ENV` plus a
`GIT_SSH_COMMAND`, or `BASE_ENV` alone when resolution declines. It
declines, deliberately, in four cases:[^git-service]

- **`GIT_SSH` is the deciding rung.** It names a program and supports no
  arguments, so appending would make git invoke a program of that literal
  name. Resolution returns `BASE_ENV` untouched rather than displace a
  working transport with a bare `ssh`.
- **`ssh.variant` / `GIT_SSH_VARIANT` is anything but `auto`, `ssh`, or
  unset.** git's basename inference is overridable: a program literally
  named `ssh` with `ssh.variant=plink` is invoked with plink's `-P` and no
  `-o SendEnv=` (verified against git 2.55), so the append would corrupt a
  command that passes every name-based check.
- **The program's basename is not `ssh`.** `plink` has no `-o KEY=VALUE`
  form (its switch is `-batch`), so appending breaks a working PuTTY setup
  outright instead of degrading it.
- **The command already sets `BatchMode` as an option.** OpenSSH takes the
  first value obtained for a repeated option (verified with `ssh -G`
  against OpenSSH 10.3), so appending after a caller's `BatchMode=no` is
  inert; the caller's decision stands.

Two properties of the resolution follow from it being per-`cwd` rather
than per-service. The `core.sshCommand` and `ssh.variant` reads happen on
every network call because both are repository-local while one `Git`
instance serves every `cwd`; each is skipped when its environment
counterpart already decides, the two run concurrently, and they go
through the plain (non-network) run path because routing them through the
network path would recurse. And only the seven network-touching members
pay any of it — `lsRemote`, `fetch`, `fetchUnshallow`, `push`, `pull`,
`submoduleAdd`, `submoduleUpdate` — via `runForNetwork`; everything else
spawns with `BASE_ENV` alone, because a member that never invokes `ssh`
has no business pinning an ssh command or paying the config read.

The two guards are **deliberately narrow, and the asymmetry is the
reason**. `sshProgram` is quote-aware but not shell-aware:
`GIT_SSH_COMMAND` is shell-interpreted, so `"/opt/my tools/ssh" -i key`
is a working setup a plain whitespace split would misread as `"/opt/my`
and skip. `DECIDES_BATCH_MODE` matches `BatchMode` only after a `-o`, so
`ssh -F /tmp/BatchMode` — a config-file path — does not read as a
decision. Matching too little is safe (first-wins means an unrecognized
spelling still beats the append), while matching too much silently skips
the pin for a caller who never asked to be prompted. Each guard has a
regression test with a mutant; do not broaden either.[^git-unit-tests]

There is no opt-out through the `Git` service, which builds and spawns
internally. A caller who genuinely wants an interactive prompt takes the
`GitCommand` value and runs it themselves, and gets a plain inherited
environment with no pins at all — the honest shape, since `Git`'s
classification guarantees do not travel with the argv.

## Alternatives rejected

**Substitute a fixed `ssh -o BatchMode=yes`.** Rejected because it
outranks and discards `core.sshCommand` and `GIT_SSH`, converting a
prompt into an unreachable remote for anyone with a deploy key or custom
transport configured.

**Treat `GIT_SSH` as an ordinary rung and append to it.** Rejected: it is
a program name with no argument grammar, so the appended string becomes
part of the program name. This mistake was made once and is why the
decline is recorded.

**Broaden the guards to a whitespace split and a bare `BatchMode` word
match.** Rejected because both broadenings fail in the direction that
silently re-enables prompts, which is the failure the pin exists to
prevent.

## Consequences

A network-touching member's worst-case latency is a multiple of
`GIT_TIMEOUT`, not one instance of it — see [the latency
limitation](../limitations/git-network-member-latency-multiple-of-timeout.md).
A new network-touching member must route through `runForNetwork`, and a
new non-network member must not. The unit harness's `withoutSshProbe`
hides the config probes from `byArgs` so a member's own argv assertions
stay about the member.[^git-unit-tests]

[^git-service]: `packages/git/src/Git.ts` — `BASE_ENV`, `BATCH_MODE`,
    `DECIDES_BATCH_MODE`, `sshProgram`, `withBatchMode`, `resolveSshEnv`
    and `runForNetwork`, with the probe notes in their doc comments.
[^git-unit-tests]: `packages/git/__test__/Git.test.ts` — `withoutSshProbe`
    and the `withBatchMode` decline cases with their mutants.
