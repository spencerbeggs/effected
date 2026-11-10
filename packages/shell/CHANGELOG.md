# @effected/shell

## 0.2.0

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Maintenance

- Republish with no code changes, to confirm the package's npm trusted-publishing connection [#1310][#1310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.1.0

### Features

#### Joined text

- `ShellWord.joined` and `ShellAssignment.joined` give the text of a word or assignment with its parts joined.

#### Nested command walks

- `ShellScript.allCommands({ maxDepth })` returns a `ShellCommandWalk` that includes `ShellNestedScript` entries. A walk that stops early carries a typed `ShellTruncation` whose reason is depth or budget. The default `maxDepth` is 16, the record limit is 10,000, and the walk is iterative.

#### Evaluated commands

- `ShellCommand.evaluated` is a new required field on the command.

#### Initial release

- `@effected/shell` is a tolerant shell-syntax lexer and segmenter for guards and agent tooling. It answers one question about an untrusted command string: which simple commands would this run, and with which words? Nothing is expanded or executed, and the parse never fails. Input it cannot finish becomes an opaque part and a diagnostic.

```ts
import { ShellSyntax } from "@effected/shell";
import { Option } from "effect";

const script = ShellSyntax.parse('git add -A && sudo git commit -m "$(date)"');

for (const command of script.commands()) {
  console.log(Option.getOrNull(command.name), command.wrappers, command.args.map((word) => word.raw));
}
// git [] [ 'add', '-A' ]
// git [ 'sudo' ] [ 'commit', '-m', '"$(date)"' ]

console.log(script.substitutions().map((part) => part.body));
// [ 'date' ]
```

- `ShellSyntax.parse` splits a string into segments on its control operators, with leading assignments, redirections, comments and diagnostics. `ShellSyntax.parseEffect` is the same parse under a span

- Words record how they are quoted and mark every expansion, and a word's `literal` is `None` when the shell would change it, so `git {commit,}` cannot read as a plain word

- `ShellScript.commands()` resolves each segment's command name, unwrapping `sudo`, `env`, `command`, `exec`, `nohup` and `time`. Wrapper options resolve by unique prefix as `getopt_long` does, and the name is `None` when an unknown option, or an option value or assignment that the shell could split into more words (`sudo -u $u git`), stands between the wrapper and its command. A whole-segment `[[ … ]]` or `(( … ))` resolves to `[[` or `((`

- Diagnostics name what the parse cannot place: a quoted run inside `${…}`, arithmetic, a subscript or an array key that bash still expands (`QuotedSubstitutionInExpansion`, decoded ANSI-C text included), and a quoted closer POSIX-mode bash would act on (`QuotedCloserInExpansion`). Treat every diagnostic as a refusal

- `ShellScript.substitutions()` lists the command and process substitutions at one level, so a guard can recurse with `ShellSyntax.parse(part.body)`. Bound that recursion yourself

- Heredoc bodies are skipped by the segmenter, so text inside one is never read as commands

- Where the grammar has limits it over-reports rather than hiding a command. It has no `[[ ]]` grammar, for example, so an `&&` inside one splits the segment. [#1250][#1250]

### Bug Fixes

- `NAME=(…)` after the eight assignment builtins is one array argument
- `x=(a)#; cmd` no longer hides `cmd`

### Documentation

- The README guard now refuses quoted or expanded array values that those builtins re-read, `-i` and `-n` on `declare`, `typeset`, `local`, `export` and `readonly`, and truncated walks. [#1295][#1295]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1250]: https://github.com/spencerbeggs/effected/pull/1250

[#1295]: https://github.com/spencerbeggs/effected/pull/1295
