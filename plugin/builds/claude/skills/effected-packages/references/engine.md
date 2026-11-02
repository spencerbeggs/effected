# @effected/engine

The `effected` tool's shared logic, consumed by `@effected/cli` and
`@effected/mcp`. Application package, no library tier. (The cross-front-end
primitives library, which this builds on, is `@effected/kit`.)

## Import

```ts
import { Identity, IdentityReport } from "@effected/engine";
```

## Core API

- **`Identity.report({ version, distribution })`** — an `Effect` of an
  `IdentityReport`: `tool` (always `"effected"`), the front end's `version`, the
  carrier `distribution` (or `null`), and the resolved `effect` version.
- **`IdentityReport`** — the `Schema.Class` both front ends report, so the CLI
  and the MCP tool describe the tool identically.

`@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is
the only peer. New shared logic for the tool goes here, never in a front end.
