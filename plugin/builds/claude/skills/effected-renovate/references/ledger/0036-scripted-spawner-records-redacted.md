---
id: "0036"
title: ScriptedSpawner records Redacted arguments as passed
kind: breaking
shows: typed
applies:
  "@effected/commands": ">=0.19.0"
detect: ["ScriptedSpawner", "SpawnRecord", "\\.spawns(\\[|\\.)"]
---

Effect 4.1 lets a `ChildProcess` argument or `env` value be `Redacted`, and the kit's spawn double now records what was passed rather than unwrapping it.

- **`SpawnRecord.args` is `ReadonlyArray<CommandLine.Word>`** (`string | Redacted<string>`), and **`SpawnRecord.env` values may be `Redacted<string>`**. A `Redacted` argument stays the `Redacted` object, so a record never holds a secret as text: `JSON.stringify` and `String` show `<redacted>`. Code that treats `spawns[i].args` as `string[]` (`.includes`, `.join`, string comparison) stops compiling. Normalise with `args.map(String)`, or assert on the `Redacted` itself (`record.args[1] === token`).
- **`SpawnScript` still receives `ReadonlyArray<string>`.** A `Redacted` argument reaches a script as `"<redacted>"`, never its value. Behavioural, and only if your code passes a `Redacted` argument.
- `Run.extendEnv` also accepts `Redacted` values, and a `Redacted` argument shows as `***` in `CommandFailedError.args` and spans.

This also lets a test assert that a secret reached the child without the secret appearing in a snapshot. Check against the installed `@effected/commands` `.d.ts`.
