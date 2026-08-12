---
status: current
module: effected
category: architecture
created: 2026-07-20
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 90
related:
  - effect-standards.md
  - sync-primitive-policy.md
  - packages/package-json.md
  - packages/yaml.md
  - packages/toml.md
  - packages/jsonc.md
  - packages/config-file.md
  - packages/markdown.md
  - packages/glob.md
  - packages/semver.md
---

# Kit formatter convention

## Overview

How `@effected/*` packages expose **formatting** as distinct from **validation**, and what fidelity guarantee a kit formatter makes. It exists because the kit contains four packages that format text, and without a stated convention each would spell the seam differently across published surfaces that cannot then be changed.

The convention ratifies what three format packages had already converged on independently, rather than minting a fourth spelling. The rules below are what a new formatting surface is checked against; the one part that is still a live obligation rather than a settled shape is [the fidelity obligation](#decision-5--the-fidelity-obligation), which is a testing program.

## The driving constraint

Kit formatters ship into consumers' lint hooks — lint-staged, pre-commit. Those hosts hand you file contents and expect text back, synchronously. Two properties follow, and they are the whole basis of everything below.

**C1 — a formatter must not hard-fail on legal input.** A strict path that throws on `{"private": true}` or a version-less root — both perfectly legal `package.json` files — is unusable as a lint handler, and the consumer routes around the kit to whatever does work. A formatter that rejects legal input is not a formatter.

**C2 — a formatter must not silently rewrite legal input into a different-but-equivalent encoding.** Two bugs of this class shipped in released packages, neither caught by its own suite: a model class with no catch-all **dropped** unknown author keys on a read→write round trip, and a YAML emitter wrote C0 control characters raw in plain scalars, corrupting on round trip. Fidelity is the whole job of a kit containing four format packages, and suites that test the emitter against the model do not catch fidelity bugs — which is why [the fidelity obligation](#decision-5--the-fidelity-obligation) is the longest section here.

### Why a convention, and not four local answers

Precedent from inside the kit: one consumer wrote **four differently-shaped error folds for a single compile-plus-expand glob pattern inside one package**, because no kit package owned the seam. That fan-out produced a real bug — two divergent `dot` semantics in one package. Absent a stated convention the same fan-out happens across four format packages, on published surfaces.

## The rules

Four rules, stated so a reviewer can check a package against them.

**P1 — the tolerant path is its own named entry point, never a flag.** A `{ strict: false }` option on the strict path is banned: it makes the strict path's return type a union of guarantees and hides the choice from the call site and from `grep`.

**P2 — offer the shape(s) the hosts actually have, and route them through one implementation.** Value→value and bytes→bytes are different hosts, not a convenience pair; a package with only one kind of host ships only one entry point. Two entry points that re-derive the same ordering will drift, so they share the internal.

**P3 — the value path only reorders. It never adds or removes a key.** This is what makes a `T → T` signature honest, and the type system enforces it: an earlier `stripEmpty` option on the value path was rejected by `tsc`, because removing a key makes `T → T` a lie. The option moved to the text path rather than the return weakening to `Partial<T>`. A capability that must remove keys belongs on the text path with an explicitly-defaulted-off option.

**P4 — input the formatter cannot handle is returned unchanged.** Never partially rewritten. A formatter returning zero edits on a fatal parse error and a value path passing non-objects through are the same rule.

## The four packages as they are

| Package | Formatting surface | Shape | Fails on bad input? |
| --- | --- | --- | --- |
| `jsonc` | `JsoncFormatter.format` / `.formatToString` | `string → ReadonlyArray<JsoncEdit>` / `string → string` | No — pure and total |
| `yaml` | `YamlFormat.format` / `.formatToString` | same shape | No — malformed input yields no edits rather than corrupting the document |
| `toml` | `TomlFormat.format` / `.formatToString` | same shape | No — same construction |
| `package-json` | `PackageJsonFormat.sortValue` / `.formatToString` | `T → T` / `string → Result<string, …>` | Text path fails on non-JSON only |

The three format packages converged **independently** on the same shape: a `*Format`/`*Formatter` concept class carrying total statics, edit-based (`format` returns edits, `formatToString` applies them), degrading to identity when the document cannot be parsed. That convergence is the strongest available evidence about what the convention should be.

`package-json` differs for a real reason: it is the only one of the four with a *schema* between text and text, so it is the only one where a formatting path could ever have hard-failed on legal input. The other three satisfy C1 by construction.

## Decision 1 — naming

**The `*Format` concept class with total statics is the convention; `*Unvalidated` is rejected as a kit spelling.**

`Unvalidated` is accurate for a package with a decode step and wrong everywhere else. In `yaml`, `toml` and `jsonc` there is no validation to be un-done — the tolerant/strict distinction there is about *fidelity* and *error tolerance*, not schema decoding. The axis worth naming is not "validated" but **whether the path decodes**: a decode-free path cannot normalize, because it never looks at the field, and *source-preserving* is the guarantee a consumer is shopping for.

`formatToString` is the shared name for bytes→bytes, so a consumer who has met one kit formatter has met all four; a package-specific shape gets a package-specific name (`sortValue`). The guarantee lives in the class's doc comment, where it can be stated precisely instead of compressed into a prefix.

## Decision 2 — which packages need a tolerant seam

**Only `package-json`. `yaml`, `toml`, `jsonc` and `config-file` add no new surface.**

- **`yaml` / `toml` / `jsonc` — nothing to add.** Their formatters are already total, already edit-based, already identity-degrading. A mandated tolerant twin here would be an alias for an existing total function — dead surface that has to be maintained and documented forever. What these three take on from this convention is [the fidelity obligation](#decision-5--the-fidelity-obligation), a testing change rather than a surface change.
- **`package-json` — the one seam.**
- **`config-file` — out of scope, deliberately.** Its codec seam is a *loading* pipeline where decode-and-validate is the entire point, and whose host is an application at startup, not a synchronous lint hook. Neither C1 nor the sync constraint applies. A tolerant path there would mean "load this config but don't check it", which is not a capability anyone wants. Recorded so the question is not reopened.

A convention that mandates surface nobody calls is worse than no convention. Three of five packages correctly opting out is the expected outcome, not a weakness.

## Decision 3 — return-type convention

A three-way rule keyed on whether failure is possible. **Never `Effect` on a tolerant formatter entry point.**

1. **Cannot fail → total.** Plain return, no wrapper.
2. **Can fail, pure and sync → `Result`.** Lifted in one call by `Effect.fromResult` for an Effect host, so the `Result` return is strictly more useful than an `Effect` return: it serves both host kinds.
3. **`Effect` is not permitted here.** Lint hosts are synchronous; an `Effect` return forces every one of them to build a runtime to format a file.

The generalization of this rule past formatting is [the sync primitive policy](sync-primitive-policy.md).

**A known hazard, accepted.** Totality plus identity-degradation (P4) means a host cannot distinguish "already correctly formatted" from "unparseable, I gave up". Keep the totals total — narrowing them would break the one property that makes them safe in a lint hook — and note that every one of these packages exposes a parse entry point carrying typed diagnostics, so a host that needs to tell the difference probes with `parse` first. This is a real ergonomic gap, left open deliberately rather than inherited: see [open questions](#open-questions).

## Decision 4 — options-type convention

**Each package keeps its own options type. No shared kit-wide formatter options shape.**

1. **The options are irreducibly format-specific.** A shared type is either a lowest common denominator that constrains all four, or a union carrying members meaningless to three of them.
2. **A shared options type is a cross-package coupling that has to live somewhere.** Every package would take an edge on whichever package owned it, for a type alias — and the [acyclic-graph rule](effect-standards.md#cross-effected-dependencies)'s answer, a third package, does not earn its slot for four optional booleans.
3. **A package carrying both a value-path and a text-path options type is correct, not duplication.** A `sourceText` member is meaningless on the text path, and the defaults deliberately differ; collapsing them requires either a member ignored half the time or a default wrong half the time.

What the convention *does* mandate is documentation discipline, because divergent defaults are exactly where a silent edit hides: **where a tolerant options member's default differs from its strict counterpart, the divergence and its reason are documented on the member** — an indentation default of `"preserve"` because reformatting in place should not silently restyle a file, a strip-empty default of `false` because an empty map is a key the author actually wrote.

## Decision 5 — the fidelity obligation

This is the part that changes behavior rather than shape. Both shipped C2 bugs passed their suites, so a convention that does not change how fidelity is tested will not prevent the next one.

### The obligation

**A kit formatter changes key order, whitespace and the trailing newline. It changes nothing else.** Every key, entry, comment and scalar value present in the input is present, and semantically identical, in the output.

### Why both bugs escaped: two round-trip directions

There are two directions, they catch different bugs, and the intuitive one catches neither.

- **Direction A — value round trip**: `parse(stringify(v)) ≡ v`. Start from a value, go out to text, come back.
- **Direction B — source round trip**: `emit(parse(t))` preserves everything `t` carried. Start from *source text*, decode, re-emit.

Both bugs are Direction B failures, and **Direction A is structurally incapable of catching either.** The dropped-unknown-key bug is invisible because the arbitrary is derived from the schema, and a schema-derived generator can only produce what the schema models — so the key that gets dropped is never generated. The C0-control bug is invisible because the property's alphabet was `Schema.String`, whose default arbitrary does not emit control characters.

The lesson generalizes past these two: **Direction A tests the emitter against the model, and fidelity bugs are precisely the cases where the model is not the whole truth about the source.**

### The fidelity rules

**F1 — Direction B is the obligation, and it must be tested directly.** For any input the package accepts: re-parsing the formatted output yields the same value as parsing the input, and every key present in the source is present in the output.

**F2 — Direction B properties are driven by source-shaped generators, never schema-derived ones.** Where a model has a catch-all, the generator **must** emit keys outside the model. Where a model has no catch-all but the format permits unknown keys, that is itself the finding.

**F3 — the generator's alphabet includes the ranges the emitter is obliged to escape**: C0 controls, lone surrogates, newlines inside scalars, and the format's own quote and comment metacharacters. Corollary, and the important half: **an exclusion from a fidelity generator is a documented decision carrying a reason, never a silent default.** `@effected/toml`'s oracle property test is the standard to copy — it documents every exclusion with the probe that justified it.

**F4 — identity on non-handled input**, per [P4](#the-rules). Assert it: input the formatter cannot process comes back byte-identical.

**F5 — idempotence.** `format(format(t)) === format(t)`. Cheap to assert, and it catches a distinct class — an emitter stable on its own output but not on the author's.

A related constraint on evidence lives in [effect-standards.md](effect-standards.md#the-oracle-for-a-ported-algorithm-is-external): never pin your own output as the fixture. F1–F5 constrain what a round trip must preserve; that rule constrains what a fixture is allowed to be evidence of.

### Tier discipline applies

A fidelity suite must not smuggle IO into a pure-tier package. `yaml`, `toml` and `jsonc` are **pure tier** ([R1](effect-standards.md#dependency-policy)); their fidelity properties take `content: string` like everything else in them. A corpus-driven differential test reading files from disk is legitimate only as a test-only surface, with the reader in `__test__/`, never in `src/`.

## Decision 6 — the sync primitive policy

Generalized past formatting and moved to its own document: **[sync-primitive-policy.md](sync-primitive-policy.md)**. It answers the same question this doc asks — what shape does a pure kit boundary expose? — for every pure boundary in the kit rather than for formatters alone, and it carries the scope test, the derivation, the `*Result` naming rule and the codec exemption.

[Decision 3](#decision-3--return-type-convention) above is that policy's formatting-specific case.

## Open questions

1. **Should the total formatters gain a way to signal "could not parse"?** Recommendation: **no change** — totality is what makes them safe in a lint hook, and `parse` already provides the diagnostic to any host that needs it. Flagged because it is a real ergonomic gap and the decision should be conscious rather than inherited.
2. **Is the `toml` oracle pattern worth replicating for `yaml` and `jsonc`?** Not recommended as a mandate. Both would need a reference implementation to differ against, which reintroduces a dependency question ([R1](effect-standards.md#dependency-policy)) for a devDependency-only benefit. F1–F5 are the mandate; an oracle stays a per-package judgment call where a suitable reference exists.
