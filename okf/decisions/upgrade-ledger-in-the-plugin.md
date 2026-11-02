---
type: Decision
title: Consumer upgrades run one fixed plugin process over an append-only ledger of per-change entries
description: The effected plugin's /effected-renovate skill is the single upgrade process for kit consumers; what each release changed lives as one ledger file per change that a script selects by the versions a consumer's upgrade crosses; rounds reset at plugin release tags and chain back through them, with every fold-or-drop fate approved by the user.
status: stable
tags:
  - release
  - dx
  - docs
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-01T00:00:00Z
  - id: renovate-skill
    resource: ../../plugin/skills/effected-renovate/SKILL.md
  - id: effect-upgrade-skill
    resource: ../../.claude/skills/effect-upgrade/SKILL.md
  - id: upgrades-history
    resource: ../../.claude/upgrades
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T14:55:07Z
verified:
  - by: human:spencer
    at: 2026-11-02T14:54:01Z
integrity:
  generated:
    body: e78c746362c66e16
  verified:
    by: human:spencer
    at: 2026-11-02T14:54:01Z
    content: ccbc42c5f8a801cb
---

# Consumer upgrades run one fixed plugin process over an append-only ledger of per-change entries

Decided 2026-11-01 by the repository owner.[^owner]

## Context

Moving a consumer repository onto a new kit release used to take three
mechanisms that nobody had designed to work together:

- the project-level `effect-upgrade` skill, which advanced this
  repository;
- the owner's global `renovate` skill, which bumped config dependencies
  and reinstalled in any repository;
- a hand-written `.claude/upgrades/<release>.md` document per release,
  which recorded what that release changed for downstream
  projects.[^upgrades-history]

Each mixed a stable process (bump, reinstall, build, test, align) with
content specific to one release. A consumer agent had to read a 300 to
400 line document to find the few items that applied to its own
dependencies and code. It then repeated that read for every release it
had skipped.

## Decision

- **One process, in the plugin.** `/effected-renovate` is the fixed base
  process for kit consumers. It runs bump, lockfile regeneration, the
  one-`effect` check, the applicable-entries step, build, test,
  alignment, changesets and the report. It ships through the plugin, so
  every consumer runs the same version of it.[^renovate-skill]
- **Per-change content in an append-only ledger.** Each change a consumer
  must find or act on is one file under the skill's `references/ledger/`.
  The file states the versions that carry the change and a search that
  finds the old shape. `scripts/applicable.mjs` selects entries
  mechanically, by the thresholds the consumer's own lockfile crossed, and
  attaches the matching lines in the consumer's code. The format is
  [the ledger entry model](../models/renovate-ledger-entry.md).
- **One file per entry**, so that parallel branches each add their own
  file rather than editing a shared document, and they never conflict.
- **This repository authors the ledger** through `/effect-upgrade`, in its
  version mode or in `--record` at branch end beside the changeset pass.
  A bats gate fails when a pending breaking changeset has no
  entry.[^effect-upgrade-skill]
- **Rounds reset at release tags, and only the user resets.**
  `/effect-upgrade --reset` requires the round to be released at an
  `@effected/ai-plugins@<version>` tag. It then points `BASELINE.md`'s
  `previous` at that tag, raises `floor` to the round's highest
  thresholds, deletes the entries and the round's traps, and restarts ids
  at `0001`.
- **The user approves every fate at a reset.** Each round-specific trap
  and each entry is proposed for *fold* or *drop*. A fold moves a durable
  trap or process step into the base, either the skill or its standing
  traps table, written so that it holds on any release. A drop discards
  an item that was specific to the round. Nothing folds or drops
  without the user's approval.
- **`.claude/upgrades/*.md` stop growing.** They stay as history. The
  first ledger round converts the most recent of them.
- **The owner's global `renovate` skill stays** for repositories that do
  not consume the kit. `/effected-renovate` ports its two scripts and adds
  the ledger's renames.

## Why a reset loses nothing

A closed round is not deleted from history. It stays readable at the tag
`BASELINE.md` names. When a consumer's pre-upgrade versions sit below the
current floor, `applicable.mjs` fetches the earlier round from that tag.
It caches the round, and it repeats through each round's own `previous`
until it reaches a round the consumer does not predate. A consumer many
releases behind therefore still gets every entry it crossed, while the
shipped ledger holds only the current round.

## Alternatives rejected

- **Keep the per-release documents and teach consumers to skim them.**
  The read cost scales with release size rather than with what applies,
  and the stable process stays duplicated in every document.
- **One growing ledger, never reset.** Every consumer would pay for every
  entry ever written, and the selection script's input would grow
  without bound. Resetting at tags gives the same reach through the chain
  for a fraction of the shipped weight.
- **One shared ledger file.** Concurrent branches would conflict on every
  addition.
- **Reset automatically on release.** A reset is also the moment to
  decide which lessons become permanent process. That decision is the
  user's, so a reset is never automatic.
- **Fold the global `renovate` skill into the plugin.** Non-kit
  repositories would have to install the effected plugin to upgrade, and
  the ledger means nothing to them.

## Consequences

- The ledger is the one plugin text that names versions and tracking
  issues. [consumer-text-states-current-effect-behaviour](../conventions/consumer-text-states-current-effect-behaviour.md)
  carves it out by path.
- `effected-renovate` is the first plugin skill to ship `scripts/`. They
  must be dependency-free, because an installed plugin has no
  `node_modules`. See [skill shape](../conventions/skill-shape.md).
- A branch that ships a consumer-visible change must write its entry
  before the plugin's next release. Otherwise consumers of that release
  are not told about it.

[^owner]: Conversation with the repository owner, 2026-11-01.
[^renovate-skill]: `plugin/skills/effected-renovate/SKILL.md` — steps 1
    to 8.
[^effect-upgrade-skill]: `.claude/skills/effect-upgrade/SKILL.md` — "The
    upgrade ledger", "Record mode" and "Reset mode".
[^upgrades-history]: `.claude/upgrades/` — one document per advance,
    kept as history.
