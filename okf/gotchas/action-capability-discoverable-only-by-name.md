---
type: Gotcha
title: A capability recon pass at package level misses constructs the kit already ships
description: Checking "does the kit have a package for X" instead of "does the kit have this exact construct" declares real capabilities absent when they already exist under a different or unexpected name.
status: stable
resource: ../../plugin/scripts/construct-annotations.json
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T04:19:44Z
  body_sha256: a202f397661dbd07bb297552b30db55b108822e5bfe763d756910e88139cfcdc
---

# A capability recon pass at package level misses constructs the kit already ships

## What a reader sees

A migration's recon notes list a handful of capabilities as "not in the
kit" — usually something specific, like a particular reporting document
shape or a particular check-state helper — after a search that looked
package by package for something matching that description.

## What they would wrongly conclude

That the absence is real and the next step is either a shim or an
upstream feature request, because the recon pass looked and found
nothing.

## What is actually true

One real migration declared four capabilities absent this way, and none
of them were: each already existed as a specific construct inside a
package whose name did not obviously suggest it. Recon done at package
granularity ("does `@effected/github-actions` cover reporting?") stops too
early; the construct that answers the question can be one export among
many, named for what it does rather than for the capability category a
reader is searching against.

## The check

Do recon at construct level, verified against the installed kit version
rather than memory of an earlier one. The plugin's generated construct
index — `plugin/scripts/construct-annotations.json`, produced
by `generate-constructs.mts` — is the systemic fix: search it for the
specific behavior needed before concluding a capability is absent, and
re-run this recon on every kit bump rather than trusting a prior pass's
conclusion.
