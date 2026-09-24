---
type: Convention
title: Consumer-facing text states current Effect behaviour, never versions
description: Plugin skills, agents and hooks, and TSDoc comments name no Effect prerelease version and carry no since-version history; they state what is true on the pinned Effect today. The okf bundle may keep version history.
status: draft
stale_after: "2027-03-23T00:00:00Z"
tags:
  - dx
  - docs
sources:
  - id: claude-code-plugin-skills
    resource: ../../plugins/claude-code/skills
  - id: copilot-plugin-skills
    resource: ../../plugins/copilot/skills
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T02:53:15Z
  body_sha256: dcbffcc5c4ddea30992ffab1c77681cd75c4681cde78848dd8139a47325a0b48
---

# Consumer-facing text states current Effect behaviour, never versions

Text that a consumer or a consumer's agent reads states what Effect does
**now**. It names no Effect prerelease version and tells no version history.

The rule covers:

- the plugins, `plugins/claude-code/` and `plugins/copilot/`: skills, their
  references, agents and hooks;
- TSDoc comments in `packages/*/src`, which ship in `.d.ts` files and IDE hovers.

What to write:

- Write `X does Y`, never `since rc.113, X does Y` or `rc.115 changed X to Y`.
- Delete provenance notes such as `verified against rc.115` or `as of beta.99`.
- Delete a statement of what an older build did. Keep it only when a reader
  can still hit it today, and then write it without the number.
- Cite Effect source by module and symbol, with the line resolved against the
  pinned vendored tree. Never name the version.

A version may appear only when the text is about versioning itself. Examples
are an `@effected/*` package's own semver, a package-manager major in a support
policy, and a `catalog:` strategy example such as the `lock` strategy's exact
prerelease pin. A version inside example data whose format is the subject also
counts, such as a lockfile specifier `4.0.0-rc.109(effect@4.0.0-rc.109)` in a
parser's TSDoc. Plain `//` comments in `packages/*/src` do not ship, but they
follow the same rule whenever they are edited: a "probed against beta.101" note
becomes a pointer to the test that pins the behaviour.

Find violations with:

```sh
grep -rnE 'rc\.[0-9]{2,3}|beta\.[0-9]{2,3}|4\.0\.0-(rc|beta)' plugins packages/*/src
```

Every hit is either rewritten or justified as one of the exceptions above.

## Why

- Consumers take the kit's Effect through `catalog:effected`, and the
  prerelease number moves on every advance.
- Every consumer repository pins and vendors its own Effect source.
- Agents are already told to verify every claim against that pinned source.

A version number in a skill or a hover goes stale on the next advance. It also
pulls an agent toward a build it is not running. History teaches nothing that
the current tree does not, and it costs context on every load.

## Where history belongs

The okf bundle may record version history:

- Decisions, Incidents and Measurements keep their dates and versions.
- Runbooks such as [advancing the Effect pin](../runbooks/advance-the-effect-pin.md)
  are about versions.

Agent memory may also keep previous-version detail.

This convention governs only text that ships to consumers. Related:
[skill shape](skill-shape.md) (its voice rule already bans dates and phase
names in skills) and the [evidence ladder](evidence-ladder.md).
