---
type: Convention
title: Every git constructor and error path carries the redaction mask
description: A GitCommand constructor masks its own sensitive positionals into GitInvocation.redactedArgs; classify and span annotations must use only the redacted form.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: f4d5c915eb582945
---

# Every git constructor and error path carries the redaction mask

This is a stated rule `@effected/git` enforces on itself, not a loose
habit — every constructor and every error path is checked against it
before shipping.

**The mask lives on the pure constructor.** Every `GitCommand` constructor
returns a `GitInvocation { command, redactedArgs }`; the constructor is
the one place that knows which of its own positionals are sensitive. Two
mask kinds exist: a config value (`configSet`) is replaced wholesale by
`<redacted>`; a URL positional keeps everything but an embedded
`userinfo@` credential, so remote names and credential-free URLs stay
fully debuggable. Every remote-accepting constructor rides the URL mask —
`fetch`, `fetchUnshallow`, `lsRemote`, `push`, `pull`, `remoteAdd`,
`remoteSetUrl`, `submoduleAdd` and `submoduleSetUrl`. A new constructor
taking a remote or URL positional must apply the mask; a constructor with
no sensitive positional must produce element-wise identical raw and
redacted argvs, which the test helper's default assertion pins.

**The error model itself is redacted.** `classify` persists only
`redactedArgs` into `GitCommandError.args`, and `message` renders that
redacted vector — raw argv must never survive into an error value. A
pre-spawn guard refusal of a sensitive value reports `<redacted>` too.

**Span annotations carry stable identifiers only** — `cwd`, refs, keys,
paths, remote names — never config values and never URLs.

Both halves of this policy — error redaction and span discipline — are
what a new method must satisfy before it ships. Re-check this convention
against the actual constructor and `classify` implementations on the
listed date, since a policy stated as prose in a package's design
material can silently drift from the code enforcing it as the surface
grows.
