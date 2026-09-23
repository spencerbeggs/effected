# @effected/mcp

The boundary layer of an `effect/unstable/ai` MCP server: stdio wiring that keeps stdout the JSON-RPC wire, tool-failure shaping, and strict-input walkers, plus a `./testing` subpath for driving a built server from a test.

[![npm](https://img.shields.io/npm/v/@effected%2Fmcp?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

```bash
npm install @effected/mcp @effected/engine effect
```

```bash
pnpm add @effected/mcp @effected/engine effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 and `@effected/engine` are the only peer dependencies. Boundary tier: `src/` reads no `process` token, imports no `node:` module and no `@effect/platform*` package, and calls no `console.*` — stdout is the JSON-RPC wire a server writes over.

## ToolFailure

Core's MCP server sends a tool's declared failure — an `Error` instance, which every `Schema.TaggedError` is — as `isError: true` with `error.message` as the only text and no `structuredContent`. Whatever is not folded into `message` when the error is constructed never reaches the agent. `ToolFailure` is the shared shape for doing that folding consistently across a server's tools.

Spread `ToolFailure.fields` into a tool's `Schema.TaggedError`, build `message` with `ToolFailure.message`, and pass every caller-supplied value through `ToolFailure.truncate` before echoing it back:

```ts
import { ToolFailure } from "@effected/mcp";
import { Schema } from "effect";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  ...ToolFailure.fields,
  id: Schema.String,
}) {}

const remediation = { hint: "List the ids first.", suggestedTool: "list_things" };
const id = "missing-id";

const error = new NotFound({
  id,
  remediation,
  message: ToolFailure.message(`No thing "${ToolFailure.truncate(id)}".`, remediation),
});

console.log(error.message);
// => No thing "missing-id". List the ids first. Try list_things.
```

`ToolFailure.message` drops any empty part, so an omitted `suggestedTool` or an empty `hint` never leaves a double space:

```ts
ToolFailure.message("Config missing.", { hint: "Run init." });
// => "Config missing. Run init."
```

`ToolFailure.truncate` caps a caller-supplied value at `ToolFailure.ECHO_LIMIT` (200 UTF-16 code units) before it is echoed into a message, backing off one unit rather than splitting a surrogate pair. A value the engine itself produced — a path, a diagnostic — can take the larger `ToolFailure.ENGINE_ECHO_LIMIT` (2000):

```ts
ToolFailure.truncate("a".repeat(500));
// => "aaaa…aaaa" (200 characters, then "…")

ToolFailure.truncate(enginePath, ToolFailure.ENGINE_ECHO_LIMIT);
```

`ToolFailure` is a static-namespace class with a private constructor — it is never instantiated.

## Tier

Boundary tier. Peers: `@effected/engine` and `effect`. Nothing in the kit depends on `@effected/mcp` except an application; it never depends on `@effected/cli` or `@effected/workspaces` — a CLI boundary and an MCP boundary are siblings, both front ends, never layers on each other.

## License

[MIT](LICENSE)
