---
"@effected/schemastore": minor
---

## Features

### `SchemaPipeline.run` gates contract changes before writing

`SchemaPipeline.run` is now two-phase: it builds, lints, validates and gates every target first, and writes only when every target passes. A gate failure on any target leaves every other target unwritten, where previously targets ahead of the failing one were already on disk.

A new `contractChanges` option on `SchemaPipelineOptions` decides what happens when a document's validation contract changes:

- `"block-versioned"` (the default) — a target whose `version` is a pinned label (not a prerelease) is a published, URL-pinned document; a `"contract"` change fails with the new `SchemaContractChangeError` before any write. Unversioned and prerelease targets are rewritten in place as before.
- `"allow"` — classify and report only, never refuse. This is also the repair path for a published file whose text no longer parses, which `SchemaFile` classifies as a contract change.

`SchemaContractChangeError` is total over the targets and carries one `ContractChangeTarget` per refused document (`$id`, `path`, `version`, `nextVersion`), so its message names the label to bump to. `PipelineCheckResult` gains `contractBlocked`, computed by the same predicate `run` uses, so a drift test can print the right remedy for a target the generator would refuse.

### `SchemaVersioning.isPinned` and `SchemaVersioning.next`

`isPinned(version)` answers whether a label is a non-prerelease, and is the one predicate shared by the pipeline's contract guard and the bump. `next(current, change)` answers the label a change warrants: a contract change bumps MAJOR (MINOR on the 0.x line), a prerelease is left alone, and every other change returns `current`.

### The `x-ai-` machine-annotation family

`KeywordFamilies` declares a house `x-ai-` prefix beside the upstream language-server families, so an `x-ai-hint` annotation on an Effect Schema field survives the Draft-07 lowering, passes the ajv strict-mode gate, and classifies as an annotation change in `DocumentDiff`. The family is a namespace, not a vocabulary: `x-ai-hint` (a string) is the one recommended key, values must be JSON, a value must not carry an `$id` at any depth, and key names must stay within ajv's keyword grammar.

## Bug Fixes

- A declared keyword whose name ajv cannot register now surfaces as a root-pathed validation finding instead of a `SchemaValidatorError`, so `SchemaPipeline.check` stays total over its targets.

## Breaking Changes

- `run` and `runOne` gained `SchemaContractChangeError` in their error union; an exhaustive `catchTags` over that channel must handle it.
- A target carrying a pinned `version` whose contract changed is now refused by default where it was previously rewritten in place. Pass `contractChanges: "allow"` to restore the old behaviour.
- `PipelineCheckResult` gained the required field `contractBlocked`; code constructing that shape by hand must supply it.
