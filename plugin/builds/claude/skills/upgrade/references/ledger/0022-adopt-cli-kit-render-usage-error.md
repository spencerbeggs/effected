---
id: "0022"
title: "@effected/cli-kit: renderUsageError prints a machine-readable document for a parse-time usage error"
kind: adopt
shows: none
applies:
  "@effected/cli-kit": ">=0.31.0"
detect: ["ShowHelp|--format=json|\"--format\""]
closes: ["#1418"]
changesets: ["cli-kit-render-usage-error"]
---

`CliRuntime.main` takes `renderUsageError: { command, render }`. When the parser rejects an invocation, `render({ errors, commandPath, setting })` may return a document: it is printed alone on stdout, the help and errors go to stderr, and the exit code stays `usageExitCode`. `undefined` keeps the default output exactly. It is never called for `--help`, `--version` or a bare invocation. `setting(flag)` reads a global `Setting` (such as a `--format` flag) as core would provide it on the failing command path, and answers `none` when that setting is out of scope there.

Search for code that taps the program for a `ShowHelp`, or scans argv for `--format json` itself to print a JSON error envelope. Replace it with `renderUsageError`, passing the same command the program runs; that also drops the false positive for a subcommand that has no `--format` flag. Check the installed `.d.ts`.
