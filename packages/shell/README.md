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
import type { ShellCommand, ShellScript, ShellWord } from "@effected/shell";
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

// bash evaluates what these read as arithmetic or code, where a quoted
// 'a[$(cmd)]', or a variable holding one, still runs cmd. The parse cannot see
// inside that evaluation, so refuse them (see "Known limits").
const ARITHMETIC_TESTS: ReadonlySet<string> = new Set(["-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-v"]);
// Arithmetic over a name; `${!x}`, `${x@P}` and a subscript over one; and a
// substring offset or length over one, special parameters included (`${s:x}`,
// `${@:x}`, `${-:x}`, `${a[@]: -x}`), which the `:-`, `:=`, `:?` and `:+`
// operators are not.
const EVALUATES_A_NAME =
  /(?:\$\(\(|\$\[|\(\()[^A-Za-z_]*[A-Za-z_]|\$\{(?:!|[^}]*@P|(?:[@*#?$!0-9-]|\w+(?:\[[^\]]*\])?):(?![-=?+])[^}]*[A-Za-z_$])/;
// A subscript over a name in a parameter expansion (`${a[x]}`, `${#a[x]}`),
// read to its matching `]` at any nesting depth (`${a[0[0]+x]}`).
const expandsASubscriptOverAName = (text: string): boolean => {
  for (const match of text.matchAll(/\$\{#?\w*\[/g)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
      const c = text[i] as string;
      if (c === "[") depth += 1;
      else if (c === "]") {
        depth -= 1;
        if (depth === 0) break;
      } else if (/[A-Za-z_$]/.test(c)) return true;
    }
  }
  return false;
};
// A subscript over a name: in an assignment's name, or an array literal's key
// (`a=([x]=1)`): a letter, `_` or `$` anywhere inside `[ … ]`, at any nesting
// depth, so `a=([1[0]+x]=1)` counts as well.
const subscriptOverAName = (text: string): boolean => {
  let depth = 0;
  for (const c of text) {
    if (c === "[") depth += 1;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (depth > 0 && /[A-Za-z_$]/.test(c)) return true;
  }
  return false;
};
// Commands that change how bash parses or what a name runs, and commands that
// run a command they are given (unmodelled wrappers among them).
const REFUSED_COMMANDS: ReadonlySet<string> = new Set([
  "shopt", "alias", "hash", "enable", "builtin", "eval", "source", ".", "bash", "sh",
  "su", "ssh", "xargs", "nice", "timeout", "stdbuf", "setsid", "doas", "chroot",
]);
// PS4 is prompt-expanded before every command xtrace traces; POSIXLY_CORRECT
// switches the parser to POSIX mode, which also expands aliases; BASH_ALIASES
// and BASH_CMDS are the alias and command-hash tables, so a write to either
// makes a name run something else. `${NAME:=…}`, `for NAME` and a brace word
// write them with no assignment token, so refuse any mention of one, read with
// quotes and backslashes removed (`POSIX''LY_CORRECT` is the same name).
const REFUSED_VARIABLE = /(?<!\w)(?:PS4|POSIXLY_CORRECT|BASH_ALIASES|BASH_CMDS)(?!\w)/;

// bash removes a backslash-newline before it reads a token, so every text test
// reads the text joined. Removing one inside single quotes only adds matches.
const joined = (text: string): string => text.replaceAll("\\\n", "");

// The name an assignment builtin's argument assigns, as written before its
// first `=`; `null` when a variable, a substitution or a brace may supply it.
const assignedName = (word: ShellWord): string | null => {
  const literal = Option.getOrNull(word.literal);
  if (literal !== null) return literal.split("=", 1)[0] ?? "";
  const head = word.raw.split("=", 1)[0] ?? "";
  return /[$`{]/.test(head) ? null : head.replace(/["'\\]/g, "");
};

// `[[ … ]]` is split into segments on `&&`, `||` and `(`, so a test can sit in
// a later segment than its `[[`: follow it across them by the unquoted words.
const arithmeticTest = (script: ShellScript): boolean => {
  let inTest = false;
  for (const segment of script.segments) {
    for (const word of segment.words) {
      const raw = joined(word.raw);
      if (raw === "[[") inTest = true;
      else if (raw === "]]") inTest = false;
      else if (inTest && ARITHMETIC_TESTS.has(Option.getOrElse(word.literal, () => ""))) return true;
    }
  }
  return false;
};

const evaluatesText = (script: ShellScript, command: ShellCommand): boolean => {
  const { segment } = command;
  const texts = [
    ...segment.words.map((word) => word.raw),
    ...segment.assignments.map((assignment) => assignment.raw),
    ...segment.redirections.map(({ target }) =>
      target.kind === "heredoc" ? (target.quoted ? "" : target.body) : target.raw,
    ),
  ].map(joined);
  if (texts.some((text) => EVALUATES_A_NAME.test(text) || expandsASubscriptOverAName(text))) return true;
  if (texts.some((text) => REFUSED_VARIABLE.test(text.replace(/["'\\]/g, "")))) return true;
  for (const { name, value } of segment.assignments) {
    if (subscriptOverAName(name)) return true;
    if (value.raw.startsWith("(") && subscriptOverAName(value.raw)) return true;
  }
  const name = Option.getOrUndefined(command.name);
  const base = name?.slice(name.lastIndexOf("/") + 1);
  if (base !== undefined && REFUSED_COMMANDS.has(base)) return true;
  const args = command.args.map((word) => Option.getOrNull(word.literal));
  // `declare x=( … )`: the parse splits an array value off as a subshell.
  const arrayValue = command.args.some((word) => script.source[word.end] === "(");
  // What an assignment builtin's arguments assign, past its options.
  const assigned = command.args
    .filter((word) => !/^[-+]/.test(Option.getOrElse(word.literal, () => "")))
    .map(assignedName);
  switch (base) {
    case "let":
    case "read":
    case "trap":
      return true;
    case "declare":
    case "typeset":
    case "local":
      // These evaluate a subscript in the name they assign: `declare 'a[$(cmd)]=1'`.
      return (
        arrayValue ||
        args.some((arg) => arg !== null && /^[-+][A-Za-z]*[in]/.test(arg)) ||
        assigned.some((assignee) => assignee === null || assignee.includes("["))
      );
    case "export":
    case "readonly":
      return arrayValue || assigned.some((assignee) => assignee === null);
    case "set":
      // Turning on xtrace (PS4 may be inherited) or POSIX mode.
      return args.some((arg) => arg === null || /^-[A-Za-z]*x/.test(arg) || arg === "xtrace" || arg === "posix");
    case "printf":
      return args[0]?.startsWith("-v") === true;
    case "test":
    case "[":
      return args.includes("-v");
    case "find":
      return args.some((arg) => arg === null || /^-(?:exec|execdir|ok|okdir)$/.test(arg));
    default:
      return false;
  }
};

// Refuse a commit, and refuse anything the guard cannot vouch for.
const refuses = (script: ShellScript, depth = 0): boolean => {
  if (script.diagnostics.length > 0 || arithmeticTest(script)) return true;
  for (const command of script.commands()) {
    // No name WITH args is a command it cannot name (`$GIT commit`, or a
    // wrapper option it does not know). No name and no args is a segment that
    // runs nothing, such as `fi`.
    if (Option.isNone(command.name) && command.args.length > 0) return true;
    if (evaluatesText(script, command)) return true;
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

`commands()` resolves each segment. It skips the words that name no command: reserved words (`if`, `then`, `!`, `{`, `coproc` and the rest), a whole `[[ … ]]`, the arithmetic command `(( … ))`, `for NAME` before `do`, `function NAME`, and assignments, because bash lets `if [[ 1 ]] then git commit; fi` run `git` with no separator. When a `[[ … ]]` or `(( … ))` is the whole command, as in `[[ -n $x ]]` or `for ((i = 0; i < n; i++))`, it is the name: `[[` or `((`, since bash evaluates it. It then unwraps `sudo`, `env`, `command`, `exec`, `nohup` and `time` with their options, so `sudo -u root env "FOO=a b" git commit` resolves to `git` with `wrappers: ["sudo", "env"]`; a wrapper is matched by its last path segment, so `/usr/bin/env` unwraps too. Long options resolve by unique prefix, as `getopt_long` reads them (`env --unse FOO git` is `--unset`), and an option the wrapper's table does not know, or an ambiguous prefix, stops resolution with no name, because it may take the word after it. `env` reads options up to `--` or its first other word, and from there every word holding an `=` is an assignment (`env -- -x=1 git`, `env =x git`). `sudo` reads one among its options, never one starting `/` or `=`, and never one right after an argv word that is exactly `--`, an option's value included, as its `parse_args.c` does: `sudo A=1 -u root git` and `sudo -p-- A=1 git` run `git`, but `sudo /opt/x=1/git`, `sudo =x`, `sudo -- A=1 git` and `sudo -p -- A=1 git` run that word. A word before it that may expand to `--` (`sudo -p "$p" A=1 git`) resolves to `None`. So does any word a wrapper steps over, an option's separate value or an `env`/`sudo` `NAME=value` word, that may not reach it as exactly one argv word: an unquoted expansion, brace or glob (`env -u $v git`, `env A=$v git`, `sudo -u {root,x} git`, `exec -a $v git`), or a double-quoted `"$@"` or `"${a[@]}"`. bash splits it, so `env -u $v git status` runs `c1` when `v` is `X c1`. A double-quoted `"$v"` is one word, so `env -u "$v" git` still resolves to `git`. A command name that is not a literal (`$GIT commit`) resolves to `None` with the words as `args`. The guard above is pinned by the package's own tests against every bypass shape they hold. A real guard also refuses, or interprets, commands that run a command string, such as `bash -c`, `eval`, `su -c` and `xargs`, and the argv wrappers this package does not unwrap: `nice`, `timeout`, `stdbuf`, `setsid`, `doas`, `chroot`, `builtin` and the like (`ionice`, `taskset`, `flock`, `unbuffer`, `runuser`). Each of those is reported as the command name, with the command it runs among its `args`. The guard above refuses a short list of them by name; a real one needs the full list for the platforms it runs on.

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
- **Fails closed.** Where the grammar is not modelled (`[[ … ]]`, `case` patterns, function bodies), the segmenter over-splits, reporting a command the shell might not run rather than hiding one. It never reads a heredoc that may not be there. `<<` is a shift in every arithmetic context: `(( … ))`, `$(( … ))`, the legacy `$[ … ]`, and the `[ … ]` subscript of a command-position word that starts `NAME[`, which bash reads as a matched pair with or without an `=` after it. So `(( x = 1 << 2 ))`, `echo $[1 << 2]` and `a[1 << 2]=x` hide no line after them, and a `#` inside a subscript starts no comment. Inside `$( … )` a subscript is read at every word start, not only in command position, which can only over-report. Command position follows bash's own rule, so `a[$(x)]=1 b[1<<2]=y`, `time -p a[1<<2]=x`, `function f { a[1<<2]=x` and `if [[ x ]] then a[1<<2]=x` hide nothing either. A backslash-newline is gone before any token is read, as in bash: `a\⏎[`, `$\⏎[`, `(\⏎(`, `<\⏎<` and a delimiter line written `E\⏎ND` all mean what they mean joined; a backslash before a CRLF escapes the CR, so the LF still ends the command. A heredoc delimiter holding a `$(`, `$((`, `$[`, `${`, backtick, `<(` or `>(` reads no body and records `ExpansionInHeredocDelimiter`, because bash rebuilds a `$( … )` from its parse and the delimiter line cannot be known. Any `$` or backtick that reaches a `${ … }`, an arithmetic expression or a subscript quoted or escaped records `QuotedSubstitutionInExpansion`, whatever follows it: in a `'…'` run, in a `$'…'` run after decoding, as a literal `$` in a `"…"` run (`"$"`, not the `$` of `"$HOME"`), or after a backslash (`\$`), and so does a bare `$` before an escaped `(` or backtick (`$\(`), since removing the backslash leaves `$(`. `$$` and the other special parameters are expansions, not literal `$`s. bash honours that quoting to find the closer, then, inside a double-quoted or heredoc `${ … }`, in arithmetic and in an indexed array's key, removes it and reads the text again, so the `$` joins whatever follows it: `echo "${x:-'$(cmd)'}"`, `echo "${x:-"$"(cmd)}"`, `"${x:-$'\x24(cmd)'}"`, `(( '$(cmd)' ))`, `x=(['$'(cmd)]=1)` and `x=([\$\(cmd\)]=1)` run `cmd`. Which operator and quoting keep the text literal (`"${x//a/'$(cmd)'}"` runs nothing), and what the `$` joins, are not modelled, so every such `$` is reported and no substitution part is placed for it. A quoted `$` inside an expansion is rare in real commands, so the over-report costs little. A top-level word is not read again: `$'\x24(cmd)'`, `"$""(cmd)"` and `\$'(cmd)'` stay the literal `$(cmd)`. Honouring those quotes to find the closer is bash's default mode: POSIX mode (`set -o posix`, or an inherited `POSIXLY_CORRECT`) takes a `'` inside a double-quoted `${ … }` for an ordinary character, so in `echo "${x:-'}"; cmd; echo "'}"` the first `}` closes the expansion and `cmd` runs, where the default mode runs nothing. A run inside a double-quoted or heredoc expansion whose text that reading would not leave balanced (a `}` or `]` it takes as the closer, or a `"`, `${` or `$[` left open) records `QuotedCloserInExpansion`; a balanced run such as `'${y:-v}'` reads the same in both modes and records nothing. A metacharacter inside `x=( … )` is a syntax error after which bash discards that line and runs the next, so the array ends at that newline with a diagnostic. A CRLF line break counts as a line break for the same reason. A script records at most 1000 diagnostics, then one `DiagnosticLimitReached`.
- **Not an execution vocabulary.** The result types are deliberately not core `CommandLine`'s, so analyzer output cannot be handed straight to a spawner. Validate, then build what you run with `CommandLine`.

Commands that take a command string (`bash -c`, `eval`, `xargs`, `find -exec`, `ssh`) are reported as their own name; interpreting their arguments is the caller's job.

### Known limits

This was checked against GNU bash 5.3 only, with the reviewed shapes, every position of a backslash-newline in them, and a random differential fuzz. That is evidence, not proof. dash and zsh were not tested, and POSIX-mode bash only for the quote rule above. A guard must not treat `commands()` as a complete gate until these are closed. Three parser modes hide a command with no diagnostic:

- Under `shopt -s extglob` (or an inherited `BASHOPTS`), `echo @(<<E)` and `cat <<E@(x)` read a heredoc bash does not.
- Under `shopt -s expand_aliases`, an alias body is never read (`alias c='git commit'`, then `c`).
- POSIX mode (`set -o posix`, or an inherited `POSIXLY_CORRECT`) was checked only for the quote rule above. It also expands aliases in a non-interactive shell, so `BASH_ALIASES[1]=cmd` on one line and `1` on the next runs `cmd` with no `alias` command anywhere.

So refuse `shopt`, `alias`, `set -o posix` and any write to `POSIXLY_CORRECT`, and control the environment, which an inherited `POSIXLY_CORRECT` or `BASHOPTS` belongs to. Not every write is an assignment token: `: ${POSIXLY_CORRECT:=1}`, `for POSIXLY_CORRECT in 1`, `select POSIXLY_CORRECT in 1` and a brace word such as `declare {POSIXLY_CORRECT,y}=1` (or `{POSIX''LY_CORRECT,y}`) each turned POSIX mode on under bash 5.3, so the guard above refuses any word that mentions the name once its quotes and backslashes are removed. A name can also be made to run something else: `hash -p /path/to/cmd ls` makes `ls` run `cmd`, `enable -n printf` makes `printf` run the first `printf` on `PATH`, and a write to `BASH_CMDS` (the table `hash -p` writes) or `BASH_ALIASES` (the alias table) does the same with any key, one with no letter included: `BASH_CMDS[1]=/path/to/cmd; 1` runs `cmd`, and so do `BASH_CMDS+=([1]=…)` and `BASH_CMDS=([1]=…)`. These are reported as `hash`, `enable` or an assignment, then the rebound name, so refuse them beside `alias`: the guard above refuses any mention of `BASH_CMDS` or `BASH_ALIASES`.

A guard that matches `raw` text must remove each backslash-newline first, as bash does before it reads a token. The parse already joins them (`[\⏎[` resolves to `[[`), but `raw` keeps them, so `[\⏎[ x -eq 0 ]]`, `(\⏎( x ))`, `$\⏎{!x}` and `"${y@\⏎P}"` slip past a pattern that reads `raw` as written. The guard above reads every text joined.

Text handed to another parser is not read: `eval`, `bash -c`, `source`, `xargs`, `find -exec` and `ssh` are reported as their own name. Nor is text bash evaluates as arithmetic, a name or a prompt, where a quoted `'a[$(cmd)]'`, or a variable holding one, runs `cmd`. Each of these ran `cmd` under bash 5.3, and a guard must refuse them, as the one above does:

- `let 'a[$(cmd)]'`, `trap 'cmd' EXIT` and `read 'a[$(cmd)]'`.
- `declare -i v='a[$(cmd)]'`, likewise `typeset -i` and `local -i`, a nameref (`declare -n r='a[$(cmd)]'`), and any later assignment to an integer variable.
- A subscripted name given to `declare`, `typeset` or `local`, with any options: `declare 'a[$(cmd)]=1'`, `declare -g "a[\$(cmd)]=1"`, `declare a\[\$\(cmd\)\]=1`, `declare "a[x]=1"` over `x='a[$(cmd)]'`, and a name a variable supplies (`declare "$x"`, `declare "$x=1"`). `export` and `readonly` run nothing for the same word.
- `printf -v 'a[$(cmd)]' %s 1`, `[ -v 'a[$(cmd)]' ]` and `test -v 'a[$(cmd)]'`.
- `[[ 'a[$(cmd)]' -eq 0 ]]` and the other arithmetic tests (`-ne`, `-lt`, `-le`, `-gt`, `-ge`), bare names included (`[[ x -eq 0 ]]`), and `[[ -v 'a[$(cmd)]' ]]`. This parse splits a `[[ … ]]` into segments on `&&`, `||` and `(`, so an operand can surface as a fake command name in a later segment: `[[ 0 == 1 || 'a[$(cmd)]' -eq 0 ]]` reports the commands `[[` and `a[$(cmd)]`. A guard must follow a `[[` to its unquoted `]]` across segments, as the one above does.
- Arithmetic over a variable: `x='a[$(cmd)]'`, then `(( x ))`, `$(( x ))`, `$(( $x ))`, `$[ x ]` or `for ((i = x; …))`.
- A variable as a subscript, an array literal's key, a substring offset or length, or an indirection: `${a[x]}`, `a[x]=2`, `a=([x]=1)`, `a+=([$x]=1)`, `${a:x}`, `${@:x}`, `${a[@]:x}`, `${s: -x}`, `${s:0:-x}`, `${!x}`, and a special parameter's substring (`${-:x}`, `${?:x}`, `${$:x}`, `${#:x}`).
- Prompt expansion. One form is `x='$(cmd)'`, then `"${x@P}"`. Another is `PS4`, which bash expands before every command that xtrace traces: `PS4='$(cmd)'; set -x; :`, likewise `set -o xtrace`, `shopt -so xtrace` and `bash -x`, or an inherited `PS4` or `SHELLOPTS`. The guard above refuses both halves, turning xtrace on and any mention of `PS4`.
- An assignment builtin's array value, `declare -a x=(['$(cmd)']=1)`, likewise `export` and `readonly`. This parse splits the value off as a subshell, so even `declare -A h=([k]=1)`, which runs nothing, leaves a segment the guard cannot name.

`[[ … ]]` and `(( … ))` resolve to the names `[[` and `((` when they are the whole command, so a refusal list can match them. Run straight into `then` or `do` in one segment, they resolve to the command after them, so read the segment's words for them too. An option or operator a variable supplies (`[ "$op" x ]`, `declare "$o" v=…`) is read only when bash runs the command, so a guard that matches the literal forms must also refuse those. A script with any diagnostic may hide a command (`x=$(echo a[ )` swallows the lines after it as one unterminated substitution), so treat every diagnostic as a refusal, as the guard above does.

## License

[MIT](./LICENSE)
