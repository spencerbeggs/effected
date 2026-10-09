---
type: Limitation
title: The schemastore CLI writes tab-indented, fully expanded JSON only
description: "Every document and catalog the CLI writes is CanonicalJson's layout with the default tab indent and no way to change it, so a repository whose JSON formatter collapses arrays fails lint after a build until it scopes Biome's expand always to the generated files; a repository that indents JSON with spaces cannot make the formatter agree at all and must format after the build. Drift is unaffected either way, because check compares parsed content."
status: draft
bounds: ../modules/schemastore-cli.md
tags:
  - dx
  - ci
sources:
  - id: canonical-json
    resource: ../../packages/schemastore/src/CanonicalJson.ts
  - id: schema-file
    resource: ../../packages/schemastore/src/SchemaFile.ts
  - id: runner
    resource: ../../packages/schemastore-cli/src/Runner.ts
  - id: issue-965
    resource: https://github.com/spencerbeggs/effected/issues/965
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T20:53:33Z
  body_sha256: 0c0678a39af541ce9314fdc4fe653678be12d7c13846d4243a9a64b0d9b0b00b
---

# The schemastore CLI writes tab-indented, fully expanded JSON only

## Condition

`CanonicalJson` puts every array element and object member on its own
line and takes an `indent` option that defaults to a tab.[^canonical-json]
The CLI never passes that option, so every schema document, catalog slice
and merged catalog it writes is tab-indented and fully
expanded.[^runner] The layout has no configuration surface on the CLI.

## Symptom

After a build writes a document whose content changed, a formatter that
lays JSON out differently reports the new file as unformatted. Under
Biome's default `json.formatter.expand: "auto"`, objects keep their
expanded form but any array that fits the line width collapses to one
line, so `lint` fails in a CI job that runs it after `schema:build`.
lint-staged hides this locally by reformatting at commit.[^issue-965]

The drift contract does not see any of it. `SchemaFile` decides whether to
write by parsed content unless the caller asks for byte comparison, and the
CLI never does; the catalog files compare through `CanonicalJson.equals`.
A file the formatter reflowed is neither rewritten nor reported stale by
`check`.[^schema-file]

## Why it is acceptable

A tab-indented repository closes the gap with configuration alone: scope
Biome's `expand: "always"` to the generated files. Probed on 2026-10-09
against silk's preset, Biome's output under that override was
byte-identical to the CLI's for a schema carrying scalar, numeric, mixed
and nested arrays and for a catalog, while the same files under `"auto"`
were reformatted. The owned layout is not bent toward one formatter's
fit-to-width heuristics, which differ by tool and by line width.

A repository that indents JSON with spaces has no such override. It
formats after the build instead
(`schemastore build && biome format --write <outputDir>`), which costs
one extra command and leaves `check` green.

## What a fix would take

Add an `indent` field to the CLI config and pass it to every
`serializeResult` and `SchemaFile` write the runner makes, so a
space-indented repository can pair it with the same `expand: "always"`
override.

[^canonical-json]: `packages/schemastore/src/CanonicalJson.ts` — `CanonicalJsonOptions.indent` and the `emit` layout.
[^runner]: `packages/schemastore-cli/src/Runner.ts` — no `indent` reaches any serialization; catalog files compare through `parsesEqual`.
[^schema-file]: `packages/schemastore/src/SchemaFile.ts` — `classify` and `compare`, where `wouldWrite` is byte-based only under `compare: "bytes"`.
[^issue-965]: <https://github.com/spencerbeggs/effected/issues/965>
