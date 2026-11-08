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
  at: 2026-11-08T12:10:54Z
integrity:
  generated:
    body: b631923441aa65d4
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
| `ShellWord` | `ShellWord` | `start`, `end`, `raw`, `parts`; the derived `joined` (`raw` without the backslash-newlines bash removes, kept only inside a top-level `'…'` or `$'…'` part) and `literal: Option<string>` with ANSI-C escapes decoded. |
| `ShellWordPart` | twelve part classes, `ShellWordPart`, `ShellExpansionPart`, `ShellSubstitutionPart` | Quoting provenance on a domain `kind` discriminant: `bare`, `singleQuoted`, `doubleQuoted` (with its `expansions`), `ansiC`, `variable`, `commandSubstitution`, `arithmetic` (the `$((…))` expansion, or with `command` `true` the `((…))` command), `processSubstitution`, `glob`, `brace`, `tilde`, `opaque`. `variable`, `arithmetic`, `brace` and `opaque` carry the `substitutions` inside them. |
| `ShellAssignment` | `ShellAssignment` | `name`, `append` (`+=`), `value: ShellWord`, `subscript`, `start`, `end`, `raw`, and the derived `joined`. |
| `ShellRedirection` | `ShellRedirection`, `ShellRedirectionOperator` | `fd: Option<number>`, `operator`, `target: ShellWord \| ShellHeredoc`, `start`, `end`. |
| `ShellHeredoc` | `ShellHeredoc` | `delimiter`, `quoted`, `stripTabs` (`<<-`), `body` with `start`/`end` offsets, `terminated`, and `expansions` for an unquoted body; a `text` getter strips `<<-` tabs. |
| `ShellComment` | `ShellComment` | A `#` comment's `text`, `start`, `end`. |
| `ShellDiagnostic` | `ShellDiagnostic`, `ShellDiagnosticCode` | `code`, `offset`, `length`, a derived `message`; the `offset`/`length` pair satisfies `@effected/source`'s `SourceRange`. |
| `ShellCommand` | `ShellCommand` | `segment`, `name: Option<string>`, `args`, `wrappers`, `evaluated` (the words of every `[[ … ]]` and `((…))` the segment evaluates, skipped or named); `ShellCommand.fromSegment(segment)` unwraps `sudo`, `env`, `command`, `exec`, `nohup` and `time` (matched by last path segment), and skips the words that name no command: reserved words (`!`, `{`, `}`, `if`, `then`, `elif`, `else`, `fi`, `do`, `done`, `while`, `until`, `esac`, `coproc`), `[[ … ]]`, `((…))`, `for`/`select NAME` before `do` or `{`, `function NAME`, and assignments. |

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

