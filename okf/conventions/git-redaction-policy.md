---
type: Convention
title: Every git constructor and error path carries the redaction mask
description: A GitCommand constructor masks its own sensitive positionals into GitInvocation.redactedArgs (URLs through GitRemote.redact, everything else through a form-independent backstop) and carries a scrub closure for git's stderr; error values and span annotations use only the redacted forms.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T14:31:24Z
integrity:
  generated:
    body: 9ffc8771da39d65f
---

# Every git constructor and error path carries the redaction mask

This is a stated rule `@effected/git` enforces on itself, not a loose
habit — every constructor and every error path is checked against it
before shipping.

**The mask lives on the pure constructor.** Every `GitCommand` constructor
returns a `GitInvocation { command, redactedArgs, scrub }`; the constructor
is the one place that knows which of its own positionals are sensitive.
Two mask kinds exist: a config value (`configSet`) is replaced wholesale by
`<redacted>`; a URL positional is redacted by form. Every remote-accepting
constructor rides the URL mask — `fetch`, `fetchUnshallow`, `lsRemote`,
`push`, `pull`, `remoteAdd`, `remoteSetUrl`, `submoduleAdd` and
`submoduleSetUrl`. A new constructor taking a remote or URL positional must
apply the mask; a constructor with no sensitive positional must produce
element-wise identical raw and redacted argvs, which the test helper's
default assertion pins.

**A URL positional is redacted in two steps.** The value is parsed with
`GitRemote.parse`. When it is a URL, bare or as a `<transport>::` address,
it goes through `GitRemote.redact` and is rendered back: the password is
dropped, and the user, the query (from `?` to the end, fragment included)
and a scheme outside RFC 3986's grammar each become `<redacted>`; the
userinfo ends at the **last** `@`, so a password holding `@`, `/`, `?` or
`#` is consumed whole; a transport's URL scheme is kept only when it is
well-known (`http`, `https`, `ssh`, `git`, `file`, `ftp`, `ftps`, `rsync`,
`svn`, `git+ssh`, `ssh+git` and the like), since after `::` it is free text.
Every other form, and a blank string, goes through the form-independent
**backstop**: it masks the span from the earlier of (a) just past the
first `//` run or (b) just past the first `:` and any `:`/`/` run after
it, up to the **last** `@`, and leaves a value untouched when that `@`
precedes every `:` and `//` (the scp user of `git@github.com:o/n`). The
backstop masks a mistyped credential URL that parses as no URL at all
(`https:://u:tok@h/r`, `https:/u:tok@h/r`, `//u:tok@h/r`). Remote names,
credential-free URLs and a plain scp `git@host:path` stay fully
debuggable. **Over-masking is accepted**: an `@` in a URL path is read as
userinfo, so `https://host:8080/a@b` logs as `https://<redacted>@b` and the
host is lost, and the backstop pulls any text before a late `@` into the
mask. Redaction changes only what is logged; `GitRemote.parse` stays
faithful to git.

**The error model itself is redacted.** `classify` persists only
`redactedArgs` into `GitCommandError.args`, and `message` renders that
redacted vector — raw argv must never survive into an error value. A
pre-spawn guard refusal of a sensitive value reports `<redacted>` too.
**Stored stderr is masked as well**, because git echoes a remote it could
not use, token included. `GitCommandError.stderr` (and a spawn failure's
`detail`) passes through two maskers: first the invocation's `scrub`
closure, which replaces every exact occurrence of each secret the argv
carries (each whole-value secret, and for each remote URL every part
`GitRemote.redact` would change: the userinfo and password segments,
a masked scheme and the query, but never the bare user name, which would
mask ordinary words; longest first; secrets under three characters are
skipped, since a one- or two-character mask would garble the text and
protect nothing), then the backstop applied token by token to every
whitespace- or quote-delimited token holding an `@`. `scrub` is a closure
rather than a field so the raw secrets are never an enumerable value a
serializer could surface. **Classification reads the raw stream**; only
the stored copy is masked.

**Span annotations carry stable identifiers only** — `cwd`, refs, keys,
paths, remote names — never config values and never URLs.

Both halves of this policy — error redaction and span discipline — are
what a new method must satisfy before it ships. Re-check this convention
against the actual constructor and `classify` implementations on the
listed date, since a policy stated as prose in a package's design
material can silently drift from the code enforcing it as the surface
grows.
