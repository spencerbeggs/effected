---
type: Convention
title: A plugin skill is a lean index over references
description: Every SKILL.md is an intro, a construct-to-import table, positive-imperative standards, one-line footguns pointing at a reference, and a described Load-when-guarded resources list — depth lives one level down in references/, never nested.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
sources:
  - id: effected-packages-skill
    resource: ../../plugins/claude-code/skills/effected-packages
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T04:12:55Z
  body_sha256: dca29f588b97548789f4edb2bfdcd7f1ffe8ff5057d7c952cb9a82fb0affc5ca
---

# A plugin skill is a lean index over references

Every skill under `plugins/claude-code/skills/` is a lean index over
references, not a monolith. A `SKILL.md` carries:

- An intro.
- A construct-to-import table with a "reach for it when" column.
- **Standards** written as positive imperatives, never as "don't" lists
  standing alone.
- One-line **Footguns**, each pointing at the reference that explains it
  in depth.
- An **Additional resources** section of explicit relative links, each
  carrying a description and a **Load-when** guard.

Depth lives in `references/*.md`, one level deep with no further
nesting.

## Why the shape is a load-cost decision

A skill's body is paid on every trigger, while a reference is paid only
when its own guard says the reader needs it. That is also why the
resource links are explicit and described rather than a bare directory
listing: an agent cannot decide whether a read is worth its cost on a
file it can only see the name of.

## The voice is timeless and consumer-facing

Skills name packages as `@effected/<name>` and carry no repo-relative
paths, run ids, issue numbers or dates. Where a count is load-bearing, it
is stated as the grep that produces it rather than a number that silently
ages, because the reader is in a *consumer* repository and history that
reader cannot act on is cost without payoff. The same reasoning bans an
Effect prerelease version or since-version history from a skill's own
prose — see
[consumer-text-states-current-effect-behaviour.md](consumer-text-states-current-effect-behaviour.md)
for the full rule and its narrow exceptions. Citations into the vendored
Effect source are the sanctioned exception, and they are load-bearing
rather than merely tolerated: a `Module.ts:line` anchor is what lets a
reader settle a v4 claim against source instead of trusting the skill's
prose. They are written module-relative so the *path* resolves against a
consumer's `node_modules/effect/src` as well as the vendored tree, but the
**line number does not**: at the same version, npm's published `effect`
carries publish-time TSDoc the vendored tag does not, so a declaration
sits at a different line in each tree. A `Module.ts:line` anchor names the
vendored tree's line; a consumer without that tree finds the same
declaration in `node_modules` by symbol name instead. The cost is that an
anchor is a pinned fact — an Effect catalog advance drifts every anchor at
once, so re-verifying them belongs with the catalog bump, not on a
schedule of its own.

## The frontmatter contract

A skill's frontmatter splits triggering from cataloguing: a trigger-first
`description` leading with the strongest use case and carrying no
construct-listing prose, plus a separate `when_to_use` catalog of trigger
phrases. The two together stay under the plugin host's listing cap.

`plugins/claude-code/skills/effected-packages` is a working example of
the shape at scale: an intro, the per-package routing table, standards,
footguns, and a `references/` tree including the generated construct
index.[^effected-packages-skill]

[^effected-packages-skill]: `plugins/claude-code/skills/effected-packages` —
    a `SKILL.md` plus `references/`, including the generated
    `references/constructs/` construct index.
