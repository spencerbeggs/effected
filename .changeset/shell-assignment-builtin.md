---
"@effected/shell": minor
---

## Features

* `ShellCommand.assignmentBuiltin` reads `declare`, `typeset`, `local`, `export` and `readonly` as `ShellAssignmentBuiltin`: getopt-split options and operands, and where bash reads an array key as a string
* `ShellHeredoc.joined` gives a heredoc body as one string

## Bug Fixes

* A `<<-` heredoc strips leading tabs only after a line feed, as bash does
* The README's guard example read `-A` after quote removal, so a quoted or escaped `-A` ran a command substitution in an array key. It now reads the association through `associativeFrom` and refuses input above 256 KB
