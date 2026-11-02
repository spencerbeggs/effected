# @effected/engine

The `effected` tool's shared logic, consumed by its CLI and MCP front ends. The first release reports identity only: `Identity.report` returns an `IdentityReport` (`tool`, the front end's `version`, the carrier `distribution`, and the resolved `effect` version).

`@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is the only peer. The `effect` version comes from a JSON import of `effect/package.json`, which stays an external import in the built output.

One module per concept; `src/index.ts` is the only re-exporting module. Tests live in `__test__/`.
