---
"@effected/shell": minor
---

## Features

### Initial release

`@effected/shell` is a tolerant shell-syntax lexer and segmenter for guards and agent tooling. It answers one question about an untrusted command string: which simple commands would this run, and with which words? Nothing is expanded or executed, and the parse never fails. Input it cannot finish becomes an opaque part and a diagnostic.

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

* `ShellSyntax.parse` splits a string into segments on its control operators, with leading assignments, redirections, comments and diagnostics. `ShellSyntax.parseEffect` is the same parse under a span
* Words record how they are quoted and mark every expansion, and a word's `literal` is `None` when the shell would change it, so `git {commit,}` cannot read as a plain word
* `ShellScript.commands()` resolves each segment's command name, unwrapping `sudo`, `env`, `command`, `exec`, `nohup` and `time`. Wrapper options resolve by unique prefix as `getopt_long` does, and the name is `None` when an unknown option, or an option value or assignment that the shell could split into more words (`sudo -u $u git`), stands between the wrapper and its command. A whole-segment `[[ … ]]` or `(( … ))` resolves to `[[` or `((`
* Diagnostics name what the parse cannot place: a quoted run inside `${…}`, arithmetic, a subscript or an array key that bash still expands (`QuotedSubstitutionInExpansion`, decoded ANSI-C text included), and a quoted closer POSIX-mode bash would act on (`QuotedCloserInExpansion`). Treat every diagnostic as a refusal
* `ShellScript.substitutions()` lists the command and process substitutions at one level, so a guard can recurse with `ShellSyntax.parse(part.body)`. Bound that recursion yourself
* Heredoc bodies are skipped by the segmenter, so text inside one is never read as commands

Where the grammar has limits it over-reports rather than hiding a command. It has no `[[ ]]` grammar, for example, so an `&&` inside one splits the segment.
