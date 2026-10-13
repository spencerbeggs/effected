---
type: Convention
title: Treat line endings as a first-class invariant in any file-rewriting code
description: Detect and preserve a document's dominant EOL, and normalize for comparison rather than for storage, or drift detection silently breaks on CRLF input.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 82fc754f13a97d50
---

# Treat line endings as a first-class invariant in any file-rewriting code

Never write code that rewrites part of a document — locating markers,
sections, or other delimited regions — without deciding, explicitly, how it
handles `\r\n` versus `\n`. An LF-only implementation fails silently in
both directions: a `$`-anchored scan under the `m` flag leaves a trailing
`\r` inside the matched line, so a pattern built assuming LF-only input
never matches inside a CRLF file, and content meant for a CRLF file that is
compared as if it were LF-only reports drift forever and rewrites on every
run.

Follow [`@effected/templates`'s rule](../modules/templates.md#line-endings-are-a-first-class-invariant):

- Detect the document's dominant end-of-line sequence at parse time and
  expose it; render any new content — markers, inserted separators — using
  that detected sequence, and default a brand-new document to `\n`.
- Normalize for **comparison**, on both the parsed side and the declared
  side, not inside a value's structural equality. Putting EOL
  normalization inside a custom `Equal` implementation makes direct
  equality checks on two values dishonest for any other caller that
  compares them without going through the comparison path.
- Preserve a trailing-newline-free file as trailing-newline-free unless new
  content is genuinely appended, and preserve a byte-order mark rather than
  stripping it — reading through a decoding path that silently strips a
  leading BOM (as `FileSystem.readFileString`'s default `TextDecoder` does)
  violates a preservation promise invisibly to any in-memory test double.
- When capturing a trailing `\r` in a scanning pattern, capture it as a
  lookahead, never as a consumed character in the same match group whose
  span gets re-emitted later — consuming it drops one `\r` per
  reconciliation pass and the document never reaches a fixed point.

Test this with real CRLF fixtures run through the whole scenario set, not
only synthetic LF fixtures with a CRLF flag flipped: a mutation that drops
EOL normalization inside comparison can still pass a suite whose CRLF
coverage never included a *caller* supplying CRLF content rather than
merely a CRLF *document*.
