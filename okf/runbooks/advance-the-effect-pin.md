---
type: Runbook
title: Advance the effect pin
description: Move the whole kit onto a new Effect 4.x release the lockfile resolves to, with the vendored source, the plugin pins and the skill anchors moved in the same sequence.
status: stable
tags:
  - architecture
  - compat
  - release
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T17:24:58Z
  body_sha256: 7572cc416bca747d02ae58634a0556f237fa791b08f1e8035bcb1a6b52eb3f14
---

# Advance the effect pin

## Trigger

The lockfile's resolved `effect` moves to a release the kit should build on — a new `4.x`. The catalog literal does not need to change for this: the `effect` and `effect:peers` catalogs hold the caret `^4.0.0`, so a stable-line release is picked up by a fresh resolve, and what an advance decides is which release the kit builds, tests and vendors against. Only a human runs this procedure's catalog-mutating steps — agents surface the commands and let the user run them. Why the catalog is a caret and the lockfile the pin: [the effect catalog takes caret ranges on the stable line](../decisions/effect-catalog-tracks-stable-minor.md).

## Steps

1. **Advance the catalogs and the lockfile.** The user runs `pnpm pnpm:up` (`rolldown-pnpm-config upgrade savvy.build.ts` inside `packages/pnpm-plugin-effect`) followed by `pnpm pnpm:export`, which mutates `pnpm-workspace.yaml`'s `effect` / `effect:peers` catalogs and the lockfile. Agents must not invoke either command directly; only surface them. Read the lockfile's resolved `effect` afterwards — that version, not the catalog literal, is what the next steps follow.
2. **Re-pin `.repos/effect` to the lockfile's version, in the same commit.** Run `savvy repos pin effect effect@<resolved-version>` (or the `repos_manage` MCP tool with `action:"pin"`) so the vendored source and the installed version move together by construction — never let the pin land in a separate commit from the lockfile move. Review any `staleNoteIds` the pin flags. See [vendored Effect is pinned to the lockfile's tag](../decisions/vendored-effect-pinned-to-catalog-tag.md).
3. **Move the plugin pins.** Bump `EFFECT_PIN` in both `plugins/claude-code/hooks/session-start/orientation.sh` and `plugins/copilot/hooks/session-start/orientation.sh`, and `EXPECTED_PIN` in both bats files that assert it (`plugins/claude-code/__test__/session-start-orientation.bats` and `plugins/claude-code/__test__/copilot-session-start.bats`).
4. **Re-derive the skill anchors.** When the vendored tree moves, re-derive `plugins/claude-code/__test__/helpers/skill-anchors.json`, which holds the line anchors the skills cite against `.repos/effect`.
5. **Check the unstable APIs the kit uses.** An API tagged `@stability unstable` may break in a minor release. Search the kit's imports for the modules the release notes mark unstable (most of `cli`, all of `process`, `rpc` and `sql`, much of `ai` and `http` at 4.0.0) and confirm each one the kit uses still has the shape the kit relies on.
6. **Decide whether a bridge is needed.** Within the stable line it is not: a published closure's `^4.0.0` peer accepts a newer `4.x`. A bridge is needed only when the published closure is on a release candidate or a different major, and then the shape depends on whether that closure still runs on the new `effect`. See [one resolved effect copy](../conventions/one-resolved-effect-copy.md) for both shapes and the diagnostic that picks between them. If one is written, install and confirm it closed what it was meant to close: for an `overrides` bridge, the packages-section-scoped count of the old spec reaches zero; for a `packageExtensions` bridge, no published kit package resolves against the new `effect` while the toolchain still builds on the old one, and the lockfile's `importers:` section is unchanged from the pre-bridge copy.
7. **Run a full-kit build and test pass** (`pnpm build`, then the workspace test suite) to catch anything the advance did not anticipate before it lands.
8. **Check the lockfile diff.** Confirm platform binaries (turbo, biome, tsgo) were not stripped by the install, and note any bridge's removal condition in the PR description so a later reader knows when it is safe to take back out.

## Observable end state

The lockfile's resolved `effect`, `.repos/effect`'s pinned tag, `EFFECT_PIN` in both orientation hooks and `EXPECTED_PIN` in both bats files all name the same release, and `skill-anchors.json` was derived from that vendored tree. The catalogs still read the caret range. A bridge (`overrides` or `packageExtensions`) is present only if the published closure genuinely needs it, is scoped to exactly the stranded packages, and has its removal condition recorded. A full-kit build and test run passes.
