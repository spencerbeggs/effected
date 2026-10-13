---
type: Gotcha
title: A new stringify option added to one adapter silently no-ops on the other two
description: "@effected/yaml has three hand-copied option adapters into the engine's stringify input; adding a field to one and forgetting the others compiles clean and drops the option at runtime."
resource: ../../packages/yaml/src/YamlDocument.ts
status: stable
stale_after: 2027-03-13T00:00:00Z
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 9ec6c412f1b7af6a
---

# A new stringify option added to one adapter silently no-ops on the other two

## What a reader sees

A contributor adds a field to `YamlStringifyOptions`, wires it into
`src/internal/stringifier.ts`, and updates one of the three call sites that
build the engine's `StringifyOptionsInput` — say, `Yaml.ts`. Every test they
ran against `Yaml.stringify` passes. `tsc` is silent, because all three
adapters build the same optional-field object shape, so a field present at
one call site and absent at another is not a type error — an object with
fewer optional keys still satisfies the same type.

## What they would wrongly conclude

That the option is now supported everywhere the package accepts stringify
options, since it works from the entry point they tested and nothing
flagged the other two.

## What is actually true

`Yaml.ts`, `YamlDocument.ts` and `YamlFormat.ts` each hand-copy
`YamlStringifyOptions` onto the engine's `StringifyOptionsInput`
field-by-field rather than through one shared mapping function. Every new
`YamlStringifyOptions` field must be added to all three by hand, and
nothing enforces that structurally — unlike `YamlFormattingOptions`, which
derives its shared fields from `YamlStringifyOptions.fields` by spread
precisely to avoid this class of drift (see [the yaml Module's options
derivation](../modules/yaml.md#jsoncyaml-parity-reconciliation)).

A caller who passes the new option through `YamlDocument#stringify` or
`YamlFormat`'s stringify path — instead of the one adapter that was
updated — silently gets the old, unpatched behavior. Nothing throws and
nothing warns; the option is simply not forwarded to the engine.

The hazard is not hypothetical: `YamlDocument.ts`'s adapter once silently
dropped `quoteStyle`, so a document-path caller setting it got the
`"single"` fallback regardless of what they passed. All three adapters now
forward the full option set, and a node-path regression test pins
`YamlDocument#stringify` under `quoteStyle: "double"` as the tripwire for
the next field added.

## The check

Before considering a new `YamlStringifyOptions` field done, `grep` for the
field name across `src/Yaml.ts`, `src/YamlDocument.ts` and
`src/YamlFormat.ts` and confirm it appears in each adapter's construction of
the engine's stringify input, not just the one call site under test. Add or
extend a regression test on the node path (`YamlDocument#stringify` or a
`YamlFormat` path) for the new field, mirroring the existing `quoteStyle`
tripwire, so a future adapter that drops it fails a test rather than only a
manual `grep`.
