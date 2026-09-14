---
type: Gotcha
title: pnpm peers check is expected to report exactly one occupant
description: "A pnpm peers check warning is expected to name one downstream package pinning an older @effected/* caret than the kit's current release; any other warning is a genuine closure defect, not a second expected residual."
status: stable
resource: ../../pnpm-lock.yaml
stale_after: 2027-03-13T00:00:00Z
tags:
  - compat
  - dx
generated:
  by: "okfit/claude-code"
---

# pnpm peers check is expected to report exactly one occupant

## What a reader sees

`pnpm peers check` reports a warning naming a downstream package's
`@effected/*` peer as unmet — for example, `@tsdoctor/registry@0.2.0`
wanting `@effected/store@^0.4.0` against an installed `0.5.0`. The
warning reads exactly like every other unmet-peer warning the command can
produce.

## What they wrongly conclude

That the warning is drift to chase down and fix in this repository, or
that any further `pnpm peers check` warning belongs to the same
tolerated class and can be left alone the same way.

## What is actually true

Exactly one occupant of this warning slot is expected at a time: a
downstream consumer's own package pinning an `@effected/*` caret one
minor behind the kit's current release — a dogfood consumer that has not
yet adopted the latest minor. It clears on its own once that consumer
bumps its pin, and a different consumer can occupy the slot next after
that. Because the kit's own package versions advance continuously, the
specific package and version named here rotates and this entry will go
stale; treat the pairing above as the occupant as of the date this
concept was last checked, not as a permanent fact.

The satellite-drift class this warning used to also produce — an
`@effect/*` package one release ahead or behind the pin, from the
toolchain's own dependency graph — is retired separately: `pnpm-plugin-effect`
generates a version-qualified `peerDependencyRules.allowedVersions` table
from the lock catalog, so that class no longer warns at all. See [the
generated allowed-versions table](../modules/pnpm-plugin-effect.md#the-generated-allowed-versions-table).

## The check

Any `pnpm peers check` warning that is not this one dogfood-consumer
lag — in particular, anything inside the `@savvy-web`/toolchain graph, or
a second distinct occupant appearing alongside the first — is a genuine
closure defect to fix upstream, never something to silence or read as
license to tolerate.
