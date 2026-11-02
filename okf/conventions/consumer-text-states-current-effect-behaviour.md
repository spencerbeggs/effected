---
type: Convention
title: Consumer-facing text states current Effect behaviour, never versions
description: Plugin skills, agents and hooks, and TSDoc comments name no Effect prerelease version and carry no since-version history; they state what is true on the pinned Effect today. The okf bundle may keep version history, and so may the effected-renovate upgrade ledger, which is version-keyed by design.
status: draft
stale_after: "2027-03-23T00:00:00Z"
tags:
  - dx
  - docs
sources:
  - id: ai-plugin-skills
    resource: ../../plugin/skills
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T14:55:07Z
integrity:
  generated:
    body: bbe6edc8a1b1feb5
---

# Consumer-facing text states current Effect behaviour, never versions

Text that a consumer or a consumer's agent reads states what Effect does
**now**. It names no Effect prerelease version and tells no version history.

The rule covers:

- the plugin source under `plugin/`, and so both of its builds: skills,
  their references, agents and hooks;
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
policy, and a `catalog:` range or pinned-version example such as the
`~4.<minor>.<patch>` tilde the `effected` catalog holds. Even there, never name a prerelease
number as the Effect version the text describes. A version inside example data whose format is the subject also
counts, such as a lockfile specifier `4.0.0-rc.109(effect@4.0.0-rc.109)` in a
parser's TSDoc. Plain `//` comments in `packages/*/src` do not ship, but they
follow the same rule whenever they are edited: a "probed against beta.101" note
becomes a pointer to the test that pins the behaviour.

**One directory is exempt by design.** Each file under
`plugin/skills/effected-renovate/references/ledger/` names versions and
tracking issues, because a version-keyed delta is the whole job of that
file. An entry's `applies` thresholds select it, and its `closes` list
links its issues. See [the ledger entry model](../models/renovate-ledger-entry.md)
and [the upgrade-ledger decision](../decisions/upgrade-ledger-in-the-plugin.md).
The carve-out is the directory and nothing else. That skill's `SKILL.md`,
its `references/traps.md` and its scripts' prose stay version-free like
every other plugin text.

Find violations with:

```sh
grep -rnE 'rc\.[0-9]{2,3}|beta\.[0-9]{2,3}|4\.0\.0-(rc|beta)' plugin packages/*/src \
  --exclude-dir=ledger
```

Every hit is either rewritten or justified as one of the exceptions above. The
`--exclude-dir=ledger` flag skips the exempt ledger directory.

## Why

- Consumers take the kit's Effect through `catalog:effected`, and the exact
  Effect release the kit builds against moves with its lockfile.
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
