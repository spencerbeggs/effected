---
name: effect-v4-source-lookup
description: >-
  Use before writing, reviewing or relying on an Effect v4 API you have not confirmed in this task: whether a
  symbol exists, its signature, what it does at runtime. Also use when a type error names an Effect symbol, or a
  reviewer's claim about Effect needs settling. Gives the evidence ladder and the probe preconditions that keep a
  probe from passing against the wrong effect.
when_to_use: >-
  does this exist in Effect v4, is there an Either, Context.Tag, what is the signature of, node_modules/effect/src,
  .repos/effect, vendored source, write a probe, type error in an Effect call, typeof says undefined, @stability
  unstable, which effect resolves here
---

# Looking up the truth about Effect v4

Never write, review, or rely on a v4 API you have not confirmed. Memory is confidently wrong, and so is source resolved from a directory that does not depend on `effect@4`: the resolution block below refuses it.

This skill tells you where to look and how far to go. (If the question is
merely "which module does X" — start at
[effect-v4-module-index](../effect-v4-module-index/SKILL.md), then verify
here. For a kit construct, grep
[effected-packages](../effected-packages/SKILL.md)' construct index first.)

## The one-minute path

Most questions are "does `X` exist, and what is its signature?" That is rung 2,
and it takes three steps:

1. Run [the resolution block](#resolving-src-and-effect_src) once per shell. It
   refuses a v3 `effect`.
2. `grep -n "export const X\|export function X\|export {" "$EFFECT_SRC/<Module>.ts"`;
   a namespace module is `$EFFECT_SRC/<ns>/<Module>.ts`.
3. Read the TSDoc above the declaration, `@stability` tag included.

Grep by symbol name, never by a line a skill cites: a `Module.ts:N` citation
names the vendored tree's line, and the installed copy's lines differ. A claim
about behaviour needs rung 3, [the probe](#probe-protocol).

**Every claim this skill settles is written about current behaviour, never a
version.** Cite a source finding by module and symbol, with the line resolved
against the vendored tree, and never name a pinned Effect version as history —
the reader takes their own Effect through their own pin, and a number in a claim
goes stale on the next advance without teaching anything the current tree does
not already show.

## The evidence ladder

Three rungs, ordered by cost. Each settles a strictly different class of question. Climb to the rung your claim needs — no further, no less.

| Rung | Where | Settles |
| --- | --- | --- |
| 1 | `$SRC/migration/*.md`, `$SRC/ai-docs/`, `$SRC/LLMS.md` | **Renames** |
| 2 | `$SRC/packages/*/src`, or `$EFFECT_SRC` | **Existence and signature** |
| 3 | A probe compiled and run from inside a package | **Semantics** |

**Rung 2 also tells you how far to trust an API.** Every module and directly importable export carries an explicit TSDoc `@stability` tag: `stable` follows strict semver, `unstable` may break in a minor release — and the unstable set includes the platform contracts `FileSystem`, `Path`, `PlatformError`, `Stdio` and `Terminal` (`effect-v4-module-index` lists the rest). Grep the source for the tag (`grep -n "@stability" $SRC/packages/effect/src/<Name>.ts`) before building on an API, and treat an unstable one as a moving target: pin your usage behind one seam and re-verify it when the installed `effect` moves.

### Resolving `$SRC` and `$EFFECT_SRC`

Two source roots, and they do not settle the same rungs. **Always use the absolute
form** — the probe protocol below has you `cd` into a package, and every relative
path breaks the moment you do.

- **`$SRC`** — a vendored Effect checkout under `.repos/`, pinned to the exact
  `effect` tag the workspace compiles against. Serves rungs **1 and 2**, and only
  where a repository vendors it.
- **`$EFFECT_SRC`** — `node_modules/effect/src`, the complete published v4 source,
  `internal/` included, at exactly the version the lockfile resolves. Serves rung
  **2 only**. Every `@effect/*` package ships its `src` the same way.

> **`$EFFECT_SRC` is the authority on existence and signature. `$SRC` is a convenience
> and the only home of rung 1.** When they disagree, `node_modules` wins — it is what
> your code links against; the vendored tree is what someone pinned last.

```bash
# Rungs 1+2 — the vendored tree, if this project has one.
SRC="${EFFECT_SMOL_SRC:-${CLAUDE_PROJECT_DIR}/.repos/effect}"
test -d "$SRC/packages/effect/src" || SRC=""

# Rung 2 — the installed source. Resolve it, then GATE ON THE VERSION.
EFFECT_SRC="$(node -p 'const p=require("node:path");p.join(p.dirname(require.resolve("effect/package.json")),"src")' 2>/dev/null)"
test -d "$EFFECT_SRC" || EFFECT_SRC=""
if [ -n "$EFFECT_SRC" ]; then
  V="$(node -p 'require("effect/package.json").version' 2>/dev/null)"
  case "$V" in
    4.*) ;;
    *) echo "REFUSING \$EFFECT_SRC: resolved effect@$V, not v4. cd into a package that depends on effect@4." >&2
       EFFECT_SRC="" ;;
  esac
fi

if [ -z "$SRC" ] && [ -z "$EFFECT_SRC" ]; then
  echo "FATAL: no Effect v4 source. Set EFFECT_SMOL_SRC, or cd into a package that depends on effect@4." >&2
  exit 1
fi
[ -z "$SRC" ] && echo "NOTE: no vendored tree — rung 1 unavailable. Settle renames at rung 2." >&2
```

**The version gate is the load-bearing line, and it must refuse rather than report.**
`effect@3` also publishes `src/`, so wherever a v3 is installed, `require.resolve`
finds `node_modules/.pnpm/effect@3.x/.../src` — a complete, confident, *wrong* rung-2
source. A block that merely *prints* the resolved version reports v3 source in passing,
and a reader skims past it. Refuse, and the trap cannot spring. The bottom of the
ladder is a hard failure, never a fallback to memory — a wrong answer from v3 memory
is indistinguishable from a right one.

Before you settle a rung-2 question from `$SRC`, read a platform implementation
(the Node `FileSystem`, say), count `effect` copies in a lockfile, or work in a
project with no vendored tree, load
[source-roots-and-drift.md](references/source-roots-and-drift.md): the vendored
tree can lag the install, its line numbers differ from the installed copy's even
at the same version, and the pnpm store lists copies the lockfile no longer
holds. Each of these hands you a stale answer with no error.

### Every cheap rung has a known lie

- **Rung 1 settles renames and nothing else.** The migration notes are silent on
  whole removals and assert things the source refutes: `migration/fiberref.md`
  lists `Differ` as removed, and **`Differ` is alive** (`index.ts:195`). A
  removal, an existence claim or a trait's mechanics is rung 2.
- **`SCHEMA.md`** at the pin is a fast, version-exact diff oracle, and it is still
  wrong in places. Settle a disagreement in `src`.
- **A bare existence grep reports *absent* for a name that collides with a
  built-in** (`Array`, `Record`, `Map`, `Error`, …): core defines it under a
  private name and renames it in an `export {}` block. Never conclude "removed"
  from that grep.
- **A runtime `typeof` says `undefined` for a type-only export** such as
  `Context.Key`.
- **A third-party `.d.ts` is rung 2 for that package**; its docs are rung 1.

Before you conclude a symbol was removed, design on a migration note's claim,
lean on `SCHEMA.md`, or design against another package's types, load
[when-rungs-lie.md](references/when-rungs-lie.md): it has the documented gaps and
false claims, the export-block mechanism with its confirmed sites, a worked
example where all three rungs disagree, the registry rung for "is it released",
and the tie-break for two reads of one file that disagree.

### Rung 3 is the only one that settles behaviour

Existence and signature do not tell you what a function *does*. Real examples where the signature was innocent and the behaviour was not:

- `Effect.cached` memoizes the first **failure** as well as the first success, so an `Effect.retry` around the memo replays the cached failure and never re-runs the source. Interruption is the opposite: it is never cached, and an abandoned run is restarted by the next caller.
- `it.effect` **always** installs a virtual `TestClock`, so `Effect.sleep` / `delay` / `timeout` hang silently to the vitest timeout.
- `Effect.catchCause` swallows interrupts. A probe built on it reports success exactly where real code hangs. When the exposure is a defect, use `catchDefect`.

## Probe protocol

A probe that cannot fail is worse than no probe. Every precondition below exists because it was violated.

1. **Run from inside the package, never the repo root.** A workspace root that has a v3 installed resolves it and will describe the v3 surface with total confidence; a root that has none fails with `ERR_MODULE_NOT_FOUND` instead. Both are the same rule: only `packages/<pkg>/` is guaranteed to resolve the pinned v4.
2. **Print the resolved version inside every probe, and compare it to the installed `effect` and the vendored tag — never to a prerelease channel word.** A catalog entry is a range, so it cannot be the exact match: the exact version is the **lockfile's resolution**, the `version` in `node_modules/effect/package.json` (and the vendored tree's tag). The probe prints what *it* resolved and that must equal both; a mismatch means the probe linked a different copy or the vendored tree is stale. Resolving **v3** (`3.x`) voids a probe outright.
3. **Probe files live at the package root** — *inside* `packages/<pkg>/`, written there, not merely run from there, unless the repository has a dedicated probe workspace.
   - **Outside the package, it will not even load.** Node resolves bare imports relative to the **script's own path, not the cwd**. A probe in a scratch or temp directory, the harness's scratch directory included, dies with `ERR_MODULE_NOT_FOUND: Cannot find package 'effect'` however carefully you `cd` first.
   - **In a *subdirectory* of the package, it silently false-passes.** The tsconfig `include` is `${configDir}/*.ts` and does **not** match subdirectories, so the probe drops out of the compilation program and its control error never fires.

   The safe spelling is `packages/<pkg>/probe.ts` — package root, top level, never named `*.test.ts`.
4. **Run the control first.** Write a line you *know* must fail. Watch it fail. Only then write the real assertion. For a behavioural probe, the control proves the probe can *observe the effect at all*.
5. **A probe of any multi-value API must exercise a NON-first member.** A probe that constructs with the first literal of a union, the first element of a list, or the first overload succeeds under both the correct reading and a silently-degraded one — it cannot fail, so it settles nothing. A `Schema.Literal("a", "b", "c")` probe that constructs with `"a"` passes either way; only a `"b"` construction exposes a runtime that keeps the first literal and drops the rest.
6. **Delete the probe by absolute path** when done, and check `git status --porcelain packages/<pkg>` before you report.

Before you write a probe file, load [probe-venues.md](references/probe-venues.md):
it holds the venue table (a probe workspace or the package root, decided by the
probe's subject), the `npx tsx` form for internal modules, why `tsc` runs bare
(a file argument is `TS5112`), the type-level and behavioural controls, and the
`ERR_AMBIGUOUS_MODULE_SYNTAX` trap in a version print. A probe in the wrong
place either never loads or passes without compiling.

**Never trade the loud failure for a quiet fallback.** Each step above resolves to a
*version-exact source tree* or it does not resolve. There is no step that resolves to
recollection. Silent degradation into memory is the precise failure this skill
exists to prevent, and it is indistinguishable from success.

## Additional resources

- [references/source-roots-and-drift.md](references/source-roots-and-drift.md) — what `$SRC` and `$EFFECT_SRC` each serve, where the platform implementations live under pnpm, the three drifts (stale tree, same-version line numbers, lockfile copies) with a one-line check for each, the read-only rule and portability. Load when: the vendored tree and the install might disagree, you need a platform implementation's source, a lockfile shows two `effect` versions, or the project has no vendored tree.
- [references/when-rungs-lie.md](references/when-rungs-lie.md) — the migration notes' gaps and false claims, `SCHEMA.md`'s limits, the built-in-name grep false negative with its confirmed sites and three ways to settle it, the `Context.Key` worked example, third-party types, the registry rung and the committed-blob tie-break. Load when: a grep says a symbol is gone, a doc claims something about a symbol, you design against a dependency's types, you ask whether a fix is released, or two reads of one file disagree.
- [references/probe-venues.md](references/probe-venues.md) — the two "scratchpads", the venue-by-subject table, the package-root riders, the run commands, the bare-`tsc` rule, and the type-level and behavioural controls. Load when: writing, placing, running or deleting a probe.
