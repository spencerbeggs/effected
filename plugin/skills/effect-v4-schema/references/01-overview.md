<!--
Vendored from the Effect canonical Schema guide (effect-smol, packages/effect/SCHEMA.md, main branch).
Reference material for the effect-v4-schema skill. Tracks upstream main, which may run AHEAD of the
pinned effect@4.0.0-beta.94 in this repo. Verify any specific API against the installed package before
relying on it (node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.X)").
Source: https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md
-->

# Schema

`Schema` is a TypeScript-first library for defining data shapes, validating unknown input, and transforming values between formats.

Two key concepts appear throughout this guide:

- **Decoding** — turning unknown external data (API responses, form submissions, config files) into typed, validated values.
- **Encoding** — turning typed values back into a serializable format (JSON, FormData, etc.).

Use Schema to:

- **Define types** — declare the shape of your data once and get both the TypeScript type and a runtime validator.
- **Validate input** — decode unknown data into type-safe values, with clear error messages when it doesn't match.
- **Transform values** — convert between your domain types and serialization formats like JSON, FormData, and URLSearchParams.
- **Generate tooling** — derive JSON Schemas, test data generators, equivalence checks, and more from a single schema definition.

## Design Philosophy

- **Lightweight by default** — only import the features you need, keeping your bundle small.
- **Familiar API** — naming conventions and patterns are consistent with popular validation libraries, so getting started is easy.
- **Explicit** — you choose which features to use. Nothing is included implicitly.

### What's in This Guide

1. **Elementary schemas** — built-in schemas for primitives, literals, strings, numbers, dates, and template literals.
2. **Composite schemas** — combine elementary schemas into structs (objects), tuples, arrays, records, and unions.
3. **Validation** — add runtime checks (filters) to constrain values, report multiple errors, and define custom rules.
4. **Constructors** — create validated values at runtime, with support for defaults, brands, and refinements.
5. **Transformations** — convert values between types during decoding and encoding. Transformations are reusable objects you compose with schemas.
6. **Flipping** — swap a schema's decoding and encoding directions.
7. **Classes and opaque types** — create distinct TypeScript types backed by structs, with optional methods and equality.
8. **Serialization** — convert values to and from JSON, FormData, URLSearchParams, and XML using canonical codecs.
9. **Tooling** — generate JSON Schemas, test data generators (Arbitraries), equivalence checks, optics, and JSON Patch differs from a single schema.
10. **Error handling** — format validation errors for display, with hooks for internationalization.
11. **Middlewares** — intercept decoding/encoding to provide fallbacks or inject services.
12. **Advanced topics** — internal type model and type hierarchy (for library authors).
13. **Integrations** — working examples for TanStack Form and Elysia.
14. **Migration from v3** — API mapping from Schema v3 to v4.
