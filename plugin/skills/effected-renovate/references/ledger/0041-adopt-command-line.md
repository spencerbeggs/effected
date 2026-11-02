---
id: "0041"
title: Adopt CommandLine for shell-safe command lines and secret arguments
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["shell-quote", "(shell|Shell)(Escape|Quote)", "escapeShell"]
---

Core `effect/process/CommandLine` ships `quote` and `join`, which build shell-safe command lines, and `Word` (`string | Redacted<string>`), which carries a secret argument to a child process without exposing it in records, errors or spans.

Where to look: hand-escaped shell strings, a `shell-quote` dependency, and tokens interpolated into `ChildProcess` arguments as plain strings. Check the installed `effect/dist/process/CommandLine.d.ts`.
