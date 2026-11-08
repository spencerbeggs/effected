---
"@effected/shell": minor
---

## Features

### Joined text

`ShellWord.joined` and `ShellAssignment.joined` give the text of a word or assignment with its parts joined.

### Nested command walks

`ShellScript.allCommands({ maxDepth })` returns a `ShellCommandWalk` that includes `ShellNestedScript` entries. A walk that stops early carries a typed `ShellTruncation` whose reason is depth or budget. The default `maxDepth` is 16, the record limit is 10,000, and the walk is iterative.

### Evaluated commands

`ShellCommand.evaluated` is a new required field on the command.

## Bug Fixes

* `NAME=(…)` after the eight assignment builtins is one array argument
* `x=(a)#; cmd` no longer hides `cmd`

## Documentation

The README guard now refuses quoted or expanded array values that those builtins re-read, `-i` and `-n` on `declare`, `typeset`, `local`, `export` and `readonly`, and truncated walks.
