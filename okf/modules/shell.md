---
type: Module
title: "@effected/shell"
description: "A tolerant shell-syntax lexer and segmenter for guards and agent tooling: which simple commands an untrusted command string would run, with which words and from which spans, as pure Schema classes that never fail and never evaluate."
status: draft
kind: package
resource: ../../packages/shell
tags:
  - architecture
  - dx
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-06T00:00:00Z
  - id: issue-1204
    resource: https://github.com/spencerbeggs/effected/issues/1204
    title: "shell syntax: a tolerant command-string lexer and segmenter for guards and agent tooling"
  - id: systems-guard
    resource: https://github.com/savvy-web/systems/blob/main/packages/silk-effects/src/commitlint/hook/parse-bash-command.ts
    title: "savvy-web/systems commit and PR-body guard, the first consumer"
  - id: bash-manual
    resource: https://www.gnu.org/software/bash/manual/bash.html
    title: "GNU Bash Reference Manual: shell syntax, quoting, expansions, redirections"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-07T03:57:53Z
integrity:
  generated:
    body: c8d55709debccecf
---

# @effected/shell

`@effected/shell` answers one question about an untrusted command string:
**which simple commands would this run, and with which words?** Agent-hook
guards and MCP tooling that inspect a Bash tool call before it runs need that
answer, and nothing in the kit or in Effect core gave it.[^issue-1204] The
first consumer is savvy-web/systems' commit and PR-body guard, which tokenized
with `shell-quote`, dropped the operator tokens and so classified
`git add -A && git commit -m "…"` as unknown, skipping the guard.[^systems-guard]
The owner ruled for a new pure package (option 2 of the issue) on
2026-11-06.[^owner] Why a package, why not core `CommandLine`, and the
never-fail, never-evaluate contract are recorded in
[shell syntax is its own package](../decisions/shell-syntax-package.md).

## Tier and dependencies

[Pure tier](../glossary/library-tier.md): `effect` is the only peer, there is
no runtime dependency at all, no `node:` import, no service and no layer.
`"sideEffects": false`. Line and character positions are deliberately left to
the caller: every span is a pair of UTF-16 offsets into `ShellScript.source`,
which `@effected/source`'s `LineIndex` converts if a consumer wants them, so
this package takes no edge for it.

## The contract

- **Lex and segment, never evaluate.** No variable, tilde, brace, glob,
  arithmetic or command-substitution expansion happens, and nothing executes.
  Expansions are recorded as marked parts with their source spans.
- **Never fail.** `ShellSyntax.parse` is total and synchronous and never
  throws. Input it cannot finish (an unterminated quote, `$(`, `((`,
  backtick, `${`, heredoc) becomes an `opaque` part running to the end of the
  input, plus a `ShellDiagnostic` on the script. A guard must never crash or
  fall open on odd input. A script records at most 1000 diagnostics, then one
  `DiagnosticLimitReached`.
- **Fail closed.** `ShellWord.literal` is `Some` only when every part of the
  word is bare, single-quoted, double-quoted without expansions, or ANSI-C
  quoted, so a guard reading `git commit` reads exactly what the shell would
  pass. Anything the shell would expand makes it `None`, including brace
  expansion (`git {commit,}` runs `git commit`) and tilde expansion. Where
  the grammar is missing, the segmenter over-splits. It never reads a heredoc
  that is not there: a spurious heredoc would hide the lines after it, while
  a missed one only reports its body as commands.
- **Not `CommandLine.Word`.** The result types are deliberately not core's
  `CommandLine` vocabulary, so analyzer output cannot be handed straight to a
  spawner. Anything to execute goes through `CommandLine` after validation.

## The surface

