---
"@effected/commands": minor
---

## Features

Added `Run.jsonLine(command, schema, options?)`, a framing variant of `Run.json` for a child process that reports through a single JSON protocol payload on its final stdout line.

Unlike `Run.json`, which parses the whole of stdout and requires a zero exit, `Run.jsonLine` takes the last non-empty stdout line — tolerant of noise before it, such as a subprocess-loaded hook's own logging — and parses it regardless of exit code, since a protocol payload typically discriminates success in-band.

```ts
import { Run } from "@effected/commands";
import { Schema } from "effect";

const Payload = Schema.Struct({ ok: Schema.Boolean });

const result = yield* Run.jsonLine(ChildProcess.make("node", ["script.js"]), Payload);
```

`CommandOutputError` also gains optional `exitCode`, `stderr` and `stdout` context fields (`stderr`/`stdout` redacted), populated when `Run.jsonLine` fails so the exit code and captured streams are available as diagnostic evidence when no usable payload arrives.

Both additions are additive; no existing surface changed.
