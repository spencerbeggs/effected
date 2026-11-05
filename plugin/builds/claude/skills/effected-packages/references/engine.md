# @effected/engine

The `effected` tool's shared logic, consumed by `@effected/cli` and
`@effected/mcp`. Application package, no library tier. (The cross-front-end
primitives library, which this builds on, is `@effected/kit`.)

## Import

```ts
import { Identity, IdentityReport } from "@effected/engine";
import { AjvValidator, AjvInstanceValidator, ConfigLoader, SchemaRun } from "@effected/engine/schema";
```

## Core API

- **`Identity.report({ version, distribution })`** — an `Effect` of an
  `IdentityReport`: `tool` (always `"effected"`), the front end's `version`, the
  carrier `distribution` (or `null`), and the resolved `effect` version.
- **`IdentityReport`** — the `Schema.Class` both front ends report, so the CLI
  and the MCP tool describe the tool identically.

## `@effected/engine/schema`

The schema run behind `effected schema` and the `schema_*` tools, shared by both
front ends so they cannot disagree.

- **`ConfigLoader`** — finds and loads a `schemastore.config.*` through `jiti`
  relative to the config file, resolving every relative path against the config's
  own directory.
- **`SchemaRun`** and the report classes — the build/check walk: verdicts for
  gate, drift, blocked catalog and stale output, the version-mismatch check, and
  `RunReport` with `diff.hunks` and `diff.unified`.
- **`SchemaValidate`** — validates a payload against a published document;
  findings carry `location: { file, line, column }`, one-based.
- **`AjvValidator`, `AjvInstanceValidator`** — the shipped ajv engines for
  `SchemaValidator` and `InstanceValidator`. A program driving `SchemaPipeline`
  itself imports them from here.

`@effected/kit` (which supplies `Distribution`), `@effected/schemastore`, `ajv` and
`effect` are regular dependencies of the engine. New shared logic for the tool goes here, never in a front end.
