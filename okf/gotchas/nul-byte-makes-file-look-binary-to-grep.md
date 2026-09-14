---
type: Gotcha
title: A single embedded NUL byte makes grep silently skip a text file
description: "A source file with one embedded NUL (U+0000) byte reads as binary to a grep that skips binaries (ugrep -I, the shim behind grep in Claude Code shells), which then prints nothing and exits 1 — indistinguishable from a genuine absence; BSD grep and rg behave differently on the same input."
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
generated:
  by: "claude-code/opus-5"
  at: 2026-09-14T04:45:45Z
  body_sha256: aee51355b9da9099a212e5be9fef3067aff8e35971ef46aa1ff2dffefe64adc5
---

# A single embedded NUL byte makes grep silently skip a text file

## What a reader sees

`grep -c "" some-file` (or any ordinary `grep` search against it) prints
nothing and exits 1 — the same output a search against a file with no
matching content produces. **Which `grep` matters**: this was observed
through the `grep` shell function a Claude Code session installs, which
runs `ugrep` (7.8.4 here) with `-I` — *ignore binary files*. It is not
what every grep does; see below.

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
to every grep, but what each does about it differs, and the silent
no-match is specific to a grep told to *skip* binaries. Probed on
2026-09-14 against a three-line file with one NUL in the middle line:

| tool | `grep -c "" file` | `grep foo file` |
| --- | --- | --- |
| `ugrep 7.8.4` with `-I` (the `grep` shell function in a Claude Code session) | nothing, exit 1 | nothing, exit 1 |
| `ugrep 7.8.4` bare, or `command grep` = BSD grep 2.6.0 (macOS `/usr/bin/grep`) | `3`, exit 0 | `Binary file … matches`, exit 0 |
| `rg` | `4`, exit 0 | `binary file matches (found "\0" byte …)`, exit 0 |

So on the shimmed `grep` the failure is byte-identical to a genuine
no-match; on BSD grep and `rg` there is a visible `binary file matches`
tell, and `-c ""` still counts. GNU grep was not available to probe; it
is reported to print a count and exit 0 for `-c ""` as well (3.8), which
would put it in the second row — treat that as unverified. `grep -a` /
`rg --text` search the file correctly regardless of implementation. A NUL reaches a source file through entirely
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
