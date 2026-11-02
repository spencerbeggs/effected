# @effected/engine

The `effected` tool's shared logic, consumed by its CLI and MCP front ends.

The first release reports identity only: `Identity.report({ version, distribution })` returns an `IdentityReport` carrying the tool name, the front end's own version, its carrier distribution (or `null`), and the resolved `effect` version.

> **Pre-`1.0.0`.** Part of the `@effected/*` kit; unstable across `0.x` releases. Pin an exact version.
