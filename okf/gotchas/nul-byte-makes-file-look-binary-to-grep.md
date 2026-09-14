---
type: Gotcha
title: A single embedded NUL byte makes grep silently skip a text file
description: "A source file with one embedded NUL (U+0000) byte reads as binary to grep and rg, which then skip its contents and report a no-match indistinguishable from a genuine absence."
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
generated:
  by: "okfit/claude-code"
---

# A single embedded NUL byte makes grep silently skip a text file

## What a reader sees

`grep -c "" some-file` (or any ordinary `grep`/`rg` search against it)
prints nothing and exits 1 — the same output a search against a file with
no matching content produces.

## What they wrongly conclude

That the search term is genuinely absent from the file, or — worse, once
this happens against a file that was already suspicious — that `grep`
itself is unreliable and every prior negative result it produced needs
re-checking by some other method. Both conclusions were reached in this
repository's history from a single bad control: a `grep -c ""` run that
returned nothing was read as proof `grep` was broken, and that led to
"every grep-derived negative is unverified" as a blanket conclusion.

## What is actually true

A single embedded NUL (`U+0000`) byte makes the whole file read as binary
to `grep`, which skips binary files by default — `grep` prints nothing
and exits 1, byte-identical to a genuine no-match. `rg` at least reports
`binary file matches` and exits 0, which is the one visible tell between
the two tools on the same input. `grep -a` / `rg --text` search the file
correctly regardless. A NUL reaches a source file through entirely
ordinary means — a delimiter embedded in a template string, for instance
— so this is a property of one specific file, never of the search
environment or the tool.

The control that actually diagnosed this: rerunning the same `grep -c ""`
against a different, known-good file it was confident about. That control
returned a non-zero count immediately, which located the problem in the
one file, not in `grep`.

## The check

Before concluding a tool is unreliable from a suspicious no-match, run
the exact same query against a **known-good** input, not the file that
produced the surprising result — a positive control run against the
suspect input cannot distinguish "the tool is broken" from "this input is
special." If a text search comes up empty against a file you are
confident should match, check whether the file contains an embedded NUL
byte before concluding the content is absent.
