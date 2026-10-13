---
type: Gotcha
title: A clean issue tracker on a scaffold is not evidence it works
description: A template repository with zero open issues advertised a dead predecessor API, shipped empty entry files, and had no tests — the absence of open issues measured nobody looking, not nothing being wrong.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: af148b8dd8dbc5bd
---

# A clean issue tracker on a scaffold is not evidence it works

## What a reader sees

A template or scaffold repository shows zero open issues, a recent-looking
commit history, and documentation that confidently describes how to use
it.

## What they would wrongly conclude

That the absence of filed problems means the scaffold works as documented
— that "nobody has reported anything wrong" is equivalent to "nothing is
wrong".

## What is actually true

One audited template had exactly this state — a clean issue tracker — and
was simultaneously advertising a dead predecessor API in its own
documentation, shipping empty entry files with no working skeleton
underneath, and carrying no tests at all. Zero open issues measured that
nobody had exercised the scaffold closely enough to find a problem, not
that none existed. A scaffold earns trust from being audited against the
real consumers that build on it, never from its own issue count, which
reflects how much scrutiny it has received rather than how sound it is.

## The check

Audit a scaffold or template against the record of repositories that
actually consume it — do their claims about what the template provides
hold up against what it actually ships? — rather than treating its own
issue tracker as a readiness signal. A template whose only recent activity
is dependency bumps, with no corresponding re-verification of its
documented claims, is a candidate for this trap regardless of how clean
its tracker looks.
