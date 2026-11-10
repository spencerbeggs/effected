# @effected/shell

A tolerant shell-syntax lexer and segmenter for guards and agent tooling. It answers one question about an untrusted command string: **which simple commands would this run, and with which words?** Nothing is expanded, nothing is executed, and the parse never fails. Pure tier: `effect` is the only peer, with no runtime dependency, no `node:` import, no service and no layer.

Reach for it in an agent hook, an MCP tool or any guard that inspects a Bash command before it runs, instead of `shell-quote` or a regex. Splitting with a tokenizer and reading the first words misses `git add -A && git commit -m "…"`, so the guard never sees the commit; reading a word as literal when the shell would expand it falls open on `git {commit,}`, which runs `git commit`. The result types are deliberately not core `CommandLine`'s, so analyzer output cannot be handed straight to a spawner: validate, then build what you run with `CommandLine`, and `@effected/commands` for the outcome and policy.

## Import

```ts
import { ShellCommand, ShellDiagnostic, ShellScript, ShellSegment, ShellSyntax, ShellWord } from "@effected/shell";
import { ShellCommandWalk, ShellNestedScript, ShellTruncation } from "@effected/shell";
import { ShellAssignment, ShellComment, ShellHeredoc, ShellRedirection } from "@effected/shell";
import { ShellOperator, ShellRedirectionOperator, ShellDiagnosticCode, ShellWordPart, ShellExpansionPart, ShellSubstitutionPart } from "@effected/shell";
```

The twelve part classes are exported by name too (`ShellBarePart`, `ShellSingleQuotedPart`, `ShellDoubleQuotedPart`, `ShellAnsiCPart`, `ShellVariablePart`, `ShellCommandSubstitutionPart`, `ShellArithmeticPart`, `ShellProcessSubstitutionPart`, `ShellGlobPart`, `ShellBracePart`, `ShellTildePart`, `ShellOpaquePart`). There is no subpath.

## Core API

