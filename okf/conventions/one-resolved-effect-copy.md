---
type: Convention
title: Keep the tree resolved to one effect copy
description: The whole workspace and its build toolchain must resolve to exactly one installed copy of effect, the one the lockfile resolves from the catalogs' stable-line range.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T17:24:58Z
  body_sha256: 991f9ddc08247ca1350ae8d15d802a1f9131b65dde54a31027f9b7f73ccfb1db
---

# Keep the tree resolved to one effect copy

Always treat a second resolved `effect` copy anywhere in the tree — this workspace or its build toolchain (`@savvy-web/*`, rolldown-pnpm-config, vitest-agent) — as a defect to fix at its entry point (the pin, the catalog, or upstream), never as something to route around locally.

This is a correctness requirement, not hygiene. A `Context.Service` tag is an identity: two resolved copies of the same package are two distinct tags, so a layer built from one copy does not satisfy a requirement expressed against the other, and the type system is right to reject it even though the diagnostic rarely says so in those terms. A duplicated `effect` inside one Schema decode pipeline has crashed every package's build with a type error surfacing deep inside a parser (`TypeError: text.charCodeAt is not a function`), and a stale caret across a consumer's own packages has produced `Layer<…> is not assignable to Layer<…>` diagnostics that read like a signature change but are duplicate identity — checking the `.d.ts` diff first (finding it clean) is what points at duplication instead. Never chase this class of error as an API signature bug before ruling out a second resolved copy: the tell is a stack or a lockfile entry naming two different `effect@…` paths.

**Decide whether an `effect` advance strands anything before you make it.** A release of an `@effected/*` package built on the stable line advertises a caret peer (`^4.0.0`); a release built on a release candidate advertises that candidate's exact version. So the answer depends on where the previously-published closure sits:

- **A stable-line advance within `^4` strands nothing.** The lockfile's resolved `effect` moves to a newer `4.x`, a closure published on the stable line still accepts it through its `^4.0.0` peer, and the tree stays one copy. No bridge is needed. The risk that remains is a `@stability unstable` API the kit imports changing in a minor release; the advance's own rebuild and retest is the guard (see [the stable-line decision](../decisions/effect-catalog-tracks-stable-minor.md)).
- **A bridge is needed only when the published closure is on a release candidate or a different major.** A release candidate's exact peer cannot be satisfied by the stable line (the first move onto `4.0.0` strands every release published before it), and a different major breaks the caret. In that case pick the bridge shape by asking one question: does the previously-published `@effected/*` closure still run on the new `effect`?
  - **Runtime-compatible:** bridge old→new with a `pnpm-workspace.yaml` `overrides` block, one entry per stranded package (`effect`, and any platform packages such as `@effect/platform-node` / `@effect/sql-sqlite-node` also stranded at the old spec), rewriting the old spec to the new one. This collapses the tree back to one copy immediately. The plugin ships a scoped example: its `platform-node-shared` overrides, one per release-candidate parent (see [the scoped overrides](../modules/pnpm-plugin-effect.md#the-scoped-platform-node-shared-overrides)).
  - **Runtime-incompatible:** an `overrides` block would run old-pin-built code against the new `effect` and crash at module initialization if the new version removed or renamed an API the published closure calls at import time. Bridge instead with a `packageExtensions` block that pins the **toolchain's own peers** (the `@effected/*` packages the toolchain takes as peers, e.g. via `@savvy-web/tsdown-plugins`) to regular dependencies on the toolchain's still-old `effect`, so the toolchain runs a homogeneous old-pin world while it compiles new-pin source it never executes. Accept two `effect` copies in the lockfile for this window — the tree does not collapse to one until the toolchain republishes.

Never let a `packageExtensions` key match a workspace package's own current version — pnpm applies extensions to local packages too, and an extension matching a workspace package's exact version has silently rewritten that package's own `workspace:*` edge to a published version, or added a dependency it should not have. Diff the lockfile's `importers:` section against the pre-bridge copy on every edit to the block; it must be empty. Retire either bridge only once the packages-section-scoped count of the old spec reaches zero with the block removed — a bare `grep -c` across the whole lockfile is not sufficient, because an `overrides` block's own redirect line (`effect@<old>: <new>`) matches the old spec string without being a second copy.

Full re-pin mechanics are in [advance the effect pin](../runbooks/advance-the-effect-pin.md).
