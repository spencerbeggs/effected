---
"@effected/copilot-plugin": minor
---

## Features

* The `effect-v4-testing` worked example now uses `@effected/memfs` instead of `FileSystem.layerNoop`, and a new memfs trap teaches that a faulted path must exist in the seed.
* `effect-v4-testing` SKILL.md is trimmed under the 500-line cap, with depth moved into seven new references: providing-layers, env-seam, property-testing, testclock, test-console, asserting-errors and running-the-suite.
* The `effected-packages` references for walker, workspaces and jsonl now teach memfs doubles for tests.
