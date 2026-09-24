---
type: Interface
title: The package-json decode-free text path
description: PackageJsonFormat's formatter and surgical mutator work on manifest text without ever decoding it — the formatter matching sort-package-json's byte order exactly, and the mutator preserving every untouched byte around an edit — so both work on legal manifests the strict Package decode rejects.
status: stable
kind: api
resource: ../../packages/package-json/src/PackageJsonFormat.ts
tags:
  - dx
sources:
  - id: internal-format
    resource: ../../packages/package-json/src/internal/format.ts
  - id: fixtures-dir
    resource: ../../packages/package-json/__test__/fixtures
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 2111dfd4fc6dd84e455f719eef1ccd0f4e1bce4b324e39671f5146d0967c85db
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:16.643Z
---

# The package-json decode-free text path

## What stays stable

`PackageJsonFormat` exposes two independent capabilities over manifest
**text**, neither of which decodes into `Package`: formatting, which
rewrites a document into the key order the npm ecosystem already
produces, and surgical mutation, which changes one field and leaves
every other byte alone. Both exist because the strict `Package.decode`
path hard-fails on legal input — `{"private": true}` and version-less
roots are both valid manifests the strict decode rejects — which makes
the strict path unusable as a lint or single-field-edit handler. Four
statics form the stable contract:

- **`sortValue`** — value→value, total, returns its input type `T`. Only
  ever reorders keys; it never adds or removes one, and this is
  type-enforced — a key-removing option there is a compile error. A
  non-object input (array, scalar, `null`) returns unchanged rather than
  mangled.
- **`formatToString`** — text→text, `Result<string, PackageJsonSyntaxError>`.
- **`modify`** / **`modifyToString`** — the surgical mutators, taking an
  ordered list of field edits (`{ path, value }`, where `value: undefined`
  deletes) applied through `@effected/jsonc`'s scanner-based edit surface,
  so every byte outside the edited spans — key order, indentation, line
  endings, trailing newline — survives.

`PackageJsonFile.modify` is the same surgical operation read-modify-write
against a path, skipping the write entirely when the result is
byte-identical to what was read.

## Byte-agreement with the ecosystem oracle

The formatter's canonical top-level key order is `sort-package-json`'s
default sort order, re-baselined verbatim rather than hand-curated, with
the source version recorded as provenance beside the
list.[^internal-format] Verbatim is the contract: a hand-curated
near-copy is the shape that drifts silently, since every disagreement
would show up as a diff in a consumer's repository rather than as a
failure here. Unknown keys append after the known ones — public keys
alphabetically, then underscore-prefixed keys alphabetically — matching
the oracle's own behavior. The dependency maps, plus `scripts`,
`engines` and `bin` (all `HashMap`-backed, whose encode order is hash
order and therefore not source order), are alphabetized for the same
reason: source order is already unrecoverable for those fields, so the
choice is hash order or alphabetical, and alphabetical wins.

`__test__/fixtures/` holds real manifests from this repository paired
with frozen oracle output for the same input, and the format test
asserts byte equality.[^fixtures-dir] `sort-package-json` is deliberately
not a runtime dependency of the package — the oracle's *output* is
committed, not the tool, so the parity claim is checked without taking a
dependency edge on the thing being matched. The re-baseline rule is that
the fixtures, the recorded version in the fixture README, and the
key-order provenance comment move together in one deliberate act;
regenerating fixtures alone would silently ratify whatever a newer
oracle version changed, turning the parity test from a check into a
rubber stamp.

## Surgical edits preserve every untouched byte

`modify`/`modifyToString` are the opposite posture from the formatter on
purpose: the formatter's job is canonical order, and the mutator's job is
to leave every byte it did not edit alone, so a tool committing a
one-field change to somebody else's repository produces a reviewable
diff instead of a whole-file rewrite. Neither decodes, so both work on
manifests `Package.decode` rejects. Inserted content matches the
source's own style — indentation and line ending are detected from the
text being edited, not chosen by the writer. Deletion is spelled
`value: undefined`, the same convention `@effected/jsonc`'s own modify
surface uses, so removing a key is always deliberate rather than a side
effect of an absent property. The input is strict JSON, not JSONC — npm
does not accept comments in a manifest, and neither does this path.

## The return-type split, and why it is Result on the text side

The text path returns `Result`, not `Effect`, because lint hosts are
synchronous and an `Effect` return would force every one of them to build
a runtime just to format a file. Effect hosts lift with
`Effect.fromResult` in one call, so the `Result` form serves both
audiences. The options type for the text path is deliberately separate
from the strict path's — a source-text option is meaningless when the
text already *is* the source.
[^internal-format]: `packages/package-json/src/internal/format.ts:11-19`
    — the `KEY_ORDER` constant's provenance comment: "canonical top-level
    key order — `sort-package-json@4.0.0`'s default `sortOrder`."
[^fixtures-dir]: `packages/package-json/__test__/fixtures/` — the
    committed oracle-output fixtures the format test compares against
    byte-for-byte.
