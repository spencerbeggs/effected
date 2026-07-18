---
name: building-a-format-package
description: Use when building, scaffolding, or extending an @effected format package — a parse/edit/format library for a text format (jsonc, yaml, toml, markdown, or the next one). Covers the canonical module-per-concept surface (facade/Document/Node/Edit/Format/Visitor/Diagnostic), the engine-origin policy (own the engine — vendor+harden or from-scratch, never a runtime parser dependency), the Effect-wrapping and Result-parity policy, the cross-package parity contract (Edit/Range field-identity, the diagnostic five-field core, MAX_NESTING_DEPTH=256), the conformance-corpus harness pattern (vendored fixtures + pin file, empty skip map, differential oracle), and the scaffold gotchas. Trigger phrases: new format package, corpus harness, VENDORED pin, differential oracle, parity contract, parse/edit/format surface.
---

# Building a format package

The `@effected` kit's format packages — jsonc, yaml, toml, markdown (in
flight) — share one architecture, deliberately. This skill is that
architecture, so the next format starts from the pattern instead of
re-deriving it from three design docs. Authority order when this skill and a
design doc disagree: the package's design doc in
`.claude/design/effected/packages/<name>.md` wins; this skill routes.

For the hostile-input guard inventory (depth caps, numeric bounds,
proto-pollution, C0, the typed-error invariant), see
`hardening-a-parser-port` — this skill covers the package *shape*, that one
covers the engine's defenses. Both apply to every format package.

## The canonical surface (module-per-concept)

One PascalCase file per public concept; `src/index.ts` is the ONLY barrel
(re-exports only — the no-barrel rule). The set, with `<Fmt>` = the format
name:

| Module | Owns |
| --- | --- |
| `<Fmt>.ts` | Value facade: `parse`/`stringify` (Effect, typed E), schema factories, the `<Fmt>FromString` codec, parse/stringify errors and stringify options |
| `<Fmt>Document.ts` | The lossless unit: CST/AST plus recovered `diagnostics`; `parse`, `toValue`, `stringify` |
| `<Fmt>Node.ts` | The node Schema classes, co-located in one file to break the recursive-AST import cycle (`Schema.suspend`, refs typed `Schema.Codec<T>`, no parent pointers) |
| `<Fmt>Edit.ts` | `<Fmt>Edit` `{offset,length,content}` + `applyAll`, `<Fmt>Range`, path/segment aliases |
| `<Fmt>Format.ts` | `format`/`formatToString` (pure, returns edits) + `modify`/`modifyToString` (Effect); formatting options; `<Fmt>ModificationError` |
| `<Fmt>Visitor.ts` | `Stream<<Fmt>VisitorEvent>` walk — infallible at the type level, errors are in-band events |
| `<Fmt>Diagnostic.ts` | The diagnostic class (`code`/`message`/`offset`/`length`/`line`/`character`) + per-stage error-code unions |
| `internal/` | The engine and `limits.ts`. Never exported; never imports a public module (the cycle firewall — engine emits raw carriers, the facade materializes typed errors and diagnostics) |

