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
  at: 2026-10-10T23:08:17Z
  body_sha256: 330ee8f0caac2b63633cb64c3f4eecc666af11449a9022cc2b4b2529b3191c84
---

# Advance the effect pin

## Trigger

A new `4.x` the kit should build on has published — `effect` core and every satellite, not the satellites alone. The `effect` and `effect:peers` catalogs hold exact versions under `lock`, so the advance moves the catalog literal, the lockfile and the plugin's HOLD overrides together. Only a human runs this procedure's catalog-mutating steps — agents surface the commands and let the user run them. Why the catalog is exact and held by overrides: [the effect catalog locks every entry to an exact version](../decisions/effect-catalog-locked-exact.md).

## Steps

1. **Confirm core published, then lift the hold.** Check that `effect@<new-version>` itself resolves on npm, not only its satellites — a satellite paired with an older core dies at import ([the incident](../incidents/effect-satellites-published-without-core.md)). Then remove the HOLD block (`"<name>@^4.0.0": "4.0.2"`) from `overrides` in `packages/pnpm-plugin-effect/savvy.build.ts` and its `HOLD` map in `__test__/catalog.test.ts`, or move both to the new version if the hold is to stay; the upgrade CLI never rewrites overrides. For the 4.0.3 advance, effected issue 996 carries the full checklist.
2. **Advance the catalogs and the lockfile.** The user runs `pnpm pnpm:up` (`rolldown-pnpm-config upgrade savvy.build.ts` inside `packages/pnpm-plugin-effect`) followed by `pnpm pnpm:export`, which mutates `pnpm-workspace.yaml`'s `effect` / `effect:peers` catalogs and the lockfile. Agents must not invoke either command directly; only surface them. Read the lockfile's resolved `effect` afterwards — that version, not the catalog literal, is what the next steps follow.
3. **Re-pin `.repos/effect` to the lockfile's version, in the same commit.** Run `savvy repos pin effect effect@<resolved-version>` (or the `repos_manage` MCP tool with `action:"pin"`) so the vendored source and the installed version move together by construction — never let the pin land in a separate commit from the lockfile move. Review any `staleNoteIds` the pin flags. See [vendored Effect is pinned to the lockfile's tag](../decisions/vendored-effect-pinned-to-catalog-tag.md).
4. **Move the plugin pin.** Bump `EFFECT_PIN` in `plugin/hooks/session-start/orientation.sh`, the one script both hosts run and the only place the plugin states the pin, then rebuild with `pnpm build --filter @effected/ai-plugin` so both builds carry it. The bats suite (`plugin/__test__/session-start-orientation.bats`) reads the pin from that line and fails until it matches `.repos/config.json`'s effect ref and a lockfile-resolved `effect`, so there is no test literal to bump.
5. **Re-derive the skill anchors.** When the vendored tree moves, re-derive `plugin/__test__/helpers/skill-anchors.json`, which holds the line anchors the skills cite against `.repos/effect`.
6. **Check the unstable APIs the kit uses.** An API tagged `@stability unstable` may break in a minor release. Search the kit's imports for the modules the vendored source tags unstable — every namespace module (`cli`, `process`, `rpc`, `sql`, `ai`, `http` and the rest) and the platform contracts the kit requires in `R` (`FileSystem`, `Path`, `PlatformError`, `Stdio`, `Terminal`, plus `Crypto`, `Graph` and `ByteSize`; `grep -l '@stability unstable' .repos/effect/packages/effect/src/*.ts` lists them all) — and confirm each one the kit uses still has the shape the kit relies on.
7. **Decide whether a bridge is needed.** Within the stable line the catalog itself needs none, but a published closure now advertises an exact `effect` peer, so it does not accept a newer `4.x` until it is republished; release the kit with the advance. A bridge is needed only when the published closure is on a release candidate or a different major, and then the shape depends on whether that closure still runs on the new `effect`. See [one resolved effect copy](../conventions/one-resolved-effect-copy.md) for both shapes and the diagnostic that picks between them. If one is written, install and confirm it closed what it was meant to close: for an `overrides` bridge, the packages-section-scoped count of the old spec reaches zero; for a `packageExtensions` bridge, no published kit package resolves against the new `effect` while the toolchain still builds on the old one, and the lockfile's `importers:` section is unchanged from the pre-bridge copy.
8. **Run a full-kit build and test pass** (`pnpm build`, then the workspace test suite) to catch anything the advance did not anticipate before it lands.
9. **Check the lockfile diff.** Confirm platform binaries (turbo, biome, tsgo) were not stripped by the install, and note any bridge's removal condition in the PR description so a later reader knows when it is safe to take back out.

## Observable end state

The lockfile's resolved `effect`, `.repos/effect`'s pinned tag, and `EFFECT_PIN` in the orientation hook all name the same release; `pnpm test:bats` passes; and `skill-anchors.json` was derived from that vendored tree. The catalogs read the new exact version, and the HOLD overrides are gone or name that same version. A bridge (`overrides` or `packageExtensions`) is present only if the published closure genuinely needs it, is scoped to exactly the stranded packages, and has its removal condition recorded. A full-kit build and test run passes.
