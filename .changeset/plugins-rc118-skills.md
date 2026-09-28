---
"@effected/claude-code-plugin": minor
"@effected/copilot-plugin": minor
---

## Features

The skills teach the current Effect core module layout: every former `effect/unstable/*` module is imported from `effect/<module>`, `Arbitrary` from `effect`, and base64 and hex helpers from `effect/encoding/*`. The `Schema` check names follow core's `isBetween*` and `isStartingWith` / `isEndingWith` / `isIncluding` forms. Source citations and the vendored-source pin now point at the current tag.

The `effect-v4-mcp` skill and the `@effected/mcp` reference describe core's all-errors strict report with the toolkit's appended accepted-params lines, the stdin guard's reason for existing (core skips a malformed line without the reply JSON-RPC requires) and its `@effect/rpc/*` handling, `ping` passing the test harness before `initialize`, string-result shapes per protocol revision, and the regex `u` flag a pattern-keyed `Record` needs to be served closed.
