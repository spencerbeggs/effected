# @effected/engine

The `effected` tool's shared logic, consumed by its CLI and MCP front ends. The first release reports identity only: `Identity.report` returns an `IdentityReport` (`tool`, the front end's `version`, the carrier `distribution`, and the resolved `effect` version).

`@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is a regular dependency, because a tool declares its full stack. The `effect` version comes from a JSON import of `effect/package.json`, which stays an external import in the built output.

The `./schema` subpath is the `effected schema` machinery the front ends share. Today it holds `ConfigLoader`, which evaluates a `schemastore.config.*` afresh on every call: a long-lived server must see an edit, and packages stay native imports so reloading keeps one `@effected/schemastore`. The root entry never reaches `./schema`, so reading identity pulls in neither `jiti` nor `ajv`. `@effected/schemastore` is a `workspace:*` dependency, and `ajv` and `ajv-formats` are exact versions, because each decides what the tool outputs.

One module per concept; `src/index.ts` and `src/schema/index.ts` are the only re-exporting modules. Tests live in `__test__/`.
