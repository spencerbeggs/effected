---
status: draft
module: effected
category: architecture
created: 2026-07-20
updated: 2026-07-20
last-synced: 2026-07-20
completeness: 55
related:
  - formatter-convention.md
  - effect-standards.md
  - packages/yaml.md
---

# `@effected/yaml` lint system

## Overview

A proposal for a yamllint-class lint system inside pure-tier `@effected/yaml`: a real rule-engine framework whose first built-in rule is parse-validity, with a formatter tie-in for autofix. It records the decisions of a brainstorming session that was paused mid-way — a release is being cut and this work is **not** in it. It is a proposal for future work, not shipped behavior.

The choice made was "both, layered": not a bare validity checker and not a formatter dressed up as a linter, but a rule engine with validity as rule #1. Consumers register custom rules alongside the built-ins; config references rules by id; a subset of rules can carry a surgical, comment-safe fix.

**Status (2026-07-20): the core is decided — the tier boundary, the four verbs, the token stream, the rule model, the diagnostic type, the autofix substrate and the facade. Three areas are open** and were not settled before the session was interrupted: the config schema and severity model, the v1 built-in rule set, and the testing approach. Those are recorded as [open questions](#open-questions) with their known direction, and must not be invented past what is written here.

## What it builds on versus what is new

The lint system is mostly composition over surfaces `@effected/yaml` already ships. Grounding it in the existing package is the point: the engine already tokenizes, composes an AST, streams SAX events and applies positioned edits, so the linter adds a rule layer, not a second parser.

**Already exists (built on, not rebuilt):**

- The lex → CST → compose → stringify engine under `src/internal/` — the vendored parser (see [packages/yaml.md](packages/yaml.md)); nothing here re-parses.
- `Yaml.parse` / `Yaml.parseResult` — value-level parse carrying recovered diagnostics.
- `YamlDocument` / `YamlNode` — the composed AST that rules traverse.
- `YamlVisitor.visit` — the SAX-style `Stream<YamlVisitorEvent>`; the token stream below is its lexical-layer parallel.
- `YamlEdit` — the positioned `{offset, length, content}` replacement plus `YamlEdit.applyAll`, the fix substrate.
- `YamlDiagnostic` — the engine's structured diagnostic, wrapped (not reused) by the parse-validity rule.
- The internal lexer/CST token, today `src/internal/token.ts` — explicitly documented there as private "until an LSP-tooling consumer materializes". This proposal is that consumer.

**New:**

- `packages/yaml/src/YamlToken.ts` — the public positioned token stream, promoting today's internal token.
- `packages/yaml/src/YamlLint.ts` — the rule engine, rule model, lint diagnostic and facade.
- `packages/yaml/src/internal/rules/*.ts` — the built-in rule implementations.

## The governing constraint: v1 is the pure half only

**v1 is the pure half only, and it stays inside pure-tier `@effected/yaml`**: the rule engine, the built-in rule catalog, and a config *schema* — a validating `Schema.Struct`, **not** a config-file loader. Everything with a tier smell is deferred to a later, separate boundary or integrated package (or the host): file discovery, config-file loading, reading and writing files, a CLI, and autofix-to-disk.

This is the load-bearing decision, and the rationale is a direct lesson from this program: putting IO, a CLI or config-file loading into pure-tier `yaml` would repeat the exact tier violation that produced the glob→walker cycle earlier in the migration, and that [`effect-standards.md`](effect-standards.md#dependency-policy) exists to prevent. A pure package that owns its parser must not also own its runner. The pure engine stays pure — strings in, diagnostics or edits out — and the runner is someone else's tier. The same reasoning already governs the fidelity suites in [formatter-convention.md](formatter-convention.md#tier-discipline-applies): a pure-tier package must not smuggle IO in, not even for a good-looking convenience.

## The four verbs, composed

The system is four verbs over one document, three of which already exist:

- **build** — `Yaml.parse` / `YamlTokens.tokenize` (text → document / tokens).
- **check** — `YamlLint.run(text, rules, config)` → `ReadonlyArray<YamlLintDiagnostic>`.
- **format** — `YamlFormat.formatToString` (already exists; canonical emit).
- **fix** — `YamlLint.fix(text, rules, config)` → `Result<string, YamlParseError>` (applies surgical rule edits).

`check` and `fix` are the new verbs; `build` and `format` are the package as it stands. Autofix is deliberately *not* `format` — see [autofix](#autofix-surgical-and-comment-safe).

## The public positioned token stream

New `YamlToken.ts` promotes today's internal CST token to public surface. A `YamlToken` is a `Schema.Class` carrying `kind`, `offset`, `length`, `line`, `character` and `text`. (The internal token in `src/internal/token.ts` names two fields differently — `value` and `column`; promotion reconciles the spelling to the positioned-diagnostic vocabulary the public surface already uses in `YamlDiagnostic`.)

The primitive follows the kit's sync-`Result` convention ([formatter-convention Decision 6](formatter-convention.md#decision-6--the-sync-primitive-policy)):

- **primitive** — `YamlTokens.tokenize(text, options?): Result<ReadonlyArray<YamlToken>, YamlParseError>`.
- **derived** — `YamlTokens.stream(text, options?): Stream<YamlToken>`, parallel to the existing `YamlVisitor.visit`.

The primitive is the sync array, **not** a `Stream`, and the reasoning is the convention's own: tokenizing is a pure batch transform with no async step and no IO, so the sync-`Result` policy says the pure computation exposes the sync primitive and derives the streaming/Effect form from it. A `Stream` primitive would invert that — forcing every synchronous consumer (a lint host, per the convention's C1) to drive a stream to completion to get an array it could have had directly. The `Stream` form still exists for genuinely incremental (SAX-style) consumers; it is the derived shape, not the source of truth.

## The rule model

New `YamlLint.ts` owns four things: the lint context, the rule interface, the lint diagnostic and the facade.

### `LintContext`

The context handed to every rule:

```ts
interface LintContext {
  readonly text: string;
  readonly lines: ReadonlyArray<{ readonly text: string; readonly offset: number; readonly number: number }>;
  readonly tokens: ReadonlyArray<YamlToken>;
  readonly document: YamlDocument;
}
```

The engine tokenizes **once** and every rule shares the one materialized `tokens` array. It materializes rather than streaming on purpose, and the reason is that linting is inherently multi-pass and random-access: N rules each traverse the input, and layout rules need lookahead and lookbehind — colon-spacing inspects the token after the key, empty-lines counts runs of newline tokens. There is no early-exit to exploit and no memory to win, because the full `text` and the composed AST are already resident; a single-pass stream would only force re-tokenization per rule or hand-rolled windowing. The streaming token form exists for *other* consumers; **the lint context is eager by nature.**

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
  severity: Schema.Literals(["error", "warning"]),
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

This sidesteps [issue #127](https://github.com/spencerbeggs/effected/issues/127) (formatting loses comments), and the sidestep is the whole reason autofix is a distinct verb from `format`. Surgical per-rule edits do not reformat — they replace exactly the span a rule flagged — so comments survive untouched. Any autofix routed through `YamlFormat.formatToString` **would** lose per-node comments (the known limitation recorded in [packages/yaml.md](packages/yaml.md)) and must not be used for fixing until #127 lands. Rules omit `fix` when no safe surgical edit exists; a rule that can only be satisfied by reformatting simply does not offer a fix.

## The facade

`YamlLint` exposes:

- `YamlLint.run(text, rules, config): ReadonlyArray<YamlLintDiagnostic>` — sorted by position.
- `YamlLint.fix(text, rules, config): Result<string, YamlParseError>` — applies non-overlapping fixes.
- `YamlLint.builtins: ReadonlyArray<YamlRule>` — the built-in catalog.

Custom usage is array concatenation, nothing more:

```ts
YamlLint.run(text, [...YamlLint.builtins, myRule], config);
```

## Proposed module layout

- `packages/yaml/src/YamlToken.ts` — the public positioned token stream (`YamlToken`, `YamlTokens.tokenize`, `YamlTokens.stream`).
- `packages/yaml/src/YamlLint.ts` — `LintContext`, `YamlRule`, `YamlLintDiagnostic` and the `YamlLint` facade.
- `packages/yaml/src/internal/rules/*.ts` — one file per built-in rule implementation.

All three are new. They build on the existing `YamlVisitor`, `YamlDocument`/`YamlNode`, `YamlEdit`, `YamlDiagnostic` and the promoted internal lexer token — see [what it builds on versus what is new](#what-it-builds-on-versus-what-is-new).

## Open questions

The session was interrupted before these were settled. The direction is recorded where one exists; the choice is **not** made, and must not be invented past what is written.

1. **Config schema and severity model.** The direction was an Effect-native `Schema.Struct` structurally shaped like Python yamllint's config: a rule-id → enable/disable/severity-plus-per-rule-options map, with severity levels error/warning/off and possibly `extends` presets (default/relaxed). It is a validating schema, not a loader — the loader is deferred with the rest of the [pure/impure split](#the-governing-constraint-v1-is-the-pure-half-only). What is **not** settled is how close to yamllint it sits: yamllint-wire-compatible (consume an existing `.yamllint`), kit-native-but-yamllint-shaped (same structure, kit spelling), or a fresh schema owing yamllint nothing. Open.

2. **The v1 built-in rule set.** parse-validity is always-on and is rule #1. Beyond it, the v1 catalog is a YAGNI curation of the yamllint rule set, and *which* rules ship is open. Candidates: line-length, trailing-spaces, empty-lines, eof-newline, document-start, document-end, key-duplicates, indentation, quoted-strings, truthy, comments-spacing, colon-spacing, hyphen-spacing. The selection among these is not made.

3. **Testing approach.** Not yet discussed. The binding constraint carried over from this program's fidelity lessons ([formatter-convention.md](formatter-convention.md#decision-5--the-fidelity-obligation)) is that rules and the token stream each need fixtures **plus** mutation/differential proof that a test can fail — a rule whose test cannot fail is not tested. The token stream additionally wants its own conformance check that it round-trips positions faithfully: every token's `offset`/`length` must slice the exact source span it claims. How this is structured — shared harness, per-rule fixtures, differential against Python yamllint — is open.