| Module | Exports | Concept |
| --- | --- | --- |
| `ShellSyntax` | `ShellSyntax` | `parse(input): ShellScript`, total and synchronous; `parseEffect(input)`, the same behind the `ShellSyntax.parseEffect` span with no failure channel. |
| `ShellScript` | `ShellScript` | `source`, `segments`, `comments`, `diagnostics`; `commands()` resolves each segment to a `ShellCommand`; `substitutions()` lists every command and process substitution at this level in source order. |
| `ShellSegment` | `ShellSegment`, `ShellOperator` | One simple command: `words`, `assignments` (leading `FOO=1` prefixes), `redirections`, `operator: Option<ShellOperator>` joining it to the next segment, `groupDepth` (parenthesis nesting), `start`, `end`; a `heredocs` getter. |
| `ShellWord` | `ShellWord` | `start`, `end`, `raw`, `parts`, and the derived `literal: Option<string>` with ANSI-C escapes decoded. |
| `ShellWordPart` | twelve part classes, `ShellWordPart`, `ShellExpansionPart`, `ShellSubstitutionPart` | Quoting provenance on a domain `kind` discriminant: `bare`, `singleQuoted`, `doubleQuoted` (with its `expansions`), `ansiC`, `variable`, `commandSubstitution`, `arithmetic` (the `$((…))` expansion, or with `command` `true` the `((…))` command), `processSubstitution`, `glob`, `brace`, `tilde`, `opaque`. `variable`, `arithmetic`, `brace` and `opaque` carry the `substitutions` inside them. |
| `ShellAssignment` | `ShellAssignment` | `name`, `append` (`+=`), `value: ShellWord`, `start`, `end`, `raw`. |
| `ShellRedirection` | `ShellRedirection`, `ShellRedirectionOperator` | `fd: Option<number>`, `operator`, `target: ShellWord \| ShellHeredoc`, `start`, `end`. |
| `ShellHeredoc` | `ShellHeredoc` | `delimiter`, `quoted`, `stripTabs` (`<<-`), `body` with `start`/`end` offsets, `terminated`, and `expansions` for an unquoted body; a `text` getter strips `<<-` tabs. |
| `ShellComment` | `ShellComment` | A `#` comment's `text`, `start`, `end`. |
| `ShellDiagnostic` | `ShellDiagnostic`, `ShellDiagnosticCode` | `code`, `offset`, `length`, a derived `message`; the `offset`/`length` pair satisfies `@effected/source`'s `SourceRange`. |
| `ShellCommand` | `ShellCommand` | `segment`, `name: Option<string>`, `args`, `wrappers`; `ShellCommand.fromSegment(segment)` unwraps `sudo`, `env`, `command`, `exec`, `nohup` and `time` (matched by last path segment), and skips the words that name no command: reserved words (`!`, `{`, `}`, `if`, `then`, `elif`, `else`, `fi`, `do`, `done`, `while`, `until`, `esac`, `coproc`), `[[ … ]]`, `((…))`, `for`/`select NAME` before `do` or `{`, `function NAME`, and assignments. |

### Operators and segments

Segments split on the control operators `&&`, `||`, `;`, `;;`, `;&`, `;;&`,
`|`, `|&`, `&` and an unquoted newline (reported as `"newline"`). `(` and `)`
end a segment and move `groupDepth` without being operators: the operator a
segment reports is the next control operator after it, so in
`(cd dir; make) && git commit` the `make` segment reports `&&`. A segment with
no word, assignment or redirection is dropped. An operator with no command
before it (`&& b`) records an `EmptyCommand` diagnostic.

### Heredocs

`<<` and `<<-` register a pending heredoc; at the next unquoted newline its
body is consumed through the delimiter line, so operators inside the body are
never split on.[^bash-manual] A CRLF line break counts as a line break, at segment level and
when matching a delimiter line: a guard over-reporting a command the shell
would not run is the safe direction. Inside `$(…)` the nested scanner skips
heredoc bodies the same way, which is what keeps the apostrophe in
`git commit -m "$(cat <<'EOF' … it's … EOF)"` from opening a quote.

