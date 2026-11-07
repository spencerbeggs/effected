# @effected/shell

[![npm](https://img.shields.io/npm/v/@effected%2Fshell?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/shell)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

A tolerant shell-syntax lexer and segmenter for guards and agent tooling. It answers one question about an untrusted command string: which simple commands would this run, and with which words? Nothing is expanded and nothing is executed, and the parse never fails.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, still in `0.x`
> development. It peers on `effect` and has no other dependency.
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/shell

An agent hook that inspects a Bash tool call before it runs has to find every command in the string, not just the first one. Splitting with a general-purpose tokenizer and reading the first words misses `git add -A && git commit -m "…"`, so the guard never sees the commit. Reading a word as a literal when the shell would expand it is the other way to fall open: `git {commit,}` runs `git commit`.

This package segments a command string on its control operators, records how every word is quoted, marks every expansion instead of performing it, and skips heredoc bodies so the text inside one is never read as commands. Input it cannot finish becomes an opaque part and a diagnostic, never an exception.

## Install

```bash
npm install @effected/shell effect
```

```bash
pnpm add @effected/shell effect
```

Requires Node.js >=24.11.0. `effect` is a peer dependency. ESM-only: import it from an ES module.

## Usage

### A guard that sees every command

```ts
import { ShellSyntax } from "@effected/shell";
import type { ShellCommand, ShellScript } from "@effected/shell";
import { Option } from "effect";

const MAX_DEPTH = 8;

// git's global options that take a separate argument: `git -C dir commit`.
const GIT_OPTIONS_WITH_ARGUMENT: ReadonlySet<string> = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
]);

// git's subcommand; `undefined` for another command, `null` when unreadable.
const gitSubcommand = (command: ShellCommand): string | null | undefined => {
  const name = Option.getOrUndefined(command.name);
  // `name` is as written: compare its last path segment, so /usr/bin/git counts.
  if (name === undefined || name.slice(name.lastIndexOf("/") + 1) !== "git") return undefined;
  const args = command.args.map((word) => Option.getOrNull(word.literal));
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || arg === null) return null;
    if (GIT_OPTIONS_WITH_ARGUMENT.has(arg)) i += 1;
    else if (!arg.startsWith("-")) return arg;
  }
  return undefined;
};

// Refuse a commit, and refuse anything the guard cannot vouch for.
const refuses = (script: ShellScript, depth = 0): boolean => {
  if (script.diagnostics.length > 0) return true;
  for (const command of script.commands()) {
    // No name WITH args is a command it cannot name (`$GIT commit`). No name
    // and no args is a segment that runs nothing, such as `fi` or `(( n > 1 ))`.
    if (Option.isNone(command.name) && command.args.length > 0) return true;
    const subcommand = gitSubcommand(command);
    if (subcommand === null || subcommand === "commit") return true;
  }
  const nested = script.substitutions();
  // Too deep to check is a refusal, never a silent pass.
  if (nested.length > 0 && depth >= MAX_DEPTH) return true;
  return nested.some((part) => refuses(ShellSyntax.parse(part.body), depth + 1));
};

console.log(refuses(ShellSyntax.parse('git add -A && git commit -m "feat: x"')));
// => true
console.log(refuses(ShellSyntax.parse("if git diff --quiet; then git status; fi")));
// => false
```

`commands()` resolves each segment. It skips the words that name no command: reserved words (`if`, `then`, `!`, `{`, `coproc` and the rest), a whole `[[ … ]]`, the arithmetic command `(( … ))`, `for NAME` before `do`, `function NAME`, and assignments, because bash lets `if [[ 1 ]] then git commit; fi` run `git` with no separator. It then unwraps `sudo`, `env`, `command`, `exec`, `nohup` and `time` with their options, so `sudo -u root env "FOO=a b" git commit` resolves to `git` with `wrappers: ["sudo", "env"]`; a wrapper is matched by its last path segment, so `/usr/bin/env` unwraps too. A command name that is not a literal (`$GIT commit`) resolves to `None` with the words as `args`. The guard above is pinned by the package's own tests against every bypass shape they hold. A real guard also refuses, or interprets, commands that run a command string, such as `bash -c`, `eval` and `xargs`.

### Words, quoting and literals

```ts
import { ShellSyntax } from "@effected/shell";
import { Option } from "effect";

const [segment] = ShellSyntax.parse(`FOO=1 git commit -m "fix: $(date)" > log.txt`).segments;

segment?.assignments.map((a) => [a.name, a.value.raw]);
// => [ [ 'FOO', '1' ] ]
segment?.words.map((w) => Option.getOrNull(w.literal));
// => [ 'git', 'commit', '-m', null ]
segment?.words[3]?.parts.map((p) => p.kind);
// => [ 'doubleQuoted' ]
segment?.redirections.map((r) => [r.operator, r.target.kind === "word" ? r.target.raw : "heredoc"]);
// => [ [ '>', 'log.txt' ] ]
```

`ShellWord.literal` is `Some` only when the shell would pass the word unchanged: every part bare, single-quoted, ANSI-C quoted (decoded), or double-quoted with no expansion inside.

### A commit message from a heredoc

```ts
import { ShellSyntax } from "@effected/shell";

const script = ShellSyntax.parse(`git commit -m "$(cat <<'EOF'
feat: add x

It's done.
EOF
)"`);

const [substitution] = script.substitutions();
const nested = ShellSyntax.parse(substitution?.body ?? "");
console.log(JSON.stringify(nested.segments[0]?.heredocs[0]?.body));
// => "feat: add x\n\nIt's done.\n"
```

### Tracing

`ShellSyntax.parseEffect(input)` is `parse` behind the `ShellSyntax.parseEffect` span. Its error channel is `never`.

## API

| Export | What it is |
| --- | --- |
| `ShellSyntax` | `parse(input): ShellScript`, total and synchronous; `parseEffect(input)`, the same behind a span. |
| `ShellScript` | `source`, `segments`, `comments`, `diagnostics`; `commands()` and `substitutions()`. |
| `ShellSegment`, `ShellOperator` | One simple command: `words`, `assignments`, `redirections`, `operator: Option<ShellOperator>` (`&&`, `\|\|`, `;`, `;;`, `;&`, `;;&`, `\|`, `\|&`, `&`, `"newline"`), `groupDepth`, `start`, `end`; the `heredocs` getter. |
| `ShellWord` | `start`, `end`, `raw`, `parts`, and `literal: Option<string>`. |
| `ShellWordPart` and its twelve classes | `bare`, `singleQuoted`, `doubleQuoted` (with `expansions`), `ansiC`, `variable`, `commandSubstitution`, `arithmetic` (`$(( … ))` and `$[ … ]`; `command` is `true` for a `(( … ))` command), `processSubstitution`, `glob`, `brace`, `tilde`, `opaque`, discriminated on `kind`. `variable`, `arithmetic`, `brace` and `opaque` carry the `substitutions` inside them. `ShellExpansionPart` is the variable / substitution / arithmetic union; `ShellSubstitutionPart` the command / process substitution union. A backtick substitution's `body` is the text after bash's escape removal, which is what bash runs. |
| `ShellAssignment` | `name`, `append`, `value: ShellWord`, `start`, `end`, `raw`. |
| `ShellRedirection`, `ShellRedirectionOperator` | `fd: Option<number>`, `operator`, `target: ShellWord \| ShellHeredoc`, `start`, `end`. `2>&1` is `fd` 2, operator `>&`, target `1`. |
| `ShellHeredoc` | `delimiter`, `quoted`, `stripTabs`, `body`, `start`, `end`, `terminated`, `expansions`; `text` strips `<<-` tabs. |
| `ShellComment` | `text`, `start`, `end`. |
| `ShellDiagnostic`, `ShellDiagnosticCode` | `code`, `offset`, `length`, and a derived `message`. |
| `ShellCommand` | `segment`, `name`, `args`, `wrappers`; `ShellCommand.fromSegment(segment)`, `wrapperNames`, `reservedWords`. |

Every offset is a UTF-16 index into `ShellScript.source`. To turn one into a line and character, use `@effected/source`'s `LineIndex`.

## The contract

- **Never evaluates.** No variable, tilde, brace, glob, arithmetic or command-substitution expansion, and no execution. An expansion is a marked part with its span, and its body is opaque text.
- **Never fails.** `parse` returns for every string, in time linear in its length, and never throws. An unterminated quote, substitution or heredoc becomes an `opaque` part running to the end of the input, plus a `ShellDiagnostic`.
- **Fails closed.** Where the grammar is not modelled (`[[ … ]]`, `case` patterns, function bodies), the segmenter over-splits, reporting a command the shell might not run rather than hiding one. It never reads a heredoc that may not be there. `<<` is a shift in every arithmetic context: `(( … ))`, `$(( … ))`, the legacy `$[ … ]`, and the `[ … ]` subscript of a command-position word that starts `NAME[`, which bash reads as a matched pair with or without an `=` after it. So `(( x = 1 << 2 ))`, `echo $[1 << 2]` and `a[1 << 2]=x` hide no line after them, and a `#` inside a subscript starts no comment. Inside `$( … )` a subscript is read at every word start, not only in command position, which can only over-report. Command position follows bash's own rule, so `a[$(x)]=1 b[1<<2]=y`, `time -p a[1<<2]=x`, `function f { a[1<<2]=x` and `if [[ x ]] then a[1<<2]=x` hide nothing either. A backslash-newline is gone before any token is read, as in bash: `a\⏎[`, `$\⏎[`, `(\⏎(`, `<\⏎<` and a delimiter line written `E\⏎ND` all mean what they mean joined; a backslash before a CRLF escapes the CR, so the LF still ends the command. A heredoc delimiter holding a `$(`, `$((`, `$[`, `${`, backtick, `<(` or `>(` reads no body and records `ExpansionInHeredocDelimiter`, because bash rebuilds a `$( … )` from its parse and the delimiter line cannot be known. A metacharacter inside `x=( … )` is a syntax error after which bash discards that line and runs the next, so the array ends at that newline with a diagnostic. A CRLF line break counts as a line break for the same reason. A script records at most 1000 diagnostics, then one `DiagnosticLimitReached`.
- **Not an execution vocabulary.** The result types are deliberately not core `CommandLine`'s, so analyzer output cannot be handed straight to a spawner. Validate, then build what you run with `CommandLine`.

Commands that take a command string (`bash -c`, `eval`, `xargs`, `find -exec`, `ssh`) are reported as their own name; interpreting their arguments is the caller's job.

### Known limits

This was checked against GNU bash 5.3 only, with the reviewed shapes, every position of a backslash-newline in them, and a random differential fuzz. That is evidence, not proof, and dash, zsh and POSIX-mode bash were not tested. A guard must not treat `commands()` as a complete gate until these are closed. Two parser modes hide a command with no diagnostic: under `shopt -s extglob` (or an inherited `BASHOPTS`), `echo @(<<E)` and `cat <<E@(x)` read a heredoc bash does not, and under `shopt -s expand_aliases` an alias body is never read (`alias c='git commit'`, then `c`). So refuse `shopt` and `alias`, which are reported as command names, and control the environment. Text handed to another parser is not read: `eval`, `bash -c`, `source`, `xargs`, `find -exec` and `ssh` are reported as their own name. A script with any diagnostic may hide a command (`x=$(echo a[ )` swallows the lines after it as one unterminated substitution), so treat every diagnostic as a refusal, as the guard above does.

## License

[MIT](./LICENSE)
