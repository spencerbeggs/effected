---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - package-json.md
  - ../formatter-convention.md
  - ../effect-standards.md
  - jsonc.md
  - npm.md
---

# @effected/package-json — the decode-free text path

## Overview

Two surfaces in [`@effected/package-json`](package-json.md) treat a manifest as **text and never decode it**: the formatter, which rewrites a document into the key order the ecosystem already produces, and the mutator, which changes one field and leaves every other byte alone. Both live in `src/PackageJsonFormat.ts` and both are reachable from `PackageJsonFile` against a path; the [tolerance ladder](package-json.md#the-tolerance-ladder) places them at its permissive end, below every tier that decodes.

They are opposite postures on purpose — canonical order against untouched bytes — so a caller reaches for one or the other, never both at once.

## Formatting: byte-agreement with the ecosystem oracle

The formatter's job is not "a reasonable order" — it is **the order the ecosystem already produces**, so running the kit's writer over a repo does not churn every manifest against whatever the team's `sort-package-json` pre-commit hook does next.

The canonical top-level key order is `sort-package-json`'s default sort order, **re-baselined verbatim**, with the version recorded as provenance beside the list. Verbatim is the point: a hand-curated *near*-copy is the shape that drifts silently, since every disagreement shows up as a diff in someone's repo rather than as a failure here. Unknown keys append after the known ones — public keys alphabetically, then underscore-prefixed keys alphabetically — matching the oracle's own behavior.

### Map-field alphabetization follows from HashMap, not taste

Sorting alphabetizes the dependency maps for canonical presentation, and `scripts`, `engines` and `bin` join them for a stronger reason: the model carries all three as `HashMap`s, whose encode order is *hash* order. **Source order is already unrecoverable**, so the choice is not "preserve or sort" but "hash order or alphabetical", and deterministic alphabetical wins uncontested. The oracle sorts these identically, except that its `scripts` sort is a grouped one agreeing with plain code-unit order apart from `pre`/`post` pairing.

### `PackageIndent` and `"preserve"`

The indent option is `number | "tab" | "preserve"`. `"preserve"` reuses the source text's indentation, backed by an explicit source-text option — and the file writer supplies it by **reading the file it is about to overwrite** when the caller gives none. That read is the only way `"preserve"` can mean anything at a write site holding a decoded model and nothing else; without it the option would silently degrade to a default and quietly re-indent the file.

### The decode-free formatting seam

`PackageJsonFormat` exists because the strict path **hard-fails on legal input**: decode raises on `{"private": true}` and on version-less roots, both perfectly valid manifests. That makes the strict path unusable as a lint handler. This package is the only one of the kit's four formatters with a *schema* between text and text, so it is the only one where that can happen at all — the three format packages satisfy the constraint by construction.

Four properties are load-bearing, and they are [the kit formatter convention](../formatter-convention.md#the-rules) rather than local choices:

- **A distinct named entry point, never a `{ strict: false }` flag.** A flag would make the strict path's return type a union of guarantees and hide the choice from both the call site and `grep`.
- **Two shapes because two hosts exist** — value→value and bytes→bytes — routed through one internal sort so they cannot drift.
- **The value path only reorders; it never adds or removes a key.** That is what makes the `T → T` return type honest, and it is type-enforced: `tsc` rejects a key-removing option there. Stripping lives on the text path, defaulted **off**. Capabilities that delete are opt-in, always.
- **Input it cannot handle comes back unchanged**, never partially rewritten — a non-object degrades to identity instead of losing data.

The text path returns `Result`, not `Effect`: lint hosts are synchronous, and an `Effect` return would force every one of them to build a runtime to format a file. Effect hosts lift with `Effect.fromResult` in one call, so the `Result` serves both. Its options type is deliberately separate from the strict path's — a source-text option is meaningless when the text *is* the source — and where a default diverges, the divergence and its reason are documented on the member, because that is exactly where a silent edit hides.

### Byte-parity fixtures

`__test__/fixtures/` holds real manifests from this repo paired with frozen oracle output for the same input, and the format test asserts byte equality. **`sort-package-json` is deliberately not a dependency** — the oracle's *output* is committed, not the tool, so the parity claim is checked without taking a runtime edge on the thing being matched.

The **re-baseline rule** is that the fixtures, the recorded version in the fixture README and the key-order provenance comment move **together**, in one deliberate act. Regenerating fixtures alone would silently ratify whatever a newer version changed, turning the oracle test from a check into a rubber stamp.

## Surgical edits preserve every untouched byte

`PackageJsonFormat.modify` / `modifyToString` and `PackageJsonFile.modify` set, replace or delete the value at a field path **without decoding, sorting or reformatting anything else**. This is the exact opposite posture to the formatter above, and both belong here: the formatter's job is the canonical order, the mutator's job is to leave every byte it did not edit alone, so a tool that commits a one-field change to somebody else's repository produces a reviewable diff instead of a whole-file rewrite. Neither decodes, so both work on manifests `Package.decode` rejects.

The engine is [`@effected/jsonc`](jsonc.md)'s scanner-based edit surface, which is why this package takes that edge at all. Three properties come with it:

- **Inserted content matches the source's own style** — indentation and line ending are detected from the text being edited, not chosen by the writer.
- **Deletion is spelled `value: undefined`**, the [jsonc/yaml modify convention](jsonc.md), so removing a key is always deliberate rather than a side effect of an absent property.
- **The input is strict JSON**, not JSONC: npm does not accept comments in a manifest, and neither does this path.

`modify` returns the edits and `modifyToString` returns the applied text, mirroring the two hosts the formatter serves; `PackageJsonFile.modify` is the same operation read-modify-write against a path, alongside the `readManifest` / `writeManifest` pair that works in the [presence-lenient tier](package-json.md#the-tolerance-ladder).