Inside arithmetic, `<<` is a shift. A `((` is lexed as the arithmetic
command, one word with an `arithmetic` part, until its `))`, and a `$((` or
the legacy `$[` as the arithmetic expansion; none registers a heredoc, at top
level or in the nested scanner, so `(( x = 1 << 2 ))` or `echo $[1 << 2]`
followed by a line `2` hides nothing. The `[ … ]` subscript of a
command-position word that starts `NAME[` is arithmetic too, and bash reads
it as a matched pair, spaces, newlines and `#` included, whether or not an
`=` follows. The lexer does the same: `a[1 << 2]=x` is an assignment, and
`a[1<<2]` with no `=` a word whose subscript is one `opaque` part. A
subscript holding a substitution is still an assignment, with the substitution
on its `subscript` field, so `ShellScript.substitutions` lists it and command
position continues past it. The nested scanner, which does not track command position, reads
a subscript at every word start inside `$(…)`, which can only over-report.
When the second parenthesis closes with no `)` right after it (`((cmd) )`),
the text is two subshells, as bash decides: `$((` becomes a command
substitution, and a top-level `((` is re-lexed as groups. Inside that span a
`<<` opens no heredoc, which only over-reports, and keeps the lexer linear on
a megabyte of `((`. A plain `let x=1<<2` is still a heredoc, as in bash.

Command position is bash's `reserved_word_acceptable`, carried by the lexer's
`Follows` states: `time -p` and `time --` keep it, the word after `function NAME`
or `coproc NAME` gets it back, and so does a reserved word after `]]`, `((…))` or
`for NAME`. Over-arming only stops a `<<` from opening a heredoc.

A backslash-newline is removed before bash tokenizes, so `skipContinuations`
sits at every lookahead that joins two characters into a token, in both scanners
and in delimiter reading. It stays literal in a comment, in single quotes, after
an escaping backslash, and in a quoted heredoc body; under an unquoted delimiter
two lines are joined before the delimiter comparison, so `E\⏎ND` ends `<<END`. A
backslash before a CRLF escapes the CR, and the LF ends the command.

A delimiter holding `$(`, `$((`, `$[`, `${`, a backtick, `<(` or `>(` reads no
body and records `ExpansionInHeredocDelimiter`: bash reads the word as a matched
pair and rebuilds a `$( … )` from its parse, so `<<$(  true  )` ends at a line
`$(true)` and the delimiter line cannot be known. `$'…'` and `$"…"` delimiters
are their quoted text.

### Command resolution

`ShellCommand.fromSegment` is pure and static, so a consumer can resolve any
segment. It skips the words that name no command, then unwraps the six
wrappers with their own options (`sudo -u root`, `env -i -u X FOO=1`,
`exec -a name`, `time -p`, `command -p`). The skipped words include more
than reserved words, because bash lets a compound command's closing word run
straight into the next keyword without a separator: `if [[ 1 ]] then git
commit; fi`, `for ((;;)) { git commit; }`, `function f { git commit; }` and
`time { git commit; }` are each one segment whose command is `git`.
Assignments after any of those count too (`if [[ x ]] then FOO=1 git`), and
the lexer itself records an assignment after a reserved word or `time`.

`env` and `sudo` read their argv after quote removal, so `env "FOO=a b" git`
and `env "-i" git` unwrap; `time` is a reserved word, so only an unquoted
assignment follows it. A wrapper is recognized by its last path segment
(`/usr/bin/env`), while `name` stays as written. `command -v` and
`command -V` only look a name up, so they stop unwrapping and report
`command`. `env -S` splits a string into a command line this package does not
model, so it stops with `name` `None`. When a word in command position, or a
wrapper option, has no literal, resolution stops: `name` is `None` and `args`
are the words from that word on. A segment that runs no command (`fi`, `}`,
`(( x > 1 ))`) also has `name` `None`, but with no `args`, which is how a
guard tells the two apart.