Any `$` or backtick that reaches `${…}`, an arithmetic expression or a
subscript (an array value's `[key]=` included) quoted or escaped records
`QuotedSubstitutionInExpansion`, whatever follows it: in a `'…'` run, in a
`$'…'` run after decoding, as a literal `$` in a `"…"` run directly inside the
frame (`"$"`, `"a$"`, not the `$` of `"$HOME"` or `"$$"`), or after a
backslash (`\$`, `` \` ``). So does a bare `$` before an escaped `(` or
backtick (`x=([$\(cmd\)]=1)`, where removing the backslash leaves `$(`;
`$\n` and a top-level `echo $\(cmd\)` run nothing). bash honours the
quoting while it finds the closer, then, in a double-quoted or heredoc
`${…}`, in any arithmetic and in an indexed array's key, removes it and
reads the text again, so the `$` joins whatever follows it, the next run
included: `echo "${x:-'$(cmd)'}"`, `"${x:-"$"(cmd)}"`,
`"${x:-$'\x24'(cmd)}"`, `x=(['$'(cmd)]=1)` and `x=([\$\(cmd\)]=1)` all run
`cmd`. The operator and quoting that keep the text literal
(`"${x//a/'$(cmd)'}"` runs nothing), and what the `$` joins, are not
modelled, so every such `$` is reported, and no substitution part is placed
for it. A quoted `$` inside an expansion is rare in real commands, and an
over-report beats a hide. A top-level word is not read again: `$'\x24(cmd)'`,
`"$""(cmd)"` and `\$'(cmd)'` keep the literal `$(cmd)` and nothing is
recorded.

Honouring the quote to find the closer is bash's default mode only. POSIX mode
(`set -o posix`, or an inherited `POSIXLY_CORRECT`) takes a `'` inside a
double-quoted `${…}` for an ordinary character, so in
`echo "${x:-'}"; cmd; echo "'}"` the first `}` closes the expansion and `cmd`
runs, where the default mode runs nothing. The nested scanner tracks, per frame,
whether it sits in double quotes or a heredoc body, and a run there whose text
the POSIX reading leaves unbalanced (a `}` or `]` it takes as the closer, or a
`"`, `${` or `$[` left open) records `QuotedCloserInExpansion`. A balanced run
(`'${y:-v}'`) reads the same in both modes and records nothing; arithmetic and
an unquoted `${…}` honour the quote in both modes.

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

Each wrapper's options are read as `getopt_long` reads them, from a table that
is the union of its implementations (GNU and BSD `env`, sudo 1.9, the `time`
reserved word and GNU and BSD `time`): a long option is its exact name or a
unique prefix of one (`env --unse X` is `--unset`), and an unknown option or an
ambiguous prefix (`env --i`) stops resolution with `name` `None`, since it may
take the word after it. `env` reads options up to `--` or its first other word,
then takes every word holding an `=` as an assignment (`env -- -x=1 git`,
`env =x git`); `sudo` reads one among its options, never one starting `/` or
`=` and never one right after an argv word that is exactly `--`, an option's
value included (`sudo /opt/x=1/git`, `sudo -- A=1 git` and
`sudo -p -- A=1 git` run that word, `sudo -p-- A=1 git` runs `git`), as its
`parse_args.c` `is_envar` and `got_end_of_args` read them. A word before it
that may expand to `--` (`sudo -p "$p" A=1 git`) names no command. Neither
does any word a wrapper steps over, an option's separate value or an
`env`/`sudo` `NAME=value` word, that may not reach it as exactly one argv
word: an unquoted expansion, brace or glob (`env -u $v git`, `env A=$v git`,
`sudo -u {root,x} git`), or a double-quoted `"$@"` or `"${a[@]}"`. bash
splits it, and the wrapper may run a word the analyzer never sees. A
double-quoted `"$v"` is one word and still unwraps.

`env` and `sudo` read their argv after quote removal, so `env "FOO=a b" git`
and `env "-i" git` unwrap; `time` is a reserved word, so only an unquoted
assignment follows it. A wrapper is recognized by its last path segment
(`/usr/bin/env`), while `name` stays as written. `command -v` and
`command -V` only look a name up, so they stop unwrapping and report
`command`. `env -S` splits a string into a command line this package does not
model, so it stops with `name` `None`. When a word in command position, or a
wrapper option, has no literal, resolution stops: `name` is `None` and `args`
are the words from that word on. A segment that runs no command (`fi`, `}`)
also has `name` `None`, but with no `args`, which is how a guard tells the two
apart. A segment whose only command is a `[[ … ]]` or `((…))` resolves to the
name `[[` or `((`, because bash evaluates it and evaluation can run a command
no substitution shows; run straight into `then` or `do`, it is skipped and the
command after it is the name. Either way its words are in `evaluated`, so a
guard refuses an arithmetic test by reading that list, never by scanning the
segment's words.

Nested commands are the caller's to inspect: `script.substitutions()` lists
every `$(…)`, backtick and `<(…)` / `>(…)` at this level, including those
inside double quotes, assignment values (an array value's elements are lexed
as words, and so are those of an assignment builtin's `declare -a x=(…)`
argument, which bash reads as a compound assignment only after a bare
`declare`, `typeset`, `local`, `export`, `readonly`, `alias`, `eval` or `let`
with no redirection since), braced parameter expansions, arithmetic, brace-expansion spans,
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

This was checked against GNU bash 5.3 only, with the reviewed shapes, every position of a backslash-newline in them, and a random differential fuzz. That is evidence, not proof: dash and zsh were not tested, and POSIX-mode bash only for the quote rule above. A guard must not treat `commands()` as a complete gate until these are closed. Three parser modes hide a command with no diagnostic: under `shopt -s extglob` (or an inherited `BASHOPTS`), `echo @(<<E)` and `cat <<E@(x)` read a heredoc bash does not; under `shopt -s expand_aliases` an alias body is never read (`alias c='git commit'`, then `c`); and POSIX mode is otherwise unchecked, except that it expands aliases in a non-interactive shell (`BASH_ALIASES[1]=cmd`, then `1` on the next line). So refuse `shopt`, `alias`, `set -o posix` and any write to `POSIXLY_CORRECT`, assignment tokens or not (`: ${POSIXLY_CORRECT:=1}`, `for POSIXLY_CORRECT in 1`, `select POSIXLY_CORRECT in 1`, `declare {POSIXLY_CORRECT,y}=1` each turned it on), which are reported as command names and assignments, and control the environment (an inherited `POSIXLY_CORRECT`, `BASHOPTS`, `SHELLOPTS` or `PS4`). `hash -p /path/cmd ls`, `enable -n printf` and a write to `BASH_CMDS` or `BASH_ALIASES` with any key, letter-free ones included (`BASH_CMDS[1]=/path/cmd; 1`, `BASH_CMDS=([1]=…)`), make a name run something else, the `alias` class: refuse them too (the README guard refuses any mention of `PS4`, `POSIXLY_CORRECT`, `BASH_CMDS` or `BASH_ALIASES` once quotes and backslashes are removed). A guard matches `joined`, never `raw`: the parse joins `\⏎` (`[\⏎[` is `[[`) but `raw` keeps it, so `[\⏎[ x -eq 0 ]]`, `(\⏎( x ))` and `$\⏎{!x}` slip past a pattern over `raw`. Text handed to another parser is not read: `eval`, `bash -c`, `source`, `xargs`, `find -exec` and `ssh` are reported as their own name, and so are argv wrappers `ShellCommand` does not unwrap (`nice`, `timeout`, `stdbuf`, `setsid`, `doas`, `chroot`, `builtin`). Nor is text bash evaluates as arithmetic, a name or a prompt, where a quoted `'a[$(cmd)]'`, or a variable holding one, runs `cmd` (each checked under bash 5.3): `let`, `trap`, `read`, `declare -i` / `typeset -i` / `local -i` / `export -i` / `readonly -i`, a nameref (`declare -n`) and later assignments to an integer variable, a subscripted name given to `declare` / `typeset` / `local` with any options (`declare 'a[$(cmd)]=1'`, or a name a variable supplies, `declare "$x"`; `export` and `readonly` run nothing for it), `printf -v`, `[ -v` and `test -v`, `[[ … ]]` with an arithmetic test (`-eq -ne -lt -le -gt -ge`, bare names included) or `-v`, `(( … ))` / `$(( … ))` / `$[ … ]` / `for (( … ))` over a variable, a variable as a subscript, array-literal key, substring offset or length, or indirection (`${a[x]}`, `a[x]=2`, `a=([x]=1)`, `${a:x}`, `${@:x}`, `${a[@]:x}`, `${s: -x}`, `${!x}`, special parameters too: `${-:x}`, `${?:x}`, `${$:x}`, `${#:x}`), `${x@P}` and `PS4` under xtrace (`PS4='$(cmd)'; set -x; :`, also `set -o xtrace`, `shopt -so xtrace`, `bash -x`), and an indexed array's key over a name in an assignment builtin's array value (`declare -a x=([k]=1)`, `declare x=(…)`, `export x=(…)`, where the unquoted literal `declare -A h=([k]=1)` evaluates nothing, though an `-A` after the value does not count), and a quoted, escaped or expanded value the builtin re-reads as an array when its target is one, `local` included when the name is already a local array in the same function (`declare -a 'x=($(cmd))'`, `v='($(cmd))'; declare -a x="$v"`, `x=(); declare x='($(cmd))'`), which the parse cannot see because the text is quoted. A guard must refuse these by name, as the README guard does, reading `[[ … ]]` and `((…))` from `ShellCommand.evaluated`. The segmenter also splits a `[[ … ]]` on `&&`, `||` and `(`, so its operands surface as fake command names in later segments (`[[ 0 == 1 || 'a[$(cmd)]' -eq 0 ]]` names `a[$(cmd)]`): the README guard follows a `[[` to its unquoted `]]` across segments. An option a variable supplies (`[ "$op" x ]`) is read only at run time. A script with any diagnostic may hide a command (`x=$(echo a[ )` swallows the lines after it as one unterminated substitution), so treat every diagnostic as a refusal, as the README guard does.

[^issue-1204]: <https://github.com/spencerbeggs/effected/issues/1204>
[^systems-guard]: savvy-web/systems,
    `packages/silk-effects/src/commitlint/hook/parse-bash-command.ts`
[^bash-manual]: <https://www.gnu.org/software/bash/manual/bash.html>, sections
    3.1 (shell syntax), 3.5 (expansions) and 3.6 (redirections)
[^owner]: The owner ruled on 2026-11-06 for a new pure `@effected/shell`
    package with `effect` as its only peer, leaving `@effected/commands`
    unchanged on this branch.
