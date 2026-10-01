---
"@effected/app": minor
"@effected/cli": minor
"@effected/commands": minor
"@effected/config-file": minor
"@effected/engine": minor
"@effected/env": minor
"@effected/git": minor
"@effected/github": minor
"@effected/github-actions": minor
"@effected/github-commands": minor
"@effected/github-references": minor
"@effected/glob": minor
"@effected/jsonc": minor
"@effected/jsonl": minor
"@effected/lockfiles": minor
"@effected/markdown": minor
"@effected/mcp": minor
"@effected/memfs": minor
"@effected/npm": minor
"@effected/package-json": minor
"@effected/runtimes": minor
"@effected/sbom": minor
"@effected/schema-org": minor
"@effected/schemastore": minor
"@effected/schemastore-cli": minor
"@effected/semver": minor
"@effected/spdx": minor
"@effected/store": minor
"@effected/templates": minor
"@effected/toml": minor
"@effected/tsconfig-json": minor
"@effected/walker": minor
"@effected/workspaces": minor
"@effected/xdg": minor
"@effected/yaml": minor
---

## Breaking Changes

- The kit now builds on and peers stable `effect` `^4.0.0`, in place of an exact release-candidate pin. Move `effect` and every `@effect/*` package to the same `4.x` version in one install: Effect releases them together at one version. A package from this release cannot share an install with an `effect` release candidate. The peer is a caret range, so later `4.x` releases of Effect satisfy the kit without a kit release.
- Kit exports are unchanged. A consumer moving to stable `effect` meets these changes in its own code:
  - `Array`, `Chunk`, `Effect` and `Record` `partition`, their `separate` helpers and `Option.partitionMap` return `[successes, failures]`. Where both sides share a type, the reversed destructuring still compiles, so search for every call.
  - `Schema.brand` takes one identifier and is type-only: the identifier is not stored on the AST and does not survive `SchemaRepresentation`. Compose distinct brands by applying `brand` more than once.
  - `TestSchema`'s round-trip assertion is `verifyRoundTrip`, with Effect forms `succeedEffect`, `failEffect` and `verifyRoundTripEffect`.
  - Effect marks some APIs `@stability unstable`: those may change in a minor Effect release. Untagged APIs follow semver.

## Documentation

- Every exported construct's TSDoc was reviewed against the current API. Summaries open with what the construct does, error channels and requirements are stated, examples use real imports and compile, and links resolve. Comments that described options, errors or defaults the code does not have were corrected.