Nested commands are the caller's to inspect: `script.substitutions()` lists
every `$(…)`, backtick and `<(…)` / `>(…)` at this level, including those
inside double quotes, assignment values (an array value's elements are lexed
as words), braced parameter expansions, arithmetic, brace-expansion spans,
opaque parts and unquoted heredoc bodies, and `ShellSyntax.parse(part.body)`
parses one. A backtick body is the text after bash's escape removal (`\$`,
`` \` ``, `\\`, and `\"` inside double quotes lose their backslash), so a nested
escaped backtick pair is a substitution of the nested parse. The caller owns
the recursion depth, and must refuse, not drop, what is left at its cap.

## Architecture

`src/internal/` is the engine: one forward scan producing raw records
(`internal/lexer.ts`), a nesting-aware skip scanner for opaque bodies
(`internal/nested.ts`) and the ANSI-C decoder (`internal/ansiC.ts`). It imports
no public module. `ShellSyntax.ts` materializes the records into the Schema
classes. Nothing recurses on input depth: the nested scanner keeps an explicit
frame stack, the bracket-glob scan caches its last failure, and brace
expansion is matched with a stack over the word's events, so every input is
lexed in linear time.

## Testing

`__test__/fixtures/` holds the corpus with a provenance README: the
`shell-quote` 1.10.0 parse corpus ported to this package's non-expanding
semantics (each divergence from `shell-quote` named), and the shapes agents
emit (chains, `git commit -m "$(cat <<'EOF' … EOF)"`,
`gh pr create --body-file -` fed by a heredoc, `FOO=1 git commit`,
`cd dir && …`, the wrappers, CRLF input, unterminated quotes). Mutation
controls show each operator and quoting rule matters, and a hostile suite
holds one-megabyte inputs (`"`, `$(`, `((`, `$[`, `a[`, `{`, `[`, `<<a`)
to linear growth. `__test__/bypass-regressions.test.ts` pins every shape a review found
bash running that the analyzer once hid, each against a control, and runs
them through the README's guard.

## Limitations

There is no full grammar for compound commands. `[[ … ]]` is lexed as words,
so an `&&` inside it splits a segment and a `<` inside it reads as a
redirection; an arithmetic `&&` or `<` inside a `((` that the lexer had to
treat as groups does the same; `case` patterns end at their `)`; function
bodies are segmented as if they ran. Each of these over-reports commands
rather than hiding one. A heredoc delimiter written as `EOF)` inside `$(…)`,
which bash accepts, is not recognized: the substitution comes out
unterminated with diagnostics, so it fails closed. Commands that take a
command string (`bash -c`, `eval`, `xargs`, `find -exec`, `ssh`) are reported
as their own name; interpreting their arguments is the caller's.

This was checked against GNU bash 5.3 only, with the reviewed shapes, every position of a backslash-newline in them, and a random differential fuzz. That is evidence, not proof, and dash, zsh and POSIX-mode bash were not tested. A guard must not treat `commands()` as a complete gate until these are closed. Two parser modes hide a command with no diagnostic: under `shopt -s extglob` (or an inherited `BASHOPTS`), `echo @(<<E)` and `cat <<E@(x)` read a heredoc bash does not, and under `shopt -s expand_aliases` an alias body is never read (`alias c='git commit'`, then `c`). So refuse `shopt` and `alias`, which are reported as command names, and control the environment. Text handed to another parser is not read: `eval`, `bash -c`, `source`, `xargs`, `find -exec` and `ssh` are reported as their own name. A script with any diagnostic may hide a command (`x=$(echo a[ )` swallows the lines after it as one unterminated substitution), so treat every diagnostic as a refusal, as the README guard does.

[^issue-1204]: <https://github.com/spencerbeggs/effected/issues/1204>
[^systems-guard]: savvy-web/systems,
    `packages/silk-effects/src/commitlint/hook/parse-bash-command.ts`
[^bash-manual]: <https://www.gnu.org/software/bash/manual/bash.html>, sections
    3.1 (shell syntax), 3.5 (expansions) and 3.6 (redirections)
[^owner]: The owner ruled on 2026-11-06 for a new pure `@effected/shell`
    package with `effect` as its only peer, leaving `@effected/commands`
    unchanged on this branch.
