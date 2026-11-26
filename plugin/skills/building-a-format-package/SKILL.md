---
name: building-a-format-package
description: >-
  Use when building, scaffolding or extending an @effected format package, a parse/edit/format library for a text
  format (jsonc, yaml, toml, markdown, or the next one): the module-per-concept surface, the own-the-engine policy,
  Effect wrapping and Result parity, the cross-package parity contract, and the conformance-corpus harness.
when_to_use: >-
  new format package, parse/edit/format surface, Document Node Edit Format Visitor Diagnostic modules, vendor and
  harden a parser, runtime parser dependency, corpus harness, VENDORED pin, differential oracle, parity contract,
  nesting depth cap, Edit and Range field identity
---

# Building a format package

The `@effected` kit's format packages — jsonc, yaml, toml, markdown — share one
architecture, deliberately. This skill is that architecture, so the next format
starts from the pattern instead of re-deriving it from its siblings.

**Before you write the engine, load `hardening-a-parser-port`.** This skill covers
the package *shape*; that one covers the engine's defenses (depth caps, numeric
bounds, prototype pollution, C0, the typed-error invariant). Both apply to every
format package, and a guard added after the engine is written misses surfaces.

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

**A format that serves only one host package may live inside it** as a pure
module set with `Document`, `Edit` and `Diagnostic` folded into one concept
module. Before you add a format module to an existing package, or promote one to
its own package, load
[in-package-format-module.md](references/in-package-format-module.md): it says
what must be kept (the lossless facade, the error split, Result-parity, the
cycle firewall), what may fold, and the one trigger for promotion.

## Engine origin: own it

Pure and boundary packages take **no external runtime dependency** — so a format
package owns its parser. Two sanctioned routes:

- **Vendor + harden with attribution** (jsonc ← Microsoft jsonc-parser, yaml
  ← the `yaml` npm engine, glob ← minimatch): port the engine into
  `src/internal/`, keep upstream license headers, then harden per
  `hardening-a-parser-port`.
- **From scratch** (toml): justified when the grammar is small, stable,
  precisely specified, and has a first-class compliance corpus — a bounded
  bet.

Never the third route: wrapping an external parser as a runtime dependency.
The rejected upstream often survives anyway — as the **differential-test
oracle** (see the harness below).

**Run the port against an executable reference over the real corpus as the
first verification step**, before trusting any hand-written unit suite.

Before you port an engine or an extension from upstream, load
[porting-an-engine.md](references/porting-an-engine.md): where an extension hooks
in is fixed by offset fidelity and the delimiter stacks, a grep for the
construct's name misses dispatch branches that never mention it, and an
extension that branches inside a base construct needs a parameterized
construct swap that no trigger-table entry can express.

## Effect-wrapping policy (and the Result-parity pattern)

Binding on every format package:

- **Pure synchronous** where nothing can fail: navigation, `toValue`,
  `applyAll`, the `format` edit computation, equality. An
  `Effect<_, never>` wrapper on a total function is ceremony.
- **`Effect`** only where the typed error channel is real: `parse`,
  `stringify`, `modify`, schema decode.
- **`Stream`** for the visitor; malformed input surfaces as in-band error
  events.
- **`Result`** sync escape hatches for config-time callers that cannot enter
  the runtime.

The Result-parity pattern (established by `Jsonc.parseResult`): each parse entry
point gets a pure `*Result` variant, and the Effect variant is **defined in terms
of it** behind the named span —

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
  what lets codec-generic consumer code work against any of them — do not
  innovate here without a kit-wide decision.
- The diagnostic core carries the same five fields everywhere: `code`,
  `offset`, `length`, `line`, `character`.
- `MAX_NESTING_DEPTH = 256` is the cross-package parity constant, held in a
  zero-dependency `internal/limits.ts` leaf.
- `FormattingOptions` is the sanctioned parity exception — derivation
  mechanics legitimately differ per format.

## The conformance-corpus harness

Every format package gates on its format's official corpus, integrated the
same way:

