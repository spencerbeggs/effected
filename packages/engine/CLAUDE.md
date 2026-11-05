# @effected/engine

The `effected` tool's shared logic, consumed by its CLI and MCP front ends. The first release reports identity only: `Identity.report` returns an `IdentityReport` (`tool`, the front end's `version`, the carrier `distribution`, and the resolved `effect` version).

`@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is a regular dependency, because a tool declares its full stack. The `effect` version comes from a JSON import of `effect/package.json`, which stays an external import in the built output.

The `./schema` subpath is the `effected schema` machinery the front ends share. Today it holds `ConfigLoader`, which evaluates a `schemastore.config.*` and the TypeScript and `.json` it imports afresh on every call, because a long-lived server must see an edit. A `type: module` or CommonJS package stays a native import, so reloading keeps one `@effected/schemastore`; an untyped package of ESM `.js` gets a new instance per reload. An imported `.mjs`, `.cjs` or `.js` under `type: module` stays cached by Node's ESM loader, and a sibling workspace package resolved to built `.js` under `type: module` is the same case: an edit to one is not seen until the process restarts, so restart the server. `jiti` has a tilde range because this rests on its routing. The root entry never reaches `./schema`, so reading identity pulls in neither `jiti` nor `ajv`. `@effected/schemastore` is a `workspace:*` dependency, and `ajv` and `ajv-formats` are exact versions, because each decides what the tool outputs.

One module per concept; `src/index.ts` and `src/schema/index.ts` are the only re-exporting modules. Tests live in `__test__/`.
