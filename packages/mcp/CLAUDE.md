# @effected/mcp

The boundary layer of an `effect/unstable/ai` MCP server: stdio wiring that
keeps stdout the JSON-RPC wire, tool-failure shaping, and strict-input
walkers — plus a `./testing` subpath for driving a built server from a test.
Protocol handling, tool registration and the wire format stay core's; this
package fixes the defaults consumers kept getting wrong.

**Design doc:** `@./okf/modules/mcp.md` — Load when: changing the public
surface, the stdio launch/teardown shape, the tool-failure message contract,
or the strict-input walker. `okf/modules/mcp.md` stays `status: draft` until
the user verifies it.

## Tier: boundary — no exceptions in `src/`

`src/` never reads `process` (not even inside a string literal — the
boundary test is a token scan), never imports `node:` or an
`@effect/platform*` package, and never calls `console.*`. `Console` is
reached only through core's `Console.Console` reference. stdout is the
JSON-RPC wire; any unguarded write to it corrupts the protocol. The current
guard is a temporary scanner in `__test__/boundary.test.ts`, replaced by
`@effected/workspaces/testing`'s `SourceBoundary` in phase 3.

**Nothing in the kit may depend on this package except an application.**
`@effected/mcp` never depends on `@effected/cli` or `@effected/workspaces` —
a CLI boundary and an MCP boundary are siblings, both front ends, never
layers on each other.

## Peers

`@effected/engine` (workspace `^`) and `effect` (`catalog:effect:peers`).
`Remediation` from `@effected/engine` is the shape `ToolFailure` folds into a
wire message; nothing else in `@effected/engine` is consumed yet.

## `./testing` split

`src/testing.ts` is a separate entrypoint, exported at
`@effected/mcp/testing`, so test tooling never enters a server's runtime
import graph. It carries no boundary exception of its own — reachability
from `src/index.ts` is pinned by a test that asserts the two graphs never
cross.

## Test and build

Tests live in `__test__/`, use `@effect/vitest`, assert with `assert.*` —
never `expect`.

```bash
pnpm vitest run --project @effected/mcp   # this package's tests
pnpm build --filter @effected/mcp         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` that
looks exactly like a clean gate.