Formats add concept modules where the format demands them (toml's
`TomlDateTime`, markdown's `Frontmatter`/`Mdast`) — but the core eight are the
parity skeleton, and a format package missing one of them needs a recorded
reason in its design doc.

**Alternative implementations that each reach a different dependency get one
module each, exported by name — never a namespace object.** A namespace
object is a barrel with worse tree-shaking: referencing it retains every
member's module graph, silently. This is the config-file codec rule
(`JsonCodec`/`JsoncCodec`/`YamlCodec`/`TomlCodec` as free-standing exports)
and it recurs in every format package that offers per-format variants
(markdown's frontmatter codecs).

## Engine origin: own it (R1)

Pure and boundary packages take **no external runtime dependency**
(effect-standards R1) — so a format package owns its parser. Two sanctioned
routes:

- **Vendor + harden with attribution** (jsonc ← Microsoft jsonc-parser, yaml
  ← the `yaml` npm engine, glob ← minimatch): port the engine into
  `src/internal/`, keep upstream license headers, then harden per
  `hardening-a-parser-port`.
- **From scratch** (toml): justified when the grammar is small, stable,
  precisely specified, and has a first-class compliance corpus — a bounded
  bet.

Never the third route: wrapping an external parser as a runtime dependency.
The rejected upstream often survives anyway — as the **differential-test
oracle** (see Testing below).

**Differential verification starts the port, it doesn't just gate the ship.**
When a reference implementation is executable and vendored (a reference
parser, a `normalize.py`), run the port against it **over the real corpus as
the first verification step** — before trusting any hand-written unit suite.
During the markdown P1 port this took ~10 minutes and caught 3 real bugs that
59 green hand-written tests had missed entirely (all in edge-case handling
the tests never sampled). The exact-pinned oracle devDependency in the
Testing section is the *shipping-gate* complement to this porting-time tool:
same idea, different moment — use both.

**Where a ported extension hooks into an existing pipeline is determined by
two constraints, not by taste.** A pass that must read source text verbatim
(offset fidelity) cannot run after decoding — entities and escapes have
already shortened node values, so offsets computed there are guesses. A pass
that must scan backwards over consumed text cannot run before the
delimiter/bracket stacks are spent — unlinking a node a live delimiter still
points at corrupts the list. The two constraints can split one upstream
extension across both moments: cmark-gfm's autolink literals port as an
inline construct for www/scheme literals (raw source, offsets intact) and a
postprocess after `processEmphasis` for email literals (backwards scan, no
stack left to corrupt). Check the upstream source for this split before
assuming a single mechanism.

## Effect-wrapping policy (and the Result-parity pattern)

Verbatim from the yaml design doc, binding on every format package:

- **Pure synchronous** where nothing can fail: navigation, `toValue`,
  `applyAll`, the `format` edit computation, equality. An
  `Effect<_, never>` wrapper on a total function is ceremony.
- **`Effect`** only where the typed error channel is real: `parse`,
  `stringify`, `modify`, schema decode.
- **`Stream`** for the visitor; malformed input surfaces as in-band error
  events.
- **`Result`** sync escape hatches for config-time callers that cannot enter
  the runtime.

The Result-parity pattern (established by `Jsonc.parseResult`, issue #115
tracks kit-wide adoption): each parse entry point gets a pure `*Result`
variant, and the Effect variant is **defined in terms of it** behind the
named span —

```ts
static parseResult(text: string, options?: Opts): Result.Result<unknown, ParseError> { ... }
static parse = Effect.fn("Fmt.parse")((text: string, options?: Opts) =>
  Effect.fromResult(Fmt.parseResult(text, options)))
```

— so the two can never diverge. The sync variant carries **no span** (it is
not an Effect); its TSDoc points Effect consumers at the spanned variant.

The error posture itself follows the **spec, not the template**: jsonc/yaml/
toml fail parse on malformed input, but markdown's parse is near-total
(CommonMark has no syntax errors — its E channel carries only hardening
guards, and warnings ride the diagnostics array). Derive the posture from the
format's spec and record it in the design doc.

## The parity contract (binding across siblings)

- `<Fmt>Edit` and `<Fmt>Range` are **field-identical** across all format
  packages: `{ offset, length, content }` / `{ offset, length }`. This is
  what lets codec-generic consumer code work against any of them, and it is
  the pre-work for a future `@effected/text-edit` kernel — do not innovate
  here without a kit-wide decision.
- The diagnostic core carries the same five fields everywhere: `code`,
  `offset`, `length`, `line`, `character`.
- `MAX_NESTING_DEPTH = 256` is the cross-package parity constant, held in a
  zero-dependency `internal/limits.ts` leaf.
- `FormattingOptions` is the sanctioned parity exception — derivation
  mechanics legitimately differ per format.

## The conformance-corpus harness

Every format package gates on its format's official corpus, integrated the
same way:

- **Vendor fixtures as committed plain files** — no submodule, no
  fetch-on-test — under `__test__/fixtures/<corpus>/`, with a pin file
  alongside (yaml's `VENDORED.md`, toml's `README.md`) recording upstream
  repo, tag/commit, fetch date, subset taken, and the update recipe. Check
  the corpus license and record it; test-only vendoring with attribution is
  the ecosystem norm even for CC-BY-SA spec corpora.
- **One `it.effect` per case** in `__test__/e2e/`; valid cases assert the
  expected value/output, invalid cases assert the typed error via
  `Effect.flip`.
- **Empty skip map is the standing goal** — toml runs 205 valid + 474
  invalid cases with zero skips; yaml runs 353 case dirs with empty
  `SKIP`/`SKIP_ASSERTIONS` maps. A skip is a documented exception, not a
  pressure valve. One qualification: real corpora contain entries with no
  assertable output (cmark-gfm's `extensions.txt` example 20 expects
  literally `<IGNORE>` — an upstream crash regression asserting only
  termination). Run those through an explicit `TERMINATION_ONLY` set with
  the reason inline — neither a skip nor a fabricated assertion.
- **Guard the corpus count** (`assert(validCases.length >= N)`) so a
  silently-empty fixture walk cannot green the suite.
- **Fixtures are raw bytes.** When cases deliberately embed CR/CRLF, a
  scoped `.gitattributes` (`* -text`) in the fixture root keeps Git from
  normalizing them (toml's harness protects ~7 such cases this way).
- **Control characters in hand-written tests and TS fixtures are ALWAYS
  escapes (` `, `�`), never literal bytes.** File-editing tooling
  silently mangles literal control characters — an edit round-trip once
  replaced a NUL with a space, which would have made a preprocessing
  hardening test pass vacuously. Literal bytes belong only in committed raw
  fixture files under the scoped `.gitattributes`, which are never
  hand-edited.
- **Differential oracle**: the rejected upstream parser, exact-pinned as a
  devDependency, imported by exactly one property test (toml's `smol-toml`
  at 250 runs; markdown's plan pins `commonmark`). Corpus wins on
  disagreement; the oracle catches what the corpus never sampled.
- **The oracle can be WRONG — and "corpus wins" only settles disagreements
  the corpus actually exercises.** A generated input the corpus never
  sampled needs root-cause investigation in the *oracle's* source before
  either side is trusted: a 20k-input hunt during the markdown port found a
  real commonmark.js defect (a reference-only paragraph before a thematic
  break renders a phantom empty `<p></p>` — a flag that does not carry
  between its two definition-stripping sites in `blocks.js`). When the port
  is right and the oracle is not: correct the oracle's OUTPUT narrowly on
  the oracle side of the comparison, AND pin a tripwire test asserting the
  divergence still exists — a future upstream fix fails the tripwire and
  forces the correction's deletion. Never a skip entry.
- **Unit fixtures must land in the layer they claim to test.** In a
  multi-pass engine, an innocuous-looking input can be claimed by an
  earlier pass and silently test the wrong thing — a markdown inline
  fixture starting with `<` opens an HTML *block*, so the "inline" test was
  exercising the block pass. Lead inline fixtures with plain text (or
  assert the parsed node type first) so a fixture cannot drift between
  layers unnoticed.
- Where the format has a **performance corpus** (markdown's pathological
  suite), it is a separate mandatory family — see the
  algorithmic-complexity section of `hardening-a-parser-port`.

Plus the hand-written families no corpus covers: CST/AST fidelity,
edit/format/visitor behavior, and a hostile-input suite exercising every
hardening guard.

## Scaffold gotchas (the ones that bite)

Full manifest: `.claude/design/effected/package-setup.md`. The load-bearing
subset:

- **Stub `src/index.ts` BEFORE the first install.** A manifest with no
  entrypoint breaks every `pnpm run` in the repo (the `prepare: turbo run
  build:dev` chain). Unconditional.
- Copy a pure sibling (toml is the cleanest recent template); fix the
  per-package fields it is easy to leave stale: `name`,
  `repository.directory`, `homepage` (the `/tree/main/` segment is
  load-bearing), and BOTH model paths (`turbo.json` outputs and
  `savvy.build.ts` `localPaths` must name the package's OWN
  `website/lib/models/<name>`).
- Build only via `pnpm build --filter @effected/<name>` — never
  `node savvy.build.ts --target prod` directly (skips `build:dev`, emits a
  truncated `issues.json` shaped exactly like a clean gate).
- The Schema class factories need the narrow
  `{ messageId: "ae-forgotten-export", pattern: "_base" }` suppression in
  `savvy.build.ts` — never widen it (see `effect-api-extractor-bases`).
- After the first install, check the lockfile diff: a plain install has
  stripped optional platform binaries before.
- Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`.

## Design doc first

No scaffolding before the package's design doc exists at
`.claude/design/effected/packages/<name>.md` (migration-playbook step 2). The
doc states tier, engine origin, module layout, hardening surfaces, corpus
plan and parity notes against these standards — the sibling docs (toml.md is
the tightest) are the template.