- **`ShellSyntax.parse(input)`** → `ShellScript`. Total and synchronous: a plain value, not a `Result`, in time linear in the input, and it never throws. **`ShellSyntax.parseEffect(input)`** → `Effect<ShellScript>` is the same behind a `ShellSyntax.parseEffect` span, with no failure channel.
- **`ShellScript`** — `source`, `segments`, `comments`, `diagnostics`; **`commands()`** → `ReadonlyArray<ShellCommand>` resolves each segment, **`substitutions()`** → `ReadonlyArray<ShellSubstitutionPart>` lists every `$(…)`, backtick and `<(…)` / `>(…)` at this level in source order, including those inside double quotes, assignment values, `${…}`, arithmetic, brace spans, opaque parts and unquoted heredoc bodies. **`allCommands({ maxDepth })`** → `ShellCommandWalk` parses each of those bodies, and the bodies inside them, down to `maxDepth` (default `ShellScript.defaultMaxDepth`, 16).
- **`ShellCommandWalk`** — `scripts` (a **`ShellNestedScript`** per distinct parsed body, breadth first: `depth`, `script`, `substitution: Option<ShellSubstitutionPart>`, `parent: Option<number>`; the top-level script is first at depth 0), `truncations` (a **`ShellTruncation`** per substitution the walk did not parse: `reason`, `"depth"` past the cap or `"budget"` past the walk's budget, and `depth`, `substitution`, `parent`), `maxDepth`, `truncated`, and `commands()` across every script. A body it did not parse is recorded, never dropped: refuse when `truncated` is `true`. Each nested script carries its own `diagnostics`. Each distinct substitution is parsed once, and the walk enforces its cost: body characters at most `maxDepth` times the input, at most 64 MiB (`ShellScript.walkCharacterLimit`) and 10,000 records, scripts and truncations together (`ShellScript.walkRecordLimit`), after which it records a `"budget"` truncation and stops. It keeps its work on a queue, not the call stack, and never throws; a `maxDepth` that is not a non-negative number reads as 0, and `Infinity` lifts the depth cap but not those limits.
- **`ShellSegment`** — one simple command: `words`, `assignments` (leading `FOO=1` prefixes), `redirections`, `operator: Option<ShellOperator>` (`&&`, `||`, `;`, `;;`, `;&`, `;;&`, `|`, `|&`, `&`, `"newline"`), `groupDepth` (parenthesis nesting), `start`, `end`, and a `heredocs` getter. `(` and `)` end a segment and move `groupDepth` without being operators.
- **`ShellWord`** — `start`, `end`, `raw`, `parts`, **`joined`** (`raw` with the backslash-newlines bash removes before tokenizing taken out; match patterns against it, never `raw`), and **`literal: Option<string>`**, `Some` only when the shell would pass the word unchanged: every part bare, single-quoted, ANSI-C quoted (decoded), or double-quoted with no expansion inside.
- **`ShellWordPart`** — twelve classes discriminated on `kind`: `bare`, `singleQuoted`, `doubleQuoted` (with `expansions`), `ansiC`, `variable`, `commandSubstitution`, `arithmetic` (`command` is `true` for a `(( … ))` command), `processSubstitution`, `glob`, `brace`, `tilde`, `opaque`. `variable`, `arithmetic`, `brace` and `opaque` carry the `substitutions` inside them. `ShellExpansionPart` is the variable / command substitution / arithmetic union; `ShellSubstitutionPart` the command / process substitution union, each with a `body` of opaque shell text.
- **`ShellCommand.fromSegment(segment)`** → `ShellCommand` (`segment`, `name: Option<string>`, `args`, `wrappers`, `evaluated`). Skips the words that name no command (reserved words, `for NAME` before `do`, `function NAME`, assignments), then unwraps `sudo`, `env`, `command`, `exec`, `nohup` and `time` with their options, so `sudo -u root env "FOO=a b" git commit` resolves to `git` with `wrappers: ["sudo", "env"]`. A `[[ … ]]` or `(( … ))` that is the whole segment resolves to the name `[[` or `((`, so a guard can refuse the ones bash evaluates as arithmetic (`[[ x -eq 0 ]]`, `(( x ))`); one that runs straight into `then` or `do` resolves to the command after it. Either way **`evaluated`** lists its words (`if [[ x -eq 0 ]] then git commit; fi` names `git` with `[[`, `x`, `-eq`, `0`, `]]` in `evaluated`), so a guard refuses arithmetic tests from that list rather than scanning the segment's words. Each wrapper's option table is the union of its implementations (GNU and BSD `env`, sudo, GNU and BSD `time`): a long option resolves by unique prefix as `getopt_long` does (`env --chd /tmp git` names `git`), and an unknown or ambiguous option stops with `name: None` rather than turning its argument into the command. So does any option value or `NAME=value` word the wrapper steps over that the shell could split into more words (an unquoted `$v`, `"$@"`, a brace or a `$(…)`: `sudo -u $u git` with `u='root rm'` runs `rm`), while `"$v"` stays resolved. `sudo` follows its own parser: a word starting with `/` or `=` is the command even if it holds `=`, and a `--` ends options even when it was an option's value. `ShellCommand.wrapperNames` and `ShellCommand.reservedWords` expose the two tables. **`assignmentBuiltin`** → `Option<ShellAssignmentBuiltin>` reads `declare`, `typeset`, `local`, `export` and `readonly`: `options` and `operands` split as the builtin's getopt splits them (`declare y=1 -i` has no option; `+x` is an option only for the first three), `resolved` `false` when a word in option position may expand to one (`declare "$o" y`), and `associativeFrom`, the first operand whose array keys bash reads as strings. bash marks those from the words as written, so `declare -- -A x=([k]=1)` keeps `k` a string while `declare "-A" x=([k]=1)` evaluates it: read the keys from `associativeFrom`, never from the options.
- **`ShellAssignment`** — `name`, `append` (`+=`), `value: ShellWord`, `subscript`, `start`, `end`, `raw`, and **`joined`**. An assignment builtin's array argument (`declare -A h=([k]=1)`) is one word of `args` whose array is an `opaque` part holding its elements' substitutions, read only where bash reads one: after a bare `declare`, `typeset`, `local`, `export`, `readonly`, `alias`, `eval` or `let` with no redirection since. A quoted or expanded value (`declare -a 'x=($(cmd))'`, `declare -a x="$v"`) is an ordinary word, but the builtin re-reads it as an array when the target is one and runs the `$(cmd)`: the README guard refuses such values rather than trusting the parse.
- **`ShellRedirection`** — `fd: Option<number>`, `operator: ShellRedirectionOperator`, `target: ShellWord | ShellHeredoc`, `start`, `end`. `2>&1` is `fd` 2, operator `>&`, target `1`.
- **`ShellHeredoc`** — `delimiter`, `quoted`, `stripTabs` (`<<-`), `body`, `start`, `end`, `terminated`, `expansions` for an unquoted body; a `text` getter strips `<<-` tabs, and **`joined`** is the body as bash reads it: backslash-newlines removed from an unquoted body (tabs then stripped from each joined line for `<<-`), kept in a quoted one. Match patterns against it, never `body`.
- **`ShellComment`** — `text`, `start`, `end`.
- **`ShellDiagnostic`** — `code: ShellDiagnosticCode`, `offset`, `length`, a derived `message`. A parse records at most 1000, then one `DiagnosticLimitReached`. Two codes name text bash runs that the parse cannot place as a substitution: `QuotedSubstitutionInExpansion` (a `'…'` or `$'…'` run holding `$(` or a backtick inside `${…}`, arithmetic or a subscript, which bash expands anyway in a double-quoted or heredoc `${…}`, in arithmetic and in an indexed array's key, so `echo "${x:-'$(cmd)'}"` runs `cmd`; reported in every such frame, so it over-reports the operators that keep it literal) and `QuotedCloserInExpansion` (a quoted `}`, `]`, `"` or `${` inside a double-quoted expansion, which POSIX-mode bash reads as a closer). Treat every diagnostic as a refusal.

Every offset is a UTF-16 index into `ShellScript.source`. For line and character, hand it to `@effected/source`'s `LineIndex` yourself; this package takes no edge for it.

## Usage

```ts
import type { ShellScript } from "@effected/shell";
import { Option } from "effect";

// Refuse anything the guard cannot vouch for, at every depth of substitution.
const refuses = (script: ShellScript): boolean => {
  const walk = script.allCommands();
  // A body past the depth cap was never read: a refusal, never a silent pass.
  if (walk.truncated) return true;
  return walk.scripts.some(({ script: nested }) => {
    if (nested.diagnostics.length > 0) return true;
    return nested.commands().some((command) => {
      // No name WITH args is a command it cannot name (`$GIT commit`).
      if (Option.isNone(command.name) && command.args.length > 0) return true;
      const name = Option.getOrUndefined(command.name);
      // `name` is as written: compare its last path segment, so /usr/bin/git counts.
      return name !== undefined && name.slice(name.lastIndexOf("/") + 1) === "rm";
    });
  });
};
```

## Traps

- **`script.commands()` is one level deep.** A command inside `$(…)` appears only through `substitutions()` or `allCommands()`. Use `allCommands()` rather than recursing by hand, read every nested script's `diagnostics`, and refuse a walk whose `truncated` is `true`. `walk.commands()` alone omits what lies past the cap.
- **Gate the input size before you parse.** `parse` and `allCommands` are linear and never refuse, so a megabyte of densely packed substitutions costs about a second to parse and walk (about 250 ms at 256 KB), while real agent Bash commands top out near 50 KB. The package does not cap the input, because the budget depends on your hook's timeout. Refuse above a size you can afford, such as 256 KB, before calling `parse`, especially where a hook that times out falls open.
- **`name` being `None` means three things.** With `args` it is a command that cannot be read statically (`$GIT commit`); with a wrapper it is an option the wrapper table does not know (`env --split 'git commit'`) or a word the wrapper steps over that could split (`env -u $v git`); with no `args` it is a segment that runs nothing (`fi`, `}`). A guard must refuse the first two and pass the third.
- **`[[` and `((` are names, and bash evaluates text inside them.** `[[ 'a[$(cmd)]' -eq 0 ]]`, `(( x ))` over a variable, `let`, `declare -i`, `printf -v`, `read`, `trap`, `${x@P}`, a variable as a subscript or substring offset, and `PS4` under xtrace each run a command the analyzer only names as text. The package README's guard refuses that whole class by name; copy it rather than writing your own, and match `joined`, never `raw`: bash removes `\⏎` (backslash-newline) before it tokenizes, so a split `[\⏎[` or `P\⏎S4=` slips past a regex over `raw`. The segmenter also splits `[[ … ]]` on `&&`, `||` and `(`, so its operands can surface as command names in later segments.
- **Three parser modes hide a command with no diagnostic:** `shopt -s extglob`, `shopt -s expand_aliases` (and POSIX mode, which expands aliases in a script), and `set -o posix` or `POSIXLY_CORRECT`. Refuse `shopt`, `alias`, `set -o posix`, `hash -p`, `enable -n`, and any mention of `POSIXLY_CORRECT`, `BASH_ALIASES`, `BASH_CMDS` or `PS4`, and control the inherited environment.
- **`name` stays as written.** `/usr/bin/git` is not `git` until you compare the last path segment. Wrappers are already matched that way.
- **Read arguments through `literal`, never `raw`.** `raw` of `git {commit,}` reads as if it were literal text; `literal` is `None`. Git's own global options still need the caller's handling: `git -C dir commit` has `commit` as a later argument.
- **Commands that take a command string are reported as their own name.** `bash -c`, `eval`, `source`, `xargs`, `find -exec` and `ssh` are not interpreted, and neither are argv wrappers the package does not unwrap (`nice`, `timeout`, `stdbuf`, `setsid`, `doas`, `chroot`, `builtin`); a real guard refuses or interprets them.
- **Fails closed by over-reporting.** `[[ … ]]` is lexed as words, `case` patterns end at their `)`, and function bodies are segmented as if they ran, so a command the shell might not run can appear. The opposite never happens by design: the segmenter does not read a heredoc that may not be there, and `<<` inside `(( … ))` or `$(( … ))` is a shift.
- **Input it cannot finish becomes an `opaque` part plus a diagnostic.** Check `diagnostics` before trusting a script; a heredoc delimiter written `EOF)` inside `$(…)`, which bash accepts, comes out unterminated with diagnostics.
- **A backtick substitution's `body` has bash's escape removal applied**, which is what bash runs, so nested-parse offsets map back to `bodyStart` only when the body holds no such escape.

## Not included

Expansion or evaluation of any kind, execution, a full compound-command grammar, and line/character positions.
