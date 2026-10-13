---
type: Gotcha
title: Run.text trims output that depends on fixed columns
description: Run.text trims the whole captured result, which silently corrupts a command's output whenever its meaning depends on a leading column of whitespace, such as git status --porcelain.
status: stable
resource: ../../packages/commands/src/Run.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 06d54d9d910e4188
---

# Run.text trims output that depends on fixed columns

## What a reader sees

A command run through `Run.text` — for example `git status --porcelain`
— returns a string that parses incorrectly: a status code that should
occupy a specific leading column looks shifted, or an expected leading
space is simply gone.

## What they would wrongly conclude

That the underlying command produced different output than expected, or
that the parsing logic reading the result is buggy, rather than suspecting
the helper that captured the output in the first place.

## What is actually true

`Run.text` trims the entire captured result before returning it. That is
deliberate for the common case — trailing newlines and incidental leading
whitespace are noise for most command output — but it silently corrupts
any output whose meaning depends on fixed-column formatting, most
canonically `git status --porcelain`, whose first column can legitimately
be a space that means something (an unmodified index state, in porcelain
format) and gets stripped along with everything else `Run.text` decides is
whitespace to discard.

## The check

Never parse fixed-column command output — porcelain-style status lines,
anything documented as depending on column position — from `Run.text`.
Use `Run.collect` instead and read `stdout` untrimmed, since `collect`
returns a result rather than committing to any particular trimming
policy.[^run-text]

[^run-text]: `packages/commands/src/Run.ts:343-348` — `Run.text`'s
    implementation trims `checked.stdout` unconditionally as its return
    value; `collect`'s untrimmed `stdout` is the escape hatch.
