---
"@effected/ai-plugins": patch
---

## Documentation

* The `actions-reporting` logging contract says `ActionLogger.command` resolves with `stderr` as well as `stdout`: classify a failure from the stream a tool writes it to instead of merging the streams with `2>&1`, and scrub the returned text before quoting it, since it is not redacted
