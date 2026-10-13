---
type: Gotcha
title: SectionId keys render into markers exactly as constructed, with no normalization
description: SectionId keys are stored, rendered and compared verbatim and case-sensitively — a consumer expecting the renderer to normalize case gets silent duplication instead of a match, because canonicalization never happens and must be done at construction.
status: stable
resource: ../../packages/templates/src/Section.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 3c586552d1d8e844
---

# SectionId keys render into markers exactly as constructed, with no normalization

## What a reader sees

A file already carries managed section markers written with one casing —
say, `SAVVY-LINT` — from a predecessor tool. A consumer constructs a
`SectionId` with the key spelled differently in case (`savvy-lint`) and
calls `check` or `sync` against the existing file, expecting the marker
scanner to recognize the same logical section. `check` reports the section
absent, and `sync` appends what looks like a brand-new copy of the block
underneath the original.

## What they would wrongly conclude

That `sync` intelligently detected a missing section and correctly added
it, when what actually happened is that the tool now believes there are
two distinct sections in the file — the original, untouched block it does
not recognize, and the new one it just wrote.

## What is actually true

`SectionId` keys are stored, rendered and compared verbatim and
case-sensitively, by design: rendering verbatim and matching exactly go
together, because an uppercasing renderer paired with case-sensitive keys
would let two distinct keys collide into one marker, and an uppercasing
transformation on the schema side would break the round trip the kit's
schema standards require on the encoded side. There is no canonicalization
step anywhere in the pipeline. A file already carrying `SAVVY-LINT`
markers is managed correctly only by declaring exactly that key — this is
specifically the migration hazard for anyone porting from a predecessor
tool whose marker formatting normalized case, and it produces silent
duplication with no compile error, caught only by actually round-tripping
real files.

## The check

Match the exact casing of any pre-existing markers when constructing a
`SectionId` for a file that already has managed sections from a
predecessor tool. Do canonicalization, if any is wanted, at the point a
`SectionId` is constructed — never assume the renderer or scanner will
normalize a key on the caller's behalf.[^section-id]

[^section-id]: `packages/templates/src/Section.ts:9-11` — "Keys are
    **case-sensitive** and rendered verbatim: the key a consumer declares
    is the key the marker carries."
