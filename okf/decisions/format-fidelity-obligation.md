---
type: Decision
title: The fidelity obligation and how it is tested
description: A kit formatter changes only key order, whitespace and the trailing newline, and Direction B round-trip testing is what proves it.
status: draft
tags:
  - architecture
  - testing
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c65e47ccb4e08953
---

# The fidelity obligation and how it is tested

## Context

Two fidelity bugs shipped in released kit format packages, and both passed
their suites at the time: a model class with no catch-all dropped unknown
author keys on a read→write round trip, and a YAML emitter wrote C0 control
characters raw in plain scalars, corrupting on round trip. A convention that
only fixed the two bugs and left the testing method unchanged would not
prevent the next one, so the kit had to decide what a formatter is obligated
to preserve, and how that obligation is verified.

## Decision

**The obligation:** a kit formatter changes key order, whitespace and the
trailing newline. It changes nothing else. Every key, entry, comment and
scalar value present in the input is present, and semantically identical, in
the output.

**Why both bugs escaped — two round-trip directions.** There are two
directions a round-trip test can run, they catch different bugs, and the
intuitive one catches neither:

- **Direction A — value round trip:** `parse(stringify(v)) ≡ v`. Start from a
  value, go out to text, come back.
- **Direction B — source round trip:** `emit(parse(t))` preserves everything
  `t` carried. Start from source text, decode, re-emit.

Both shipped bugs were Direction B failures, and Direction A is structurally
incapable of catching either. The dropped-unknown-key bug is invisible under
Direction A because the arbitrary is derived from the schema, and a
schema-derived generator can only produce what the schema models — so the
key that gets dropped is never generated. The C0-control bug is invisible
under Direction A because the property's alphabet came from a plain string
schema, whose default arbitrary does not emit control characters. Direction A
tests the emitter against the model, and fidelity bugs are precisely the
cases where the model is not the whole truth about the source.

**The fidelity rules**, stated so a package's test suite can be checked
against them:

- **F1** — Direction B is the obligation, and it must be tested directly. For
  any input the package accepts: re-parsing the formatted output yields the
  same value as parsing the input, and every key present in the source is
  present in the output.
- **F2** — Direction B properties are driven by source-shaped generators,
  never schema-derived ones. Where a model has a catch-all, the generator
  must emit keys outside the model. Where a model has no catch-all but the
  format permits unknown keys, that absence is itself the finding.
- **F3** — the generator's alphabet includes the ranges the emitter is
  obliged to escape: C0 controls, lone surrogates, newlines inside scalars
  and the format's own quote and comment metacharacters. An exclusion from a
  fidelity generator is a documented decision carrying a reason, never a
  silent default; `@effected/toml`'s oracle property test documents every
  exclusion with the probe that justified it.
- **F4** — identity on non-handled input, per the [format-package
  convention](../conventions/format-package-convention.md)'s P4 rule: input
  the formatter cannot process comes back byte-identical, and this is
  asserted, not assumed.
- **F5** — idempotence: `format(format(t)) === format(t)`. Cheap to assert,
  and it catches a distinct bug class — an emitter stable on its own output
  but not on the author's.

**Discharged where it is stated, not where it is merely true.**
`@effected/markdown`'s `Markdown.stringify` satisfied F1, F4 and F5 for a
long time and told nobody: it takes no options, its canonical output was
pinned by byte-level tests, and the engine was cross-checked against
commonmark.js over the full CommonMark 0.31.2 corpus. A consumer reading the
public surface could not tell any of that, and kept a third-party
stringifier on the grounds that the kit's output might move — reporting the
resulting brittleness as their own problem. A fidelity guarantee a consumer
cannot see is not a guarantee they can use, so the obligation has a second
half: the package states the commitment on the surface — the TSDoc of the
emitting entry point and the README — including the canonical choices a
byte-level assertion depends on, and says plainly that changing one is a
breaking change. `@effected/markdown`'s canonical-form table on its emitting
entry point, mirrored in its README, asserted row by row by its "documented
canonical form" test suite, is the worked example.

**Tier discipline still applies.** A fidelity suite must not smuggle IO into
a pure-tier package. `yaml`, `toml`, `jsonc` and `markdown` are pure-tier
packages; their fidelity properties take `content: string` like everything
else in them. A corpus-driven differential test reading files from disk is
legitimate only as a test-only surface, with the reader confined to
`__test__/`, never `src/`.

## Alternatives rejected

**Relying on value round-trip (Direction A) property tests alone.** Rejected
because this is exactly the testing shape both shipped bugs already survived
— a schema-derived arbitrary cannot generate the out-of-model key or the
control character that triggers the bug, so Direction A tests give false
confidence about fidelity specifically.

**Treating the fidelity guarantee as implicit, discoverable by reading the
implementation.** Rejected after `@effected/markdown` demonstrated the
failure mode directly: a guarantee that is true but unstated is
indistinguishable, from the outside, from no guarantee at all, and a
consumer will route around it at real cost.

## Consequences

Every pure-tier format package's test suite is reviewed against F1–F5, not
just against its own model's round trip. Adding a new fidelity exclusion to a
generator requires a documented reason at the point of exclusion, and a
package's public-facing canonical-form claims are cross-checked by an
assertion suite so the promise and the code cannot drift apart silently.
