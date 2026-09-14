---
type: Decision
title: No shipped templates/ directory
description: The bundler publishes only emitted src, LICENSE and README; the canonical schema-generator script a consumer copies lives outside the package.
status: draft
sources:
  - id: package-json
    resource: ../../packages/schemastore/package.json
generated:
  by: "claude-code/opus-5"
  at: 2026-09-13T05:33:04Z
  body_sha256: 43af0f80619fe7eceb0c6c868f6a54397f082c70b2ae7237e1aa172b7e57630a
---

# No shipped templates/ directory

## Context

Consumers of `@effected/schemastore` write their own generator script
that calls `SchemaPipeline.run`. A shipped `templates/` directory
carrying a canonical version of that script was considered.

## Decision

The package ships no `templates/` directory. The bundler publishes
emitted `src`, `LICENSE` and `README` only. The canonical
schema-generator script a consumer repository copies lives in the
`actions-inputs-outputs` skill reference and in the `github-action-template`
repository, not as a package artifact.

## Alternatives rejected

**Ship a `templates/` directory with a copyable generator script inside
the npm package.** Rejected because the generator script is
repository-specific glue code — it names the consumer's own schema
sources and target paths — not a library surface with a stable contract.
Publishing it as part of the npm package would imply it is meant to be
imported or depended on, when it is meant to be copied and adapted.
Keeping the canonical copy in a skill reference and a template repository
puts it where consumers already look for repository-scaffolding
material, rather than inside a runtime dependency's published files.

## Consequences

A consumer scaffolding a new schema-publishing pipeline copies the
reference script from the template repository or skill reference rather
than importing anything from `@effected/schemastore`'s own package
contents beyond its public modules. With the
[`@effected/schemastore-cli`](../modules/schemastore-cli.md) companion
there is no longer a canonical generator script to copy at all: the
consumer writes a `schemastore.config.ts` and runs the `schemastore`
bin, so the question this decision answered is moot for new consumers.