- **Vendor fixtures as committed plain files** under
  `__test__/fixtures/<corpus>/`, with a pin file recording upstream, commit,
  subset and update recipe, and the corpus license.
- **One `it.effect` per case** in `__test__/e2e/`; valid cases assert the
  expected value/output, invalid cases assert the typed error via
  `Effect.flip`.
- **Empty skip map is the standing goal.** A skip is a documented exception,
  not a pressure valve; an entry with no assertable output goes in an explicit
  `TERMINATION_ONLY` set.
- **Guard the corpus count** (`assert(validCases.length >= N)`) so a
  silently-empty fixture walk cannot green the suite.
- **Fixtures are raw bytes** under a scoped `.gitattributes` (`* -text`); in
  hand-written tests, control characters are ALWAYS escapes (`\x00`), never
  literal bytes.
- **Differential oracle**: the rejected upstream parser, exact-pinned as a
  devDependency, imported by exactly one property test. Corpus wins on
  disagreement, but **the oracle can be wrong** where the corpus is silent.
- **Serializer verification** is parse → stringify → parse over the whole
  corpus, compared render-to-render.
- **Unit fixtures must land in the layer they claim to test** in a multi-pass
  engine.
- **Keep a standing fixture drawn from a real document**: a green corpus
  proves conformance, not that the productions real files combine still parse.
- Where the format has a **performance corpus** (markdown's pathological
  suite), it is a separate mandatory family — see the
  algorithmic-complexity section of `hardening-a-parser-port`.

Plus the hand-written families no corpus covers: CST/AST fidelity,
edit/format/visitor behavior, and a hostile-input suite exercising every
hardening guard.

Before you set up a corpus harness, add a skip, disagree with the oracle, or
claim a serializer works, load [corpus-harness.md](references/corpus-harness.md):
it has the termination-only pattern, how to correct a wrong oracle with a
tripwire instead of a skip, the render-to-render serializer property, the
fixture-layer trap and the standing-fixture rule. A skip entry or a wrong
comparison greens the suite over a real defect.

## Scaffold gotchas (the ones that bite)

- **Stub `src/index.ts` BEFORE the first install.** A manifest with no
  entrypoint breaks the package's `build` and `types:check`. Unconditional.
- Copy a pure sibling (toml is the cleanest recent template); fix the
  per-package fields it is easy to leave stale: `name`,
  `repository.directory` and `homepage` (the `/tree/main/` segment is
  load-bearing).
- Build via `pnpm build --filter @effected/<name>`, which runs
  `effected package build` after the typecheck; a direct run skips that gate
  and the cache. A package needs no `effected.toml` unless it departs from the
  defaults.
- The Schema class factories need the narrow
  `{ messageId: "ae-forgotten-export", pattern: "_base" }` suppression, which is
  the build's default `meta.tsdoc.suppressWarnings` — never widen it (see
  `effect-api-extractor-bases`).
- After the first install, check the lockfile diff: a plain install has
  stripped optional platform binaries before.
- Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`.

## Design first

No scaffolding before the package has a written design that states its tier,
engine origin, module layout, hardening surfaces, corpus plan and parity notes
against these standards. A sibling format package's design is the template.

## Additional resources

- [references/porting-an-engine.md](references/porting-an-engine.md) — differential verification as the first step of a port, the two constraints that fix where a ported extension hooks in, and the parameterized-construct swap for an extension that branches inside a base construct. Load when: vendoring or porting a parser, porting a dialect extension (GFM and the like), or an extension's construct is unreachable or wins where it should lose.
- [references/corpus-harness.md](references/corpus-harness.md) — vendoring and pinning, the termination-only set, raw bytes and control characters, a wrong oracle and its tripwire, the re-parse serializer property, fixture layers and the standing real-world fixture. Load when: setting up or extending a conformance harness, tempted to add a skip, the port and the oracle disagree, or verifying a serializer.
- [references/in-package-format-module.md](references/in-package-format-module.md) — what a format module inside a host package keeps, what it folds, and when to promote it. Load when: a format serves only one package, or a second package starts to need one that lives inside another.
