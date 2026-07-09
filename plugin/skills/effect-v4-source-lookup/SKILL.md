---
name: effect-v4-source-lookup
description: Use when you need to confirm an Effect v4 API before relying on it — does this symbol exist, what is its signature, what does it actually do at runtime. Gives the evidence ladder (migration notes settle renames, vendored source settles existence and signature, only a probe settles semantics) and the probe preconditions that keep a probe from silently false-passing against Effect v3.
---

# Looking up the truth about Effect v4

Never port, review, or write against a v4 API you have not confirmed. v3 memory is confidently wrong, and so is the v3 source that the workspace root happily resolves.

This skill tells you where to look and how far to go.

## The evidence ladder

Three rungs, ordered by cost. Each settles a strictly different class of question. Climb to the rung your claim needs — no further, no less.

| Rung | Where | Settles |
| --- | --- | --- |
| 1 | `$SRC/migration/*.md`, `$SRC/ai-docs/`, `$SRC/LLMS.md` | **Renames** |
| 2 | `$SRC/packages/*/src`, or `$EFFECT_SRC` | **Existence and signature** |
| 3 | A probe compiled and run from inside a package | **Semantics** |

### Resolving `$SRC` and `$EFFECT_SRC`

Two source roots, and they do not settle the same rungs. **Always use the absolute
form** — the probe protocol below has you `cd` into a package, and every relative
path breaks the moment you do.

- **`$SRC`** — a vendored `effect-smol` checkout, a `git subtree` pinned to the exact
  `effect` release tag the workspace compiles against. Serves rungs **1 and 2**.
  Present when this plugin runs from the `effected` monorepo; absent elsewhere.
- **`$EFFECT_SRC`** — `node_modules/effect/src`. Serves rung **2 only**, and does so
  at full fidelity: `effect` publishes `src/**/*.ts` in its `files` array, so every
  consumer already has the complete v4 TypeScript source, `internal/` implementations
  included. The lockfile pins it to exactly the version you compile against — so on
  the existence-and-signature question it is at least as trustworthy as the subtree,
  which can drift from the catalog between re-pins. Every `@effect/*` package ships
  the same way (`@effect/platform-node`, `@effect/vitest`, …), so resolve whichever
  one your claim is about — the subtree's `packages/*/src` has a `node_modules`
  counterpart in each case.

Resolve both before you trust any lookup. The bottom of the ladder is a hard failure,
never a fallback to memory — a wrong answer from v3 memory is indistinguishable from
a right one.

