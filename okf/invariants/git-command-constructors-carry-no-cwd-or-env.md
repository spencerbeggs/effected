---
type: Invariant
title: A GitCommand constructor carries no cwd and no environment
description: "Every GitCommand constructor returns a pure value with argv, a redaction mask and extendEnv: true only; the Git service applies cwd and the environment pins per call at its single spawn choke point, and the constructor suite asserts options.env is undefined for every constructor."
status: stable
resource: ../../packages/git/__test__/GitCommand.test.ts
tags:
  - architecture
  - testing
sources:
  - id: git-command-tests
    resource: ../../packages/git/__test__/GitCommand.test.ts
  - id: git-command
    resource: ../../packages/git/src/GitCommand.ts
  - id: git-service
    resource: ../../packages/git/src/Git.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: b0b5e2ad1cf8c2d5
---

# A GitCommand constructor carries no cwd and no environment

## The property

Every `GitCommand` constructor is a pure, context-free value: argv plus
the redaction mask, with `{ extendEnv: true }` as the only spawn option
and neither `cwd` nor `env` set.[^git-command] `Git` applies both at its
single spawn choke point, `runClassified`, via `ChildProcess.setCwd` and
`ChildProcess.setEnv` — each returning a new command and leaving the pure
value untouched.[^git-service]

`extendEnv: true` is not one of the pins. It declares that git inherits
the parent environment at all (git needs `PATH`, `HOME`, `SSH_AUTH_SOCK`)
and forces no value; it is set at construction because core exposes no
run-time combinator for it — only `setCwd` and `setEnv` — and its default
belongs to whichever platform backend implements `ChildProcessSpawner`,
not to core.

## The mechanism

The `assertGitCommand` helper shared by the whole constructor suite
asserts `command.options.env` is `undefined` and no `cwd` is set for
every constructor case, alongside the argv and redaction
checks.[^git-command-tests] A pin that leaks back onto a constructor
fails the suite at once.

## What a refactor would have to break

Putting `LC_ALL`, `GIT_TERMINAL_PROMPT` or any other pin back onto a
`GitCommand` constructor, or making a constructor read the ambient
environment. The pins live on the service because they serve `classify`
and `GIT_TIMEOUT`, which live in `Git.ts`, and because the ssh pin must
be computed from the caller's own environment and the call's `cwd`, which
a pure constructor must never read. The ambient environment is read once,
in `Git.layer`, through `ConfigProvider` — a `Context.Reference`
defaulting to `fromEnv()`, so the read costs nothing in `R`, a test swaps
a provider instead of mutating the environment, and `src/` keeps its
zero-`node:`-imports boundary; a source-level `ConfigError` degrades to
"absent" because the layer's error channel is `never` by
contract.[^git-service]

[^git-command-tests]: `packages/git/__test__/GitCommand.test.ts` —
    `assertGitCommand` asserts `options.env` is `undefined` and no cwd for
    every constructor.
[^git-command]: `packages/git/src/GitCommand.ts` — the private `git`
    helper sets `extendEnv: true` and nothing else.
[^git-service]: `packages/git/src/Git.ts` — `runClassified` applies
    `setCwd` and `setEnv`; `Git.layer` reads `GIT_SSH_COMMAND`, `GIT_SSH`
    and `GIT_SSH_VARIANT` through `ConfigProvider`.
