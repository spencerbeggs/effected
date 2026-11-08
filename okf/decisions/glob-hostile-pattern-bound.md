---
type: Decision
title: glob does not bound total matching work on hostile patterns
description: "@effected/glob keeps matching polynomial without a work budget or a lower brace-expansion default; matching is synchronous, so a caller taking untrusted patterns or long paths bounds the input and lowers braceExpandMax, and enforces any deadline off-thread."
status: stable
tags:
  - architecture
  - dx
sources:
  - id: glob-module
    resource: ../modules/glob.md
generated:
  by: "okfit/claude-code"
  at: 2026-11-08T12:06:40Z
integrity:
  generated:
    body: 8ed17dc485aa1ecb
  verified:
    by: human:spencer
    at: 2026-11-08T18:25:54Z
    content: 230c6375ede67379
verified:
  - by: human:spencer
    at: 2026-11-08T18:25:54Z
---

# glob does not bound total matching work on hostile patterns

## Context

`GlobPattern.matches` is total and its time is polynomial: the exponential `**` case was fixed by the `tried` set, and every recursion surface is capped. A hostile pattern against a long candidate can still be slow. `**/a/**` against 50,000 portions followed by a `.x` portion takes about 3.5 s, and a brace expansion multiplies the work of compiling and matching by its alternatives, up to the default `braceExpandMax` of 100,000. A numeric range of 100 or more values (`{0..999}`) is not expanded: as in minimatch 11 it is one portion, so it adds no alternatives. It still costs memory to compile, up to 684 matcher items for the widest ends, and brace alternatives around it give each alternative its own copy. So one compile's work is budgeted, its regexps and its matcher graphs together; a `GlobSet` is one compile. Past the budget the compile fails typed with reason `CompileBudgetExceeded`: `{$,a}{-9007199254740991..9007199254740991}` twelve times over (504 characters) took 16.7 s and 4.2 GB before graphs were charged, and now fails in about 0.2 s.

Every engine the review compared behaves the same, minimatch 11 included, so the cost is inherited from the dialect rather than introduced by the port. That premise was measured on `**` only.

Extglobs were a second route, and there the cost was the port's, not the dialect's: a position walk over the pattern's parse that was polynomial (up to 144 s for a 43-byte pattern against 800 characters, and 37 s for a 64 KB chain against 200) where minimatch 11 took milliseconds. The engine now matches every magic portion with minimatch 11.0.5's own matcher, vendored, so that route is closed and the premise holds again: what is slow now is slow in 11 too. Besides the `**` cases above, that includes a chain of negations separated by literals, which 11's matcher keeps a run per negation for: `x!(a)` repeated against `xb` repeated is about cubic, 22 ms at a 400-character path and 1.6 s at 2,000 (11.0.5: slower still). The decision below covers it unchanged: bound the input.

## Decision

Matching stays polynomial, and the kit does not bound total matching work. A caller that matches a pattern or a path taken from untrusted input is responsible for bounding it, and has to do so before the match starts. `matches` is synchronous: it blocks the calling thread until it returns, so an in-process timeout cannot cut it short. `Effect.timeout` around `Effect.sync(() => pattern.matches(path))` waits for the whole match, because the match never yields and the timer fiber cannot run. A probe confirmed it: `**/a/**` matched against 50,000 `a` portions followed by a `.x` portion, under `Effect.timeout("100 millis")`, ran to completion and returned after about 3,550 ms, while an `Effect.sleep("2 seconds")` control under the same timeout failed at about 100 ms.

So the levers are on the input:

- limit the pattern's length, and where a pattern may come from;
- limit the candidate's length or number of portions;
- lower `braceExpandMax` in `GlobPatternOptions`. A lowered `braceExpandMax` turns a brace product past it into a compile-time `GlobPatternError` with reason `ExpansionBudgetExceeded`, which fails fast and deterministically: `match-limits.test.ts` ("fails fast at compile when lowered") compiles `**/a/**/*{a,b}…*`, ten groups and 1,024 alternatives, under the default and fails it under a `braceExpandMax` of 100.

A caller that needs a deadline as well enforces it off the calling thread: a worker that is terminated when the deadline passes, a subprocess, or the host's own request deadline. The guidance sits in the `GlobPattern.matches` TSDoc and in the package README.

## Alternatives rejected

**A budget on total matching work, answering a false negative when spent** was rejected. The globstar recursion cap already answers with a documented false negative, but that cap is reached only by patterns no one writes by hand. A work budget would be reached by ordinary patterns against long enough paths, so a walker or an enumerator would silently miss files, and silently missing files is worse than being slow. Slowness is visible, and its cause is bounded by the input: a caller who bounds the pattern and the candidate before matching, or moves the match off-thread under a deadline, controls it. A false negative looks like a correct answer, and no caller can tell it from one. Turning the budget into an error instead would give `matches` an error channel, and its totality is the property every consumer relies on.

**A lower default `braceExpandMax`** was rejected. It would reject at compile some patterns that compile today, which is a breaking change for every consumer, to defend against a case that needs an untrusted pattern to arise. It would also not help the first case, which has no braces at all. The cap stays a lever the caller pulls when the pattern's source warrants it.
