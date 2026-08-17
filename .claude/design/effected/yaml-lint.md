---
status: current
module: effected
category: architecture
created: 2026-07-20
updated: 2026-08-16
last-synced: 2026-08-16
completeness: 95
related:
  - formatter-convention.md
  - sync-primitive-policy.md
  - effect-standards.md
  - benchmarking.md
  - packages/yaml.md
---

# `@effected/yaml` lint system

## Overview

A yamllint-class lint system inside pure-tier `@effected/yaml`: a rule-engine framework whose first built-in rule is parse-validity, with a surgical-edit tie-in for autofix. **This shipped on 2026-08-12** as phase 3 of the `feat/yaml-fidelity-lint` branch ([issue #129](https://github.com/spencerbeggs/effected/issues/129)) — `YamlToken.ts`, `YamlLintRule.ts`, `YamlLint.ts` and 14 rules under `src/internal/rules/` all exist, with the suite at 1600 tests and conformance unmoved at 1226/1226.

The choice made was "both, layered": not a bare validity checker and not a formatter dressed up as a linter, but a rule engine with validity as rule #1. Consumers register custom rules alongside the built-ins; config references rules by id; a subset of rules can carry a surgical, comment-safe fix.

**The design was fully decided before implementation began.** The core — the tier boundary, the four verbs, the token stream, the rule model, the diagnostic type, the autofix substrate and the facade — was settled when this document was written. The three areas that stayed open — the config schema and severity model, the v1 built-in rule set, and the testing approach — were settled on 2026-08-12 and are recorded under [decisions](#decisions-settled-2026-08-12). This document is now synced to what shipped; where implementation **refined** the sketch, the refinement is marked *(shipped: …)* in place, and the reasoning that produced the original decision is kept, because the reasoning is what stops a later change from drifting back to a rejected alternative.

Sequencing behind [#323](https://github.com/spencerbeggs/effected/issues/323) (explicit-key spill) and [#127](https://github.com/spencerbeggs/effected/issues/127) (comment fidelity) held: both landed first, and `comments-spacing` is written against #127's leading/trailing model. See [sequencing](#sequencing-behind-127).

## What it builds on versus what is new

The lint system is mostly composition over surfaces `@effected/yaml` already ships. Grounding it in the existing package is the point: the engine already tokenizes, composes an AST, streams SAX events and applies positioned edits, so the linter adds a rule layer, not a second parser.

**Pre-existing (built on, not rebuilt):**

- The lex → CST → compose → stringify engine under `src/internal/` — the vendored parser (see [packages/yaml.md](packages/yaml.md)); nothing here re-parses.
- `Yaml.parse` / `Yaml.parseResult` — value-level parse carrying recovered diagnostics.
- `YamlDocument` / `YamlNode` — the composed AST that rules traverse.
- `YamlVisitor.visit` — the SAX-style `Stream<YamlVisitorEvent>`; the token stream below is its lexical-layer parallel.
- `YamlEdit` — the positioned `{offset, length, content}` replacement plus `YamlEdit.applyAll`, the fix substrate.
- `YamlDiagnostic` — the engine's structured diagnostic, wrapped (not reused) by the parse-validity rule.
- The internal lexer/CST token, today `src/internal/token.ts` — explicitly documented there as private "until an LSP-tooling consumer materializes". The lint system is that consumer, so the layer is now promoted.

**New (all shipped):**

- `packages/yaml/src/YamlToken.ts` — the public positioned token stream, promoting the internal token.
- `packages/yaml/src/YamlLintRule.ts` — the rule model: `LintContext`, `LintLine`, `YamlRule`, `YamlLintSeverity`, `YamlLintDiagnostic`.
- `packages/yaml/src/YamlLint.ts` — the config schema and the `YamlLint` facade.
- `packages/yaml/src/internal/rules/*.ts` — the 14 built-in rule implementations, plus `catalog.ts` and a shared `util.ts`.

*(shipped: the design sketched **one** `YamlLint.ts` owning model and facade. It became two modules — see [module layout](#module-layout).)*

## The governing constraint: v1 is the pure half only

**v1 is the pure half only, and it stays inside pure-tier `@effected/yaml`**: the rule engine, the built-in rule catalog, and a config *schema* — a validating `Schema.Struct`, **not** a config-file loader. Everything with a tier smell is deferred to a later, separate boundary or integrated package (or the host): file discovery, config-file loading, reading and writing files, a CLI, and autofix-to-disk.

This is the load-bearing decision. Putting IO, a CLI or config-file loading into pure-tier `yaml` would repeat the tier violation that [`effect-standards.md`](effect-standards.md#dependency-policy) exists to prevent. A pure package that owns its parser must not also own its runner. The pure engine stays pure — strings in, diagnostics or edits out — and the runner is someone else's tier. The same reasoning already governs the fidelity suites in [formatter-convention.md](formatter-convention.md#tier-discipline-applies): a pure-tier package must not smuggle IO in, not even for a good-looking convenience.

## The four verbs, composed

The system is four verbs over one document, three of which already exist:

- **build** — `Yaml.parse` / `YamlTokens.tokenize` (text → document / tokens).
- **check** — `YamlLint.run(text, rules, config)` → `ReadonlyArray<YamlLintDiagnostic>`.
- **format** — `YamlFormat.formatToString` (already exists; canonical emit).
- **fix** — `YamlLint.fix(text, rules, config)` → `Result<string, YamlParseError>` (applies surgical rule edits).

`check` and `fix` are the new verbs; `build` and `format` are the package as it stands. Autofix is deliberately *not* `format` — see [autofix](#autofix-surgical-and-comment-safe).

## The public positioned token stream

`YamlToken.ts` promotes the internal lexer token to public surface. A `YamlToken` is a `Schema.Class` carrying `kind` (a 22-member `YamlTokenKind` literal union), `offset`, `length`, `line`, `character` and `text`. (The internal token in `src/internal/token.ts` names two fields differently — `value` and `column`; promotion reconciles the spelling to the positioned-diagnostic vocabulary the public surface already uses in `YamlDiagnostic`.)

The primitive follows the kit's [sync primitive policy](sync-primitive-policy.md):

- **primitive** — `YamlTokens.tokenize(text): Result<ReadonlyArray<YamlToken>, YamlParseError>`.
- **derived** — `YamlTokens.stream(text): Stream<YamlToken>`, parallel to the existing `YamlVisitor.visit`.

The primitive is the sync array, **not** a `Stream`, and the reasoning is the convention's own: tokenizing is a pure batch transform with no async step and no IO, so the sync-`Result` policy says the pure computation exposes the sync primitive and derives the streaming/Effect form from it. A `Stream` primitive would invert that — forcing every synchronous consumer (a lint host, per the convention's C1) to drive a stream to completion to get an array it could have had directly. The `Stream` form still exists for genuinely incremental (SAX-style) consumers; it is the derived shape, not the source of truth.

*(shipped: **no `options` parameter.** The sketch carried an `options?` on both forms speculatively; the lexer takes none, so neither entry point has one. Adding a parameter nothing reads would have frozen a shape before a consumer asked for it.)*

### Two refinements the promotion forced

**Positions and text are DERIVED, not copied — and the engine was not touched.** The public `line`/`character` are computed from each token's `offset` against a line-start index built in one monotone pass, and `text` is the raw `source.slice(offset, offset + length)`. Neither is the internal token's own field, and that is the point: the internal `column` is CST-parser vocabulary that carries the *construct's indent* on the synthetic `block-map-start` / `block-seq-start` markers rather than the token's own position, and the internal `value` is the *processed* form on quoted scalars (content without the quotes). The public contract is the position and the bytes. Deriving keeps the promotion additive — the lexer and CST parser are unchanged, so nothing in the shipped engine could regress behind the new surface.

**`tokenize` always succeeds; the failure channel is reserved.** The lexer is total, and lexical errors surface as `"error"`-**kind tokens inside the success array**. This is a ruling, not an accident: `parse-validity` exists precisely for documents that do not parse, so a `tokenize` that failed on malformed input would make exactly the documents the linter is for unlintable. The `Result` return type is kept for the reserved channel (future input-hardening guards, matching the hardening posture the rest of the package already has) and is documented as never firing today. The derived `stream` inherits the contract: error tokens arrive as elements, never as a stream failure. Do not "fix" either to fail on error tokens.

## The rule model

The model is four things: the lint context, the rule interface, the lint diagnostic and the facade. **They ship across two modules, not one** — see [module layout](#module-layout) for why.

### `LintContext`

The context handed to every rule (`YamlLintRule.ts`, with the line record named `LintLine`):

```ts
interface LintContext {
  readonly text: string;
  readonly lines: ReadonlyArray<LintLine>; // { text, offset, number }
  readonly tokens: ReadonlyArray<YamlToken>;
  readonly document: YamlDocument;
}
```

The engine tokenizes **once** and every rule shares the one materialized `tokens` array. It materializes rather than streaming on purpose, and the reason is that linting is inherently multi-pass and random-access: N rules each traverse the input, and layout rules need lookahead and lookbehind — colon-spacing inspects the token after the key, empty-lines counts runs of newline tokens. There is no early-exit to exploit and no memory to win, because the full `text` and the composed AST are already resident; a single-pass stream would only force re-tokenization per rule or hand-rolled windowing. The streaming token form exists for *other* consumers; **the lint context is eager by nature.**

*(shipped: `document` is **always present, including for input that does not parse.** The context is built through the engine's recovered compose — the internal `documentFromRaw(composeFirstDocument(text, …), text)` path — so a malformed document still reaches every rule carrying its `errors` / `warnings`, which is what `parse-validity` reports. `documentFromRaw` stays **internal**: it is a raw-record materializer, and exporting it would put a second, unvalidated document constructor on the public surface next to `Yaml.parse`. The lint layer is in-package, so it can use the internal path without widening anything.)*

*(shipped: the context composes with **`uniqueKeys: false`**. Duplicate-key *policy* belongs to the configurable `key-duplicates` rule, so the engine's own duplicate warnings are switched off when building the context and `parse-validity` never double-reports what `key-duplicates` already owns.)*

### `YamlRule`

The public rule interface — built-ins and custom rules are the same shape:

```ts
interface YamlRule {
  readonly id: string;
  readonly check: (ctx: LintContext, options: unknown) => Iterable<YamlLintDiagnostic>;
}
```

Built-ins are just rules; a consumer registers a custom rule by putting it in the array alongside them; config references any rule — built-in or custom — by `id`. There is no privileged built-in mechanism a custom rule cannot reach.

### `YamlLintDiagnostic`

A **separate** `Schema.Class`, deliberately not the engine's `YamlDiagnostic`:

```ts
class YamlLintDiagnostic extends Schema.Class<YamlLintDiagnostic>("YamlLintDiagnostic")({
  rule: Schema.String,
  severity: YamlLintSeverity, // Schema.Literals(["error", "warning"])
  message: Schema.String,
  offset: Schema.Number,
  length: Schema.Number,
  line: Schema.Number,
  character: Schema.Number,
  fix: Schema.optionalKey(YamlEdit),
}) {}
```

It is separate because the engine's `YamlDiagnostic.code` is the lexer/parser/composer/stringifier error-code union — it carries no severity and no fix, and it is the single source of truth for engine fatality ([packages/yaml.md](packages/yaml.md)). Forcing rule-id, severity and fix onto it would pollute an engine type with lint-layer concerns it has no business modelling. So the two stay distinct, and the parse-validity rule bridges them: rule #1 runs the engine parse and **maps** each engine `YamlDiagnostic` into a `YamlLintDiagnostic` with `rule: "parse-validity"`, `severity: "error"` and no `fix`.

## Autofix: surgical and comment-safe

A diagnostic may carry `fix?: YamlEdit`. `YamlEdit` already models a positioned `{offset, length, content}` replacement, and `YamlEdit.applyAll` applies edits in reverse-offset order, is documented to preserve comments and whitespace, and throws on overlaps ([packages/yaml.md](packages/yaml.md)). So `YamlLint.fix` applies non-overlapping rule fixes and is **comment-safe by construction**.

This sidestepped [issue #127](https://github.com/spencerbeggs/effected/issues/127) (formatting loses comments), and the sidestep is the whole reason autofix is a distinct verb from `format`. Surgical per-rule edits do not reformat — they replace exactly the span a rule flagged — so comments survive untouched. Any autofix routed through `YamlFormat.formatToString` would have lost per-node comments — and now that #127 has landed and that limitation is gone, **autofix still must not route through `format`**: a linter that reflows the whole file to fix one flagged span is not fixing, it is formatting under another name. Rules omit `fix` when no safe surgical edit exists; a rule that can only be satisfied by reformatting simply does not offer a fix (`line-length` and `indentation` are the two that ship without one).

*(shipped: the constraint is **structurally tested** — a test asserts `YamlLint.ts` contains no import of `YamlFormat`, so the rule cannot be violated by a well-meaning refactor rather than only by a reviewer noticing.)*

*(shipped: **conflict resolution is deterministic.** Fixes are collected in `YamlLint.run` order — position, then length, then rule id — and a fix is dropped when it overlaps the previously accepted one **or starts at the same offset**. The same-offset clause is not redundant with overlap: two zero-length insertions at one position do not overlap yet would apply in arbitrary order, so the tie is broken by the same total order everything else uses. A dropped fix is still **reported** by `run`; only its application is skipped, and a second `fix` pass applies it.)*

*(shipped: `fix` **fails** with `YamlParseError` when the input carries a fatal parse error. A document the engine cannot compose has no trustworthy offsets to edit against, so refusing to fix is the honest answer; `run` still works on that input, because reporting is exactly what `parse-validity` is for.)*

## The facade

`YamlLint` exposes:

- `YamlLint.run(text, rules, config): ReadonlyArray<YamlLintDiagnostic>` — sorted by position.
- `YamlLint.fix(text, rules, config): Result<string, YamlParseError>` — applies non-overlapping fixes.
- `YamlLint.builtins: ReadonlyArray<YamlRule>` — the built-in catalog.

Custom usage is array concatenation, nothing more:

```ts
YamlLint.run(text, [...YamlLint.builtins, myRule], config);
```

## Module layout

- `packages/yaml/src/YamlToken.ts` — the public positioned token stream (`YamlTokenKind`, `YamlToken`, `YamlTokens.tokenize`, `YamlTokens.stream`).
- `packages/yaml/src/YamlLintRule.ts` — the **model**: `YamlLintSeverity`, `YamlLintDiagnostic`, `LintLine`, `LintContext`, `YamlRule`.
- `packages/yaml/src/YamlLint.ts` — the **config and facade**: `YamlLintRuleSetting`, `YamlLintConfig`, `YamlLint.run` / `.fix` / `.builtins`.
- `packages/yaml/src/internal/rules/*.ts` — one file per built-in rule, plus `catalog.ts` (the ordered rule array and the id → options-schema map) and `util.ts` (shared token/scalar-span helpers).

They build on the existing `YamlVisitor`, `YamlDocument`/`YamlNode`, `YamlEdit`, `YamlDiagnostic` and the promoted internal lexer token — see [what it builds on versus what is new](#what-it-builds-on-versus-what-is-new).

**The model/facade split is a cycle-firewall requirement, not taste.** The design sketched one `YamlLint.ts` owning model *and* facade; that shape cannot compile here. Built-in rules must construct `YamlLintDiagnostic`, and the facade must import the built-in catalog, so a single module closes the cycle `YamlLint → rules → YamlLint`, and [`noImportCycles` is error-level in this package](packages/yaml.md#cycle-firewall). Splitting the model out breaks it: `YamlLintRule.ts` imports nothing back, `src/internal/rules/*` import the model, and `YamlLint.ts` imports both. This is the same firewall discipline that already keeps the engine returning raw records instead of importing public modules.

## Decisions (settled 2026-08-12)

The three areas this document once carried as open questions are decided. They are recorded here with the reasoning, because the reasoning is what keeps an implementer from drifting back to the rejected alternative.

### 1. Config schema and severity model

**A fresh, Effect-native schema owing Python yamllint nothing** — designed purely for kit DX, not for wire compatibility with a `.yamllint` file.

The shape:

- A `YamlLintConfig` `Schema.Class` whose single load-bearing field is a `rules` map.
- Each entry keys a **rule id** to either a bare **severity literal** — `"error" | "warning" | "off"` — or a **typed per-rule options object**. The bare literal is the common case (`{ "line-length": "warning" }`); the options object is the tuning case.
- **Every built-in rule exports its own options schema**, and the `rules` map is assembled from that catalog, so config validation is **rule-aware, never unknown-shaped**: a typo'd or mistyped option on `line-length` fails schema validation with a typed error naming the field, rather than being carried as an opaque `unknown` into the rule's `check`.
- A custom rule id — one not in the built-in catalog — is accepted with a bare severity or an opaque options object that the custom rule validates itself. Rule-aware validation is a property of the built-in catalog, not a barrier to registering a rule the catalog has never heard of.
- `"off"` is a **config-level disable only**. It never reaches a diagnostic: `YamlLintDiagnostic.severity` stays `"error" | "warning"`, and a rule set to `"off"` is not run.

**Presets ship as statics — `YamlLintConfig.default` and `YamlLintConfig.relaxed` — not as an `extends` string mechanism.** An `extends: "default"` string is a resolution step that only exists to survive serialization into a config file, and this package deliberately owns no config-file loader ([the pure half only](#the-governing-constraint-v1-is-the-pure-half-only)). In TypeScript, a preset is a value; composing one is object spread over a static, which typechecks and needs no resolver. Adding a string indirection would import a file-format problem into a package that has no files.

In the **default** preset the `quoted-strings` rule defaults to **double** quotes. The remaining preset values come from each rule's own documented defaults at implementation time; the quote style is pinned here because it is the one that is a taste call rather than a derivation.

**Shipped refinements to the validation story.** Three of them, each closing a way a config could lie:

- **Unknown option keys are rejected.** Per-rule options decode with `onExcessProperty: "error"`, because v4 `Struct`s *strip* unknown keys by default — without the flag a typo'd option would decode cleanly to `{}` and the rule would silently run on its defaults, which is precisely the failure mode "rule-aware, never unknown-shaped" was chosen to prevent. The failure names the offending key.
- **Numeric options are bounded, not merely numeric.** Options like `line-length`'s `max` take a shared non-negative-integer schema, so `-1` or `2.5` fails at config validation rather than producing a rule that never fires or fires on every line.
- **Overriding `parse-validity` fails loud.** It is rule #1 and always-on, so setting it to `"off"` or `"warning"`, or handing it an options object, is a config *error* rather than a silently ignored entry. An entry that looks like it does something must either do it or say why it cannot.

**Severity may also be embedded in the options object.** A tuning entry carries an optional `severity` alongside its options (`{ quoteType: "double", severity: "warning" }`), so choosing options does not cost the ability to grade the rule — the sketch's bare-literal-*or*-options split would otherwise force a caller who wants both into the bare literal and lose the tuning. Resolution order is: `severity` in the options object, else the bare literal, else `"error"`. `parse-validity` is exempt — its bridged engine diagnostics keep the engine's own grading, since fatality is `YamlDiagnostic`'s to declare, not the config's.

Why fresh rather than yamllint-shaped: the two candidate compatibility postures both cost more than they return. Wire compatibility (consume an existing `.yamllint`) requires the deferred loader and would fossilize Python's option spellings — `max`, `level`, `present`/`forbidden` string enums — inside an Effect Schema that would then have to keep them forever. Kit-native-but-yamllint-shaped buys the same fossilization for none of the compatibility. The rule *ids* remain recognizable to anyone who has used yamllint, which is where the familiarity actually pays; the schema underneath them is ours.

### 2. The v1 built-in rule set

**parse-validity plus the full 13-rule candidate catalog** — the curation question is answered by declining to curate. The candidates were already a YAGNI-filtered list, and each is mechanical enough that shipping it is cheaper than maintaining an argument about whether it belongs.

- **parse-validity** — always-on, rule #1, bridges engine `YamlDiagnostic`s into `YamlLintDiagnostic`s (see [`YamlLintDiagnostic`](#yamllintdiagnostic)).
- **line-length**, **trailing-spaces**, **empty-lines**, **eof-newline** — whitespace and line shape.
- **document-start**, **document-end** — `---` / `...` markers.
- **key-duplicates** — duplicate mapping keys.
- **quoted-strings**, **truthy** — scalar style and the `yes`/`no`/`on`/`off` YAML 1.1 trap.
- **comments-spacing**, **colon-spacing**, **hyphen-spacing** — token adjacency.
- **indentation** — block structure.

One file per rule under `packages/yaml/src/internal/rules/`, per the [module layout](#module-layout). All 14 shipped.

**Indentation is acknowledged as the hardest rule and is built last**, after the harness has proven itself on the mechanical rules. It is the only rule in the set that must reason about block structure rather than about a token and its neighbours, so it is the rule most likely to force a change in the [`LintContext`](#lintcontext) — and the cheapest time to discover that is when twelve working rules exist to re-run against the change, not when the harness is itself unproven. *(shipped: the ordering paid off and the context needed no change. `indentation` checks indent **style** only — a consistent unit per level, and one sequence-under-key policy — because structural **legality** is the parser's job and `parse-validity` already reports it. It carries **no fix**: reindenting a block is reformatting.)*

Whether a given rule carries a `fix` is settled rule by rule during implementation, bounded by the standing constraint that a fix must be a surgical, non-overlapping `YamlEdit` ([autofix](#autofix-surgical-and-comment-safe)). A rule that can only be satisfied by reformatting ships without a fix — `line-length` and `indentation` are the two.

**Shipped rulings across the catalog:**

- **Layout rules skip scalar content — a recorded divergence from yamllint.** Trailing whitespace inside a scalar is part of the parsed *value*, and lines inside a scalar or a flow collection are value or flow syntax rather than block indentation. yamllint flags them; we do not, because a layout rule that reports content is noise and a layout *fix* that edits content is data corruption.
- **`line-length` defaults to `max: 120`** — the kit-native width, not yamllint's 80. The rule *ids* are the compatibility surface ([above](#1-config-schema-and-severity-model)); the option surface and defaults are ours.
- **The marker rules (`document-start`, `document-end`) ship outside both presets.** Whether a file leads with `---` is a house convention, not a defect, and a preset that flags every unmarked file by default would train users to disable presets. They are one config entry away for anyone who wants them.
- **`key-duplicates` owns duplicate policy outright**, which is why the [`LintContext`](#lintcontext) composes with `uniqueKeys: false`. One configurable rule reporting duplicates beats a rule and an engine warning reporting the same key twice at two severities nobody can reconcile.

### 3. Testing approach

Three pieces, and **no Python-yamllint differential**.

- **A shared per-rule fixture harness.** One harness, N rule fixture sets, each fixture a triple: input → expected diagnostics → expected fixed output *where a fix exists*. Uniform structure is the point — a per-rule bespoke test file is how a rule set drifts into thirteen dialects of "tested". *(shipped: `__test__/rules/harness.ts`, driving fixture sets grouped by rule family — line shape, token adjacency, documents and keys, scalar style, indentation, parse-validity.)*
- **Every rule proven falsifiable via a mutation/differential mutant.** This is the kit's [fidelity obligation](formatter-convention.md#decision-5--the-fidelity-obligation) applied to rules: for each rule, a deliberately mutated implementation must make its fixtures fail. A rule whose test cannot fail is not tested. *(shipped: automated and **two-sided** — a dead-rule mutant, which reports nothing, and an unfixing mutant, which reports but declines to fix. The second half catches the failure the first cannot: a rule whose diagnostics are right and whose `fix` is inert.)*
- **A token-stream position-fidelity conformance check**, run across the existing vendored yaml-test-suite corpus in `packages/yaml/__test__/fixtures/yaml-test-suite/`: for every token of every fixture, `text.slice(offset, offset + length)` must equal the token's claimed `text`. This is the one invariant the whole rule layer rests on — every diagnostic position and every autofix span is a token position — and the corpus that would break it is already in the repo. *(shipped: strengthened from slice-equality to a **tiling** check — tokens must be ordered, non-overlapping, and every gap between consecutive tokens must be horizontal-whitespace-only, so the walk proves the stream **covers** the source rather than merely quoting it correctly where it happens to speak. ~6.4k tokens across the corpus, with a floor assertion so a silently-empty walk cannot pass as green.)*

**Shipped: the harness guards its own fixtures.** Every fixture input is asserted to parse cleanly, with an explicit `expectsParseErrors: true` opt-out for the fixtures that are *about* malformed input. The guard is bidirectional — declaring the opt-out on an input that parses fine fails too. Without it, a fixture with an accidental syntax error tests the rule against a document the composer never built, and the rule passes for the wrong reason; the opt-out being checked in both directions is what stops it decaying into a blanket suppression pasted onto every fixture.

A differential against Python yamllint is **explicitly rejected**. It would install a Python toolchain into a TypeScript monorepo's test path, and it would bind our diagnostics to another tool's message text and off-by-one conventions — pinning us to bug-for-bug agreement with an implementation whose config schema we just decided not to copy. The mutation proofs give the falsifiability that a differential was wanted for, without the second toolchain.

## Sequencing: behind #127

Implementation was **phase 3** of the `feat/yaml-fidelity-lint` branch, and all three phases landed in order:

1. [#323](https://github.com/spencerbeggs/effected/issues/323) — explicit-key spill in `Yaml.stringify`.
2. [#127](https://github.com/spencerbeggs/effected/issues/127) — comment fidelity: the leading/trailing split on the exported node classes, composer re-attribution forward, blank-line preservation, stringifier emission. A follow-up branch finished the model by moving the fields off `YamlPair` onto the key and value nodes; the [comment model](packages/yaml.md#comment-model) is the current record.
3. [#129](https://github.com/spencerbeggs/effected/issues/129) — this document.

The dependency was real in both directions. `comments-spacing` needs to know whether a comment is an own-line comment or a trailing one to say anything true about the space before its `#`, and before #127 that distinction did not exist in the AST — the single `comment` field was documented as "trailing *or* leading" with no discriminator. It now does: see the [comment model](packages/yaml.md#comment-model) in the package doc. And the [autofix](#autofix-surgical-and-comment-safe) argument above — that fixes must never route through `YamlFormat.formatToString` because it dropped per-node comments — was the constraint #127 fixed; with it fixed, autofix stays surgical anyway, because surgical edits are the right shape for a linter, not merely the safe one.
