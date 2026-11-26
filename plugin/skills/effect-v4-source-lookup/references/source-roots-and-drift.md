# Source roots and drift

The `SKILL.md` resolution block sets `$SRC` and `$EFFECT_SRC`. This reference
holds what each root can and cannot settle, where the platform
implementations live, and the three ways the roots drift apart without an
error.

## What each root serves

- **`$SRC`** — a vendored Effect checkout, usually a `git submodule` under
  `.repos/`, pinned to the exact `effect` release tag the workspace compiles
  against. Serves rungs **1 and 2**. Present only in a repository that vendors
  it; absent elsewhere.
- **`$EFFECT_SRC`** — `node_modules/effect/src`. Serves rung **2 only**, and does
  so at full fidelity: `effect` publishes `src/**/*.ts` in its `files` array, so
  every consumer already has the complete v4 TypeScript source, `internal/`
  implementations included. The lockfile pins it to exactly the version you
  compile against — so on the existence-and-signature question it is at least
  as trustworthy as the vendored tree, which can drift from the catalog between
  re-pins. Every `@effect/*` package ships the same way (`@effect/platform-node`,
  `@effect/vitest`, …), so resolve whichever one your claim is about.

**A sparse vendored checkout may carry only `packages/effect` and
`packages/vitest`**, so the platform *implementations* are not there. The Node
`FileSystem` — the one an in-memory filesystem has to mirror, e.g. `seek`
failing `BadArgument` before the start of the file — lives in
`@effect/platform-node-shared`. Under pnpm read
`node_modules/.pnpm/@effect+platform-node-shared@<pin>_effect@<pin>/node_modules/@effect/platform-node-shared/src/NodeFileSystem.ts`
(the store directory carries the peer suffix; `find node_modules/.pnpm -path
'*platform-node-shared@<pin>*' -name NodeFileSystem.ts` locates it). When a
semantic has to be *copied* from the platform layer, that file is rung 2 for it;
the vendored tree is silent, not authoritative.

## Drift 1: the vendored tree lags the install

The submodule sits at the exact tag it was last pinned to, and a lockfile
resolution that moves without its matching re-pin leaves the two silently
disagreeing. A rung-2 answer from `$SRC` can then be a *stale* answer,
delivered with total confidence and no error. Version-checking is the
reader's job, not the tooling's. Check it in one line (set `$SRC` with the
resolution block first):

```bash
diff <(node -p 'require("'"$SRC"'/packages/effect/package.json").version') \
     <(node -p 'require("effect/package.json").version') \
  || echo "VENDORED TREE IS STALE — settle rung 2 against \$EFFECT_SRC, not \$SRC."
```

## Drift 2: the same version, different line numbers

At the same version, `$EFFECT_SRC` and `$SRC` still disagree on line numbers:
npm's published `effect/src` is reformatted at publish time. It carries TSDoc
the vendored tag does not, and its signatures are reflowed (a multi-line
overload in the tag is joined onto one line in the published copy). A
declaration therefore sits at a different line in each tree even where its
code is identical. A `Module.ts:line` anchor in this plugin always names the
**vendored tag** (`$SRC`). Search `node_modules` by symbol name instead of by
line, and grep for the declaration's name, never for a fragment of a wrapped
signature, because the reflow joins lines the tag splits.

The version `diff` above cannot see this drift. Check it against a symbol:

```bash
diff <(grep -n "export const resource" "$SRC/packages/effect/src/ai/McpServer.ts") \
     <(grep -n "export const resource" "$EFFECT_SRC/ai/McpServer.ts") \
  || echo "ANCHORS ARE VENDORED-TREE LINES — search installed source by symbol."
```

## Drift 3: what the lockfile really resolves

**A workspace root may resolve a v3 `effect`, or nothing at all.** Where a v3 is
installed, a probe run from the root describes the v3 surface with total
confidence; where nothing is hoisted, a bare `effect` import there dies with
`ERR_MODULE_NOT_FOUND`. A lockfile can also carry **two v4 `effect` entries by
intent**: a toolchain that declares `effect` as a regular dependency binds to its
own copy while the workspace's packages bind to theirs. Which one a probe links
against is decided by where the probe file lives. Which failure you get depends
on what a given repo has installed, so the resolution gate keys on the
*resolved version*, never on a remembered answer for a particular directory.

**Read the lockfile, and read it carefully — neither the pnpm store nor a raw
grep count is the check.** `ls node_modules/.pnpm | grep '^effect@'` lists store
directories, which outlive the lockfile: during a catalog advance the previous
release's directory lingers there, orphaned. And a grep of the lockfile itself
can show a second version that is not a second copy — while an `overrides`
bridge is up, `pnpm-lock.yaml` carries a redirect line (`effect@<old>: <new>`)
whose *only* hit is the mapping: one resolved version, two spellings. A
`packageExtensions` bridge, the other shape, really does keep two copies. What
voids a probe is the version it **resolves**, printed from inside itself.

## Rung 1 has no installed fallback

The npm package ships no `migration/`, no `ai-docs/`, no `LLMS.md` — they are not
in its `files` array. That degrades honestly: rung 1 is prescriptive, not
authoritative, and a removal is never settled by it anyway. When `$SRC` is
absent, say so and climb to rung 2.

## The vendored tree is read-only

Never point a writing tool at it. A formatter or linter configured to fix
(markdownlint with `"fix": true`, say) silently rewrites the migration notes
when it runs over the tree, and a corrupted rung-1 source cannot be detected by
reading it — only by `git status "$SRC"`.

## Portability

`${CLAUDE_PROJECT_DIR}` resolves to the **consuming project's** root, not the
plugin's. A project that does not vendor Effect gets no `$SRC`, and the resolver
is what keeps that from mattering. What it loses is **rung 1 alone**: rung 2
arrives intact via `$EFFECT_SRC`, and rung 3 never needed a tree — a probe
compiles against the package the project already installed. So the ladder
degrades by exactly one rung, and by its weakest.
