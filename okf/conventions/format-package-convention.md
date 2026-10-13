---
type: Convention
title: Format-package convention
description: How @effected/* packages expose formatting as distinct from validation, and the fidelity guarantee a kit formatter makes.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 56015737879a155f
---

# Format-package convention

The kit contains five packages that format text — `jsonc`, `yaml`, `toml`,
`markdown` and `package-json` — and this convention states the one seam they
all expose, so a new formatting surface is checked against a stated rule
rather than reinvented per package. It ratifies what the five packages had
already converged on independently rather than minting a further spelling.

## The driving constraint

Kit formatters ship into consumers' lint hooks — lint-staged, pre-commit.
Those hosts hand a formatter file contents and expect text back,
synchronously. Two properties follow, and they are the whole basis of the
rules below.

**C1 — a formatter must not hard-fail on legal input.** A strict path that
throws on `{"private": true}` or a version-less root — both perfectly legal
`package.json` files — is unusable as a lint handler, and the consumer routes
around the kit to whatever does work. A formatter that rejects legal input is
not a formatter.

**C2 — a formatter must not silently rewrite legal input into a
different-but-equivalent encoding.** Two bugs of this class shipped in
released packages, neither caught by its own suite: a model class with no
catch-all dropped unknown author keys on a read→write round trip, and a YAML
emitter wrote C0 control characters raw in plain scalars, corrupting on round
trip. Fidelity is the whole job of a kit containing four format packages, and
suites that test the emitter against the model do not catch fidelity bugs —
which is why the fidelity obligation below is the rule with the most teeth.

### Why a convention and not four local answers

Precedent from inside the kit: one consumer once wrote four differently-shaped
error folds for a single compile-plus-expand glob pattern inside one package,
because no kit package owned the seam, and that fan-out produced a real bug —
two divergent `dot` semantics in one package. Absent a stated convention, the
same fan-out happens across four format packages, on published surfaces that
cannot then be changed without a breaking release.

## The rules

Four rules, stated so a reviewer can check a package against them.

**P1 — the tolerant path is its own named entry point, never a flag.** A
`{ strict: false }` option on the strict path is banned: it makes the strict
path's return type a union of guarantees and hides the choice from the call
site and from `grep`.

**P2 — offer the shape(s) the hosts actually have, and route them through one
implementation.** Value→value and bytes→bytes are different hosts, not a
convenience pair; a package with only one kind of host ships only one entry
point. Two entry points that re-derive the same ordering will drift, so they
share the internal.

**P3 — the value path only reorders. It never adds or removes a key.** This is
what makes a `T → T` signature honest, and the type system enforces it: an
earlier `stripEmpty` option on the value path was rejected by `tsc`, because
removing a key makes `T → T` a lie. The option moved to the text path rather
than the return weakening to `Partial<T>`. A capability that must remove keys
belongs on the text path with an explicitly-defaulted-off option.

**P4 — input the formatter cannot handle is returned unchanged.** Never
partially rewritten. A formatter returning zero edits on a fatal parse error
and a value path passing non-objects through are the same rule.

## The five packages as they are

| Package | Formatting surface | Shape | Fails on bad input? |
| --- | --- | --- | --- |
| `jsonc` | `JsoncFormatter.format` / `.formatToString` (`packages/jsonc/src/JsoncFormatter.ts:33,48`) | `string → ReadonlyArray<JsoncEdit>` / `string → string` | No — pure and total |
| `yaml` | `YamlFormat.format` / `.formatToString` (`packages/yaml/src/YamlFormat.ts:799,826`) | same shape | No — malformed input yields no edits rather than corrupting the document |
| `toml` | `TomlFormat.format` / `.formatToString` (`packages/toml/src/TomlFormat.ts:775,790`) | same shape | No — same construction |
| `markdown` | `MarkdownFormat.format` / `.formatToString` (`packages/markdown/src/MarkdownFormat.ts:609,673`) | same shape | No — an unparseable document yields no edits |
| `package-json` | `PackageJsonFormat.sortValue` / `.formatToString` (`packages/package-json/src/PackageJsonFormat.ts:159,196`) | `T → T` / `string → Result<string, …>` | Text path fails on non-JSON only |

The four format packages converged independently on the same shape: a
`*Format`/`*Formatter` concept class carrying total statics, edit-based
(`format` returns edits, `formatToString` applies them), degrading to identity
when the document cannot be parsed. That convergence is the strongest
available evidence about what the convention should be. `MarkdownFormat` and
`PackageJsonFormat` also carry `modify`/`modifyToString`, which replace a node
or field through the canonical emitter — an editing operation rather than a
formatting entry point, and not governed by the [return-type
decision](../decisions/format-return-type.md).

`package-json` differs for a real reason: it is the only one of the five with
a schema between text and text, so it is the only one where a formatting path
could ever have hard-failed on legal input. The other four satisfy C1 by
construction.

The rest of the shape decisions — naming, which packages need a tolerant
seam, the return-type rule, the options-type rule, and the fidelity
obligation — each carry their own alternatives-rejected record: see
[format-naming](../decisions/format-naming.md),
[format-tolerant-seam](../decisions/format-tolerant-seam.md),
[format-return-type](../decisions/format-return-type.md),
[format-options-type](../decisions/format-options-type.md), and
[format-fidelity-obligation](../decisions/format-fidelity-obligation.md).
The return-type rule generalizes past formatting into the
[sync-primitive policy](sync-primitive-policy.md).

## Open notes

These points are open by design rather than settled, so a future change
finds them here instead of re-litigating from nothing:

1. Should the total formatters gain a way to signal "could not parse"?
   Recommendation is no change — totality is what makes them safe in a lint
   hook, and each package's `parse` entry point already provides the
   diagnostic to any host that needs it. Flagged because it is a real
   ergonomic gap and the decision should be conscious rather than inherited.
2. Is the `toml` oracle-differential pattern (property tests run against an
   independent reference implementation) worth replicating for `yaml` and
   `jsonc`? Not recommended as a mandate — both would need a reference
   implementation to differ against, reintroducing a dependency question for
   a devDependency-only benefit. The fidelity rules are the mandate; an
   oracle stays a per-package judgment call where a suitable reference
   exists.
3. Parity hardening is the next planned pass: complete frontmatter updates
   flowing through `markdown`'s edit layer, standardize the four packages'
   three different range-filter postures onto one, and then promote the
   kit's parity contract from shape-identical to behavior-identical.
