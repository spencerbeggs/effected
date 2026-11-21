---
id: "0027"
title: "effect/schema: schema source generation moved to Codegen.Module, removing SchemaRepresentation.toCodeDocument, CodeDocument, Artifact and makeCode, and @effect/openapi-generator's OpenApiTransformer"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.5"
  "@effect/openapi-generator": ">=4.1.5"
detect: ["toCodeDocument", "CodeDocument", "makeCode\\(", "SchemaRepresentation\\.Artifact", "OpenApiTransformer"]
---

This applies only to code that generates TypeScript source from a schema or an OpenAPI document. The experimental `Codegen.Module` builder replaces the code path in `SchemaRepresentation` (Effect-TS/effect#10569), which fixes recursive initialization, name collisions and symbol identity in the generated output.

- **`SchemaRepresentation.toCodeDocument`, `CodeDocument`, `Artifact` and `makeCode` are removed.** Build a module with `Codegen.Module`, add the schemas with `addSchemas`, and call `print` for the source. Where a hit called `makeCode(runtime, Type)`, construct the `{ runtime, Type }` object directly.
- **A custom `toCode` callback** must interpolate the argument strings it is given unchanged and return a supported schema or type expression. Move anything else, such as a function with local declarations, into an imported helper.
- **`@effect/openapi-generator/OpenApiTransformer` is removed.** Use the `OpenApiGenerator` service and pick the output with its `format` option.
- **Some nullable objects in the regenerated AI provider clients**, such as OpenAI's `Batch.errors`, now strip undeclared fields and no longer expose an index signature. Read their declared fields instead.

The compiler finds every removed export. Check the installed `Codegen` and `SchemaRepresentation` `.d.ts` for the builder's shape, then regenerate and diff the output: names that used to collide now come out distinct.