```bash
# Rungs 1+2 — the vendored subtree, if this project has one.
SRC="${EFFECT_SMOL_SRC:-${CLAUDE_PROJECT_DIR}/repos/effect-smol}"
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
`effect@3` also publishes `src/`, so from the workspace root `require.resolve` finds
`node_modules/.pnpm/effect@3.21.4/.../src` — a complete, confident, *wrong* rung-2
source. An earlier draft of this block merely *printed* the resolved version; it
resolved v3 source at the repo root and reported it in passing. Print a version and a
reader skims past it. Refuse, and the trap cannot spring.

**Rung 1 has no fallback.** The npm package ships no `migration/`, no `ai-docs/`, no
`LLMS.md` — they are not in its `files` array. That degrades honestly rather than
silently: rung 1 is prescriptive, not authoritative, and (as below) a removal is never
settled by it anyway. When `$SRC` is absent, say so and climb to rung 2.

The vendored tree is **read-only**. Never point a writing tool at it: the repo's
markdownlint config sets `"fix": true`, and running it over the tree silently rewrites
the migration notes. A corrupted rung-1 source cannot be detected by reading it — only
by `git status "$SRC"`.

### Rung 1 is prescriptive, not exhaustive

The migration notes document the *recommended path*, not the surface. They are excellent for renames and silent about everything else. Verified gaps, each of which cost real work:

- `migration/services.md` migrates `Context.Tag` → `Context.Service` and **never mentions `Context.Key`** — which is the primitive you need for a type-only key, and whose `out Shape` covariance means a `Context.Key` parameter will *not* give you the compile error you expect.
- `migration/forking.md` names `Effect.fork` → `Effect.forkChild`, and never mentions that `Effect.makeSemaphore` is gone and `Semaphore` is a top-level module (`Semaphore.make` / `makeUnsafe`, then `withPermits(1)(effect)`).
- `migration/cause.md` gives `Cause.isFailure` → `Cause.hasFails`, and never mentions `Exit.causeOption` → `Exit.getCause`, which returns `Option<Cause<E>>`.

So: **a removal is never settled by rung 1.** If the docs are silent on a symbol, that is not evidence the symbol is fine. Go to rung 2.

### Worked example: the three rungs disagree

`Context.Key`, checked against `effect@4.0.0-beta.94`:

- **Rung 1** — `migration/services.md` never mentions it. Reading harder produces nothing.
- **A runtime check** says it does not exist: `typeof Context.Key` is `undefined` and `"Key" in Context` is `false`, because it is type-only.
- **Rung 2** — `$SRC/packages/effect/src/Context.ts:65` settles it:

  ```ts
  export interface Key<out Identifier, out Shape> extends Effect<Shape, never, Identifier>
  ```

  It exists, it is type-only, and `Shape` is **covariant** — so a `Context.Key` parameter accepts a wider shape than declared, and a design that expected a compile error there will not get one.

  `$EFFECT_SRC/Context.ts:65` is the same declaration, at the same line. Either root answers a rung-2 question.

Three answers, one truth, and the cheap rungs are the ones that lie.

### Rung 3 is the only one that settles behaviour

Existence and signature do not tell you what a function *does*. Real examples where the signature was innocent and the behaviour was not:

- `Effect.cached` memoizes the `Exit` **including interrupts** — an interrupted first caller permanently bricks the cached effect with a cause outside its declared error channel.
- `it.effect` **always** installs a virtual `TestClock`, so `Effect.sleep` / `delay` / `timeout` hang silently to the vitest timeout.
- `Effect.catchCause` swallows interrupts. A probe built on it reports success exactly where real code hangs. When the exposure is a defect, use `catchDefect`.

## Probe protocol

A probe that cannot fail is worse than no probe. Every precondition below exists because it was violated.

1. **Run from inside the package, never the repo root.** The workspace root resolves `effect@3` and will describe the v3 surface with total confidence.
2. **Print the resolved version inside every probe.** If it does not say `4.0.0-beta.<n>`, the probe measured v3 and every conclusion from it is void.
3. **Probe files live at the package root.** The tsconfig `include` is `${configDir}/*.ts` and does **not** match subdirectories. A probe in a subdirectory silently drops out of the compilation program, and its control error never fires — it false-passes.
4. **Run the control first.** Write a line you *know* must fail. Watch it fail. Only then write the real assertion.
5. **Delete the probe by absolute path** when done.

```bash
cd packages/<pkg>
node -e 'console.log("resolved effect:", require("effect/package.json").version)'
# write packages/<pkg>/probe.ts, then:
pnpm exec tsgo --noEmit
rm -f "$PWD/probe.ts"
```

A control that works, verified against `effect@4.0.0-beta.94`:

```ts
import { Effect } from "effect";
const control = Effect.catchAll; // v3 name; must fail
// probe.ts(3,24): error TS2339: Property 'catchAll' does not exist on type 'typeof Effect'
```

## Portability

`${CLAUDE_PROJECT_DIR}` resolves to the **consuming project's** root, not the plugin's
repo. Today those coincide, because the plugin is dogfooded only from the `effected`
monorepo — so `$SRC` finds the vendored tree. Published into someone else's project, it
will not, and the resolver above is what keeps that from mattering.

What a consumer without the subtree actually loses is **rung 1 alone**. Rung 2 arrives
intact via `$EFFECT_SRC`, and rung 3 never needed a tree — a probe compiles against the
package the consumer already installed. So the ladder degrades by exactly one rung, and
by its weakest.

**Never trade the loud failure for a quiet fallback.** Each step above resolves to a
*version-exact source tree* or it does not resolve. There is no step that resolves to
recollection. Silent degradation into v3 memory is the precise failure this plugin
exists to prevent, and it is indistinguishable from success.

This is the **only file in `plugin/` that names the path** — the agents reference this
skill, never the directory. Keep it that way:

```bash
test "$(grep -rl 'repos/effect-smol' plugin/ | wc -l)" -eq 1
```
