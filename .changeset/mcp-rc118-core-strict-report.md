---
"@effected/mcp": minor
---

## Breaking Changes

Strict tool input is now decoded and reported by core, and `McpToolkit.layer` no longer rejects unknown keys with its own `Unrecognized parameter(s): … Accepted params: …` sentence first. A rejected call now gets core's full report in one `InvalidParams`: every excess key, nested excess key, missing field and wrong type. The toolkit then appends one line per level that had an unknown key:

```text
Invalid parameters for tool 'search': Expected no excess property
  at ["extra"]
Accepted params at the root: query, filter.
Accepted params at ["filter"]: kind, tag.
```

A zero-parameter tool appends `This tool accepts no params.`. A pattern-keyed `Record` lists `keys matching <pattern>`. A failure with no unknown key is core's report unchanged. Update assertions that match the old sentence. `strict: "all"` remains the default.

- `McpToolkitOptions.unknownKeyMessage` and `UnionHandlerOptions.unknownKeyMessage` are deprecated and ignored.
- Union tools (`unionTool` / `unionHandler`) decode with every error reported against the matched member, followed by the same accepted-params lines.

## Features

- `UnknownKeysLevel.acceptedPatterns` records the `patternProperties` keys of a closed level, and `formatUnknownKeys` lists them as `Accepted keys matching: …` instead of `(none)`.
- `McpToolAudit` with `input: "closed"` points at the regex `u` flag when a `Record`'s key check was not served. A pattern-keyed `Record` is served as `patternProperties` only when its pattern has `u`.

## Bug Fixes

- `McpStdio.layer` answers a request whose method starts with `@effect/rpc/` with `-32601` Method not found, and drops such a notification, before it reaches the server. A single `@effect/rpc/Eof` line on stdin previously stopped the server silently (Effect-TS/effect#8499).
- `McpHarness` lets `ping` through before `initialize`, matching the server. Every other method still fails with `NotInitialized`.
