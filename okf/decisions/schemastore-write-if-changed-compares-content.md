---
type: Decision
title: SchemaFile's write-if-changed compares parsed content, not bytes
description: Content comparison is the default for write-if-changed, with byte-exact comparison an opt-out, because a repo that formats its JSON makes byte comparison never converge.
status: draft
sources:
  - id: schema-file
    resource: ../../packages/schemastore/src/SchemaFile.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d104b633e85f2f42
---

# SchemaFile's write-if-changed compares parsed content, not bytes

## Context

`SchemaFile.write` only rewrites a generated document when it actually
differs from what is on disk, so a CI run that regenerates schemas does
not touch files that did not change. The comparison mode decides what
"changed" means.

## Decision

Comparison is by parsed content by default, with a byte-exact mode
(`compare: "bytes"`) as an explicit opt-out. Object key order is not a
difference under content comparison, since a formatter may legitimately
sort keys; array order is a difference, because array order is data.
`write` and `check` share one internal comparison helper so the two
routes cannot disagree, and `check` never writes, since a CI drift job
must not regenerate. An existing file that does not parse is classified
as a contract change and repaired, not failed typed, so a
hand-corrupted generated file stays regenerable rather than permanently
stuck.

## Alternatives rejected

**Byte-exact comparison as the default.** This falsifies the whole
"unchanged" promise in the common case: a repo whose pre-commit hook
formats staged JSON reformats the file the writer just produced, so the
next run reads back different bytes, finds them different, and rewrites
— forever. "Unchanged" becomes unreachable, and a CI drift check fails
on a document whose content never actually changed. A repo that formats
its JSON is the common case here, not the exotic one, and the only
consumer-side fix available under byte comparison was a formatter
carve-out caused entirely by the comparison's own layer choosing the
wrong equivalence.

## Consequences

`outcome`/`wouldWrite` are the authoritative "was/would the file be
touched" answers; never infer either from `change`, which reads
`"none"` on a `compare: "bytes"` write even when bytes changed. Two
consequences that are not obvious follow directly from choosing content
comparison:

- **Reading the file back is not a sufficient drift check on its own.**
  With value comparison, a legitimate write can leave a formatter's
  bytes on disk that differ textually from what the writer emitted, so a
  text-comparing drift test would disagree with the writer itself.
  Hence `check` exists as a separate, non-writing comparison that
  answers both the content question and the would-this-write question,
  agreeing with the writer under either comparison mode because both
  routes compute from the one internal helper.
- **A file that fails to parse reads as changed, not broken.** Classifying
  unparseable on-disk text as a contract change (rather than an IO
  failure) is what keeps a hand-corrupted generated file regenerable —
  failing there instead would leave that file permanently stuck, which
  is worse than overwriting something that was not a valid document in
  the first place.
