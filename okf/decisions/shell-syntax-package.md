---
type: Decision
title: "Shell syntax analysis is its own pure package, @effected/shell, not a commands subpath or core CommandLine"
description: "A tolerant lexer and segmenter for untrusted command strings ships as the pure @effected/shell package with a never-fail, never-evaluate contract and result types that are deliberately not core's CommandLine.Word; a @effected/commands subpath and core CommandLine were both rejected."
status: draft
tags:
  - architecture
  - bundle
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-06T00:00:00Z
  - id: issue-1204
    resource: https://github.com/spencerbeggs/effected/issues/1204
    title: "shell syntax: a tolerant command-string lexer and segmenter for guards and agent tooling"
  - id: shell-module
    resource: ../modules/shell.md
  - id: commands-module
    resource: ../modules/commands.md
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-07T03:57:53Z
integrity:
  generated:
    body: 80fd586435788f21
---

# Shell syntax analysis is its own pure package, @effected/shell, not a commands subpath or core CommandLine

## Context

Agent-hook guards and agent tooling must decide which simple commands an
untrusted command string would run before it runs. The first consumer, a
commit and PR-body guard, used `shell-quote`'s `parse`, dropped its operator
tokens and so let `git add -A && git commit -m "…"` skip the guard.[^issue-1204]
Two homes were proposed in the issue: a subpath of `@effected/commands`, or a
new package.

## Decision

Ship `@effected/shell`, a pure-tier package with `effect` as its only peer and
no runtime dependency.[^owner] `@effected/commands` does not change; it may
build on the package later. The package's contract has three clauses, and
each is a rule for every future change:[^shell-module]

1. **Never evaluate.** No expansion of any kind and no execution. Expansions
   are recorded as marked word parts with spans.
2. **Never fail.** `ShellSyntax.parse` is total and synchronous: it returns a
   plain `ShellScript`, not a `Result`, because there is no failure to
   return. Input it cannot finish becomes an `opaque` part and a
   `ShellDiagnostic` on the script. `ShellSyntax.parseEffect` adds only a
   span. This departs from the kit's `parse` / `parseResult` naming on
   purpose: the sync form is the primitive and carries the short name, and
   the Effect form has no error channel to name.
3. **Fail closed.** `ShellWord.literal` is `Some` only for words the shell
   would pass unchanged, so an expansion (including brace and tilde
   expansion) can never be read as a literal. Where the grammar is not
   modelled, the lexer over-splits, reporting a command the shell might not
   run rather than hiding one.

The result types are not core `CommandLine.Word`, and say so in their TSDoc,
so analyzer output cannot be passed straight to a spawner.

## Alternatives rejected

- **A `@effected/commands` subpath.** Cheaper to start, and most consumers
  already depend on `commands`. Rejected: shell syntax is a format with its
  own grammar, fixture corpus and parser-hardening story, like `jsonc`,
  `yaml` and `toml`, and it is useful without spawning. As a subpath it would
  sit inside a boundary-tier package that owns process execution, grow
  toward a fuller bash grammar there, and leave its pure core reachable only
  through a package with IO concerns.[^commands-module]
- **Core `CommandLine`.** Rejected by its contract, not its quality.
  `CommandLine` is a construction API for safe execution and refuses shell
  syntax (`&&`, `|`, `$HOME`, `*`) with `UnsupportedSyntax`. An analyzer of
  untrusted text needs the opposite contract: tolerate everything, execute
  nothing. Placing the analyzer beside `CommandLine`, or returning its
  `Word` type, would put analyzer output one step from `ChildProcess`.
- **Keep `shell-quote`.** It expands variables from an environment, drops
  heredocs, reads an unquoted newline as whitespace and throws on `${}`, so a
  guard built on it needs a pre-pass and still cannot tell a literal from an
  expansion.
- **A failing parse (`Result` or a typed error).** Rejected: a guard that
  crashes or falls open on odd input is the failure the package exists to
  prevent. Diagnostics carry what a failure would have said.

## Consequences

Guards read `ShellScript.commands()` and treat a `None` name, a non-empty
`diagnostics` list or an `opaque` part as unknown. Nested commands are
reached through `ShellScript.substitutions()` and a caller-owned recursion.
Compound-command grammar (`if`/`for` bodies, `[[ ]]`, functions) is future
work inside this package, under the same three clauses.

[^issue-1204]: <https://github.com/spencerbeggs/effected/issues/1204>
[^owner]: The owner ruled on 2026-11-06 for option 2, a new pure
    `@effected/shell`, with `@effected/commands` unchanged on this branch.
[^shell-module]: `../modules/shell.md`
[^commands-module]: `../modules/commands.md`
