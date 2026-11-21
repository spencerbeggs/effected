---
"@effected/github-actions": minor
---

## Features

* `ActionLogger.command` resolves with the child's collected stderr as well as its stdout, `{ exitCode, stdout, stderr }`, each stream whole and kept apart, so a caller can classify a failure from the stream a tool writes it to, such as npm's `npm error code ETARGET`, without merging the streams in a shell
* The collected text is not redacted: the runner masks registered secrets in the logged lines, but a caller quoting the returned strings in an error, a check run or a summary scrubs them first, for example with `@effected/commands`' `Redaction.apply`
