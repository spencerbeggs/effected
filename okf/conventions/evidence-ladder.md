---
type: Convention
title: Climb the evidence ladder in order — renames, then source, then a probe
description: Settle a claim about Effect v4 at the cheapest rung that actually answers the question -- migration notes and skill guides for renames, vendored or installed source for existence and signature, and only a probe from inside a package for semantics.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
sources:
  - id: scratchpad-claude-md
    resource: ../../scratchpad/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-14T02:44:47Z
  body_sha256: c2f91c061d58e44d293bf5839e2180c9b192e1cd96caf2a98f54e7bf6c326aaf
---

# Climb the evidence ladder in order — renames, then source, then a probe

The `.claude/skills/improve` project-level skill closes the loop the
plugin's ethos implies: real work falsifies skill claims, and something
has to turn those falsifications back into skill edits. It is aware of
`plugins/claude-code/skills/` and edits them; the plugin itself carries
no self-improvement machinery, because a tool does not grade itself.

- **Harvest** runs at the end of a work cycle. It reads recorded
  retractions and PR review threads and files a ticket for each skill
  claim that turned out false, carrying the claim and the artifact that
  killed it.
- **Tune** runs against those open tickets. For each, it climbs the
  evidence ladder only as far as the claim requires, then amends the
  skill and closes the ticket citing what it found.

## The evidence ladder

The rungs are ordered by cost, and each answers a strictly different
class of question:

1. **Migration notes and skill guides.** Cheap, and authoritative for the
   **rename** class only.
2. **Source** — either the vendored Effect submodule or the installed
   `node_modules/effect/src`. Authoritative for **existence and
   signature**.
3. **A probe run from inside a package**, using the
   [scratchpad workspace](../modules/scratchpad.md) when one exists in
   the repo. The only rung that settles **semantics**.

One document sits between rungs 1 and 2 in this repo, named rung 1.5: the
vendored tree ships `SCHEMA.md` at the pin — upstream Schema
documentation versioned with the source rather than floating like a
website, so unlike the migration notes it describes the surface actually
installed. That makes it a cheap, version-exact diff oracle: when it
disagrees with a skill, the skill is usually what is wrong, but it is
still a document and does not outrank a declaration.

Rung 2 has two roots that can drift, so the tiebreak is: **the installed
source wins.** `node_modules` is what the code links against; the
vendored tree is what someone pinned last. Because exact-pin catalogs and
a re-pin folded into every catalog-bump commit keep the two in sync by
construction, the two agree in practice — the tiebreak still costs
nothing and catches the next divergence.

Rung 1 is deliberately not the last rung, because the migration notes are
prescriptive rather than exhaustive: they can be silent about a primitive
a port needs, and — the sharper failure — they can assert something the
source refutes in either direction, documenting a method with zero
occurrences anywhere in the tree, or listing a module as removed that is
alive and mapped elsewhere in the same corpus. A confident wrong answer
costs more than an absent one, because nothing prompts the reader to
climb further. So a positive claim in the notes about what a symbol *is
or does* is exactly as unsettled as their silence — an edit must cite the
highest rung that actually settles its claim.

## Probe preconditions

Encoded as skill preconditions because each was learned by being burned:

- **Probes run from the scratchpad workspace** in this repo, or from
  inside the package elsewhere — never from the harness's own private
  scratch directory, which has no `node_modules`. Every probe prints its
  resolved `effect` version, because a wrong resolution is otherwise
  indistinguishable from a right one.
- **A probe file must be inside the compilation program.** A package
  tsconfig whose `include` uses `${configDir}/*.ts` does not match
  subdirectories, so a probe placed in one silently leaves the program
  and false-passes its control.
- **The control assertion runs first.** A probe that cannot fail is worse
  than no probe.
- **A probe writes no file under `__test__/`.** A stray
  `__test__/tmp-probe.test.ts` is collected by the ordinary suite and
  inflates the `Tests:` count, which looks exactly like added coverage —
  destroying any later count-delta audit against that number (see [state
  the reason when a gate count
  moves](state-the-reason-when-a-gate-count-moves.md)). Do not solve this
  with an exclude pattern: an exclude only catches the names someone
  predicted, and fails silently when it misses one it did not. Prefer, in
  order: a probe that writes no file at all (`cd packages/<name> && node
  --input-type=module -e '<script>'` — running from *inside* the package
  is what lets bare specifiers such as `effect` or `@effected/*` resolve,
  since pnpm's store layout resolves by the *importer's* location, not
  the invoking cwd); the [scratchpad workspace](../modules/scratchpad.md)
  when a file is genuinely needed; and, only as a backstop,
  `@vitest-agent/plugin`'s own warning on a zero-collection run.

## Absence results need a second, differently-derived source

An absence result and a broken query are indistinguishable at the call
site: a grep returning zero, a `str.replace` that matched nothing, a
projection that dropped a field, a mutant nothing caught, a clean build
log — each looks identical whether or not the thing being checked for is
genuinely absent. `suppressed: 0` and "the build never ran" produce the
same JSON; a cached turbo replay and a real build produce the same clean
log (see [a turbo cache hit reads like a fresh
build](../gotchas/turbo-cache-hit-replays-clean-log.md)).

The remedy is not a better query — it is **a positive control asserted
first**: prove the query finds something known to be there, then trust
it to report that something else is not. The sharp form, the one that
gets skipped, is that **the control must expect a non-zero answer**. A
control that returns zero when zero is the correct answer looks exactly
like success on a broken tool. Where a control is impossible, use a
second signal derived **differently** from the first — `generatedAt` in
`issues.json` against source mtime for "did this build actually run," one
lint tool's output against another's for a severity, the whole-suite
`Tests:` line against a filtered one.

A control must also vary only the thing under test: running it against
the very input that produced the surprising result cannot distinguish
"the tool is broken" from "this input is special" — it has to run
against a known-good input instead. [A single embedded NUL byte making
`grep` silently skip a
file](../gotchas/nul-byte-makes-file-look-binary-to-grep.md) is the
concrete case this repository has hit: a `grep -c ""` that returned
nothing was first read as proof `grep` itself was broken, and only a
control run against a different, known-good file located the actual
cause in that one file.

## Recorded coupling: the vendored path

This plugin's agents and skills may assume the vendored tree exists once
the repo's reference repos are synced, since a submodule checkout starts
empty in a fresh clone, CI runner or new worktree. In a published
consumer's tree that path is absent, and a skill that cannot find its
evidence source must not fall back on memory — silent fallback is the
exact failure this ladder exists to prevent. The evidence-ladder skill
implements a resolution order instead: an explicit environment override,
then the vendored tree, then the installed `node_modules/effect/src`
gated on a resolved v4 version (refusing a v3 resolution rather than
reporting it), stopping loudly only when every root is absent. Rung 1
deliberately has no fallback: the npm package does not ship the migration
notes, and the skill says so instead of degrading silently.
