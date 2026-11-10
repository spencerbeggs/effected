---
id: "0001"
title: "@effected/shell: a guard copied from the README let a quoted or escaped -A run a command substitution in an array key"
kind: security
shows: none
applies:
  "@effected/shell": ">=0.3.0"
detect: ["\\^-\\[A-Za-z\\]\\*A", "\\.body\\.replaceAll\\("]
changesets: ["shell-assignment-builtin"]
closes: ["spencerbeggs/effected#1288"]
---

This applies only to a repository whose command guard was built from `@effected/shell`'s README example. The package's parse was never wrong; the example read it wrongly, and a guard that copied the example has a bypass. Nothing in the kit itself changed behaviour here, so the compiler and the tests stay silent: only the search finds it.

The old example decided an assignment builtin's array keys were strings when any earlier argument matched `/^-[A-Za-z]*A/` after quote removal. bash reads the `-A` as written, so `declare "-A" x=([k]=1)` and `declare \-A x=([k]=1)` leave the keys arithmetic, and with `k='a[$(cmd)]'` they run `cmd`. The guard passed them.

1. **Where the search matched the `-A` regex**, replace that test with the new view. `ShellCommand.assignmentBuiltin` is an `Option` of `ShellAssignmentBuiltin` for `declare`, `typeset`, `local`, `export` and `readonly`, with `options` and `operands` split as the builtin's getopt splits them. Its `associativeFrom` is an `Option` of the index of the first operand whose keys bash reads as strings. Treat an array value's keys as arithmetic unless that operand index is at or past `associativeFrom`. Copy the current README guard for the exact shape.
2. **Where the search matched a heredoc body's `replaceAll`**, which removed backslash-newlines from an unquoted body, use `ShellHeredoc.joined` instead. It removes them where bash does, keeps them in a quoted body, and for `<<-` strips each joined line's tabs.
3. **Gate the input size.** The new README guard refuses input above 256 KB before it parses, because parse cost is bounded only by the input and a hook that falls open on a timeout turns a slow refusal into a pass. Add the same gate, sized to your hook's timeout.

`ShellHeredoc.text` now strips `<<-` tabs only after a line feed, as bash does; a guard that matched on `text` sees that change too.

Verify with a test that feeds the guard `declare "-A" x=([k]=1)` and `declare \-A x=([k]=1)` and asserts it refuses both. Read the installed `.d.ts` for `ShellAssignmentBuiltin` and `ShellHeredoc` for the exact shapes.
