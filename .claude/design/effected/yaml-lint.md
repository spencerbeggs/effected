---
status: current
module: effected
category: architecture
created: 2026-07-20
updated: 2026-09-02
last-synced: 2026-09-02
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

A yamllint-class lint system inside pure-tier `@effected/yaml`: a public positioned token stream, a rule engine whose first built-in rule is parse-validity, surgical comment-safe autofix, and config inference that reads a corpus's existing style back out as a config. It lives in `packages/yaml/src/YamlToken.ts`, `YamlLintRule.ts`, `YamlLint.ts` and `src/internal/rules/`.

The shape is "both, layered": not a bare validity checker and not a formatter dressed up as a linter, but a rule engine with validity as rule #1. Consumers register custom rules alongside the built-ins; config references rules by id; a subset of rules carries a surgical fix. This document records why the layering is what it is; [packages/yaml.md](packages/yaml.md) is authoritative for the engine underneath it.

## What it builds on

The lint system is mostly composition over surfaces the package already ships. Grounding it in the existing engine is the point: the engine already tokenizes, composes an AST, streams SAX events and applies positioned edits, so the linter adds a rule layer, not a second parser. Nothing here re-parses.

It builds on the lex → CST → compose → stringify engine under `src/internal/`, `Yaml.parse` / `Yaml.parseResult`, the composed `YamlDocument` / `YamlNode` AST, `YamlVisitor.visit`, `YamlEdit` (the positioned replacement plus `applyAll`, the fix substrate) and `YamlDiagnostic`, the engine's structured diagnostic — wrapped, not reused, by parse-validity.

The lint system is the consumer that earned the internal lexer token (`src/internal/token.ts`) a public surface, `YamlToken`; the engine underneath is unchanged.

## The governing constraint: the pure half only

**The lint system stays inside pure-tier `@effected/yaml`**: the rule engine, the built-in rule catalog, and a config *schema* — a validating `Schema.Struct`, **not** a config-file loader. Everything with a tier smell belongs to a later, separate boundary or integrated package, or to the host: file discovery, config-file loading, reading and writing files, a CLI, and autofix-to-disk.

This is the load-bearing decision. Putting IO, a CLI or config-file loading into pure-tier `yaml` would repeat the tier violation [effect-standards.md](effect-standards.md#dependency-policy) exists to prevent. A pure package that owns its parser must not also own its runner. The pure engine stays pure — strings in, diagnostics or edits out — and the runner is someone else's tier. The same reasoning governs the fidelity suites in [formatter-convention.md](formatter-convention.md#tier-discipline-applies).

## The four verbs, composed

The system is four verbs over one document, two of which predate it:

- **build** — `Yaml.parse` / `YamlTokens.tokenize` (text → document / tokens).
- **check** — `YamlLint.run` → an array of `YamlLintDiagnostic`, sorted by position.
- **format** — `YamlFormat.formatToString` (canonical emit).
- **fix** — `YamlLint.fix` → `Result<string, YamlParseError>`, applying surgical rule edits.

Autofix is deliberately *not* `format` — see [autofix](#autofix-surgical-and-comment-safe).

## The public positioned token stream

`YamlToken.ts` promotes the internal lexer token. A `YamlToken` is a `Schema.Class` carrying `kind` (a `YamlTokenKind` literal union), `offset`, `length`, `line`, `character` and `text`.

The primitive follows the kit's [sync primitive policy](sync-primitive-policy.md): `YamlTokens.tokenize` returns a sync `Result` of an array, and `YamlTokens.stream` derives a `Stream` from it, parallel to the existing `YamlVisitor.visit`. The primitive is the sync array, **not** a `Stream`, and the reasoning is the policy's own: tokenizing is a pure batch transform with no async step and no IO. A `Stream` primitive would invert that — forcing every synchronous consumer (a lint host, per the formatter convention's C1) to drive a stream to completion to get an array it could have had directly. The `Stream` form still exists for genuinely incremental consumers; it is the derived shape, not the source of truth.

Neither entry point takes an options parameter, because the lexer takes none.

### Two properties the promotion forced

**Positions and text are DERIVED, not copied — and the engine was not touched.** The public `line`/`character` are computed from each token's `offset` against a line-start index built in one monotone pass, and `text` is the raw source slice. Neither is the internal token's own field, and that is the point: the internal `column` is CST-parser vocabulary carrying the *construct's* indent on the synthetic block-start markers rather than the token's own position, and the internal `value` is the *processed* form on quoted scalars. The public contract is the position and the bytes. Deriving keeps the promotion additive — the lexer and CST parser are unchanged, so nothing in the engine can regress behind the new surface.

**`tokenize` always succeeds; the failure channel is reserved.** The lexer is total, and lexical errors surface as `"error"`-**kind tokens inside the success array**. This is a ruling, not an accident: parse-validity exists precisely for documents that do not parse, so a `tokenize` that failed on malformed input would make exactly the documents the linter is for unlintable. The `Result` return type is kept for the reserved channel — future input-hardening guards, matching the rest of the package's hardening posture — and is documented as never firing today. The derived `stream` inherits the contract: error tokens arrive as elements, never as a stream failure. Do not "fix" either to fail on error tokens.

## The rule model

The model is the lint context, the rule interface, the lint diagnostic and the facade, shipped across two modules — see [module layout](#module-layout) for why.

### `LintContext`

The context handed to every rule (`YamlLintRule.ts`) carries the source `text`, a `lines` array of `LintLine` records, the materialized `tokens` and the composed `document`.

The engine tokenizes **once** and every rule shares the one materialized `tokens` array. It materializes rather than streaming on purpose: linting is inherently multi-pass and random-access. N rules each traverse the input, and layout rules need lookahead and lookbehind — colon-spacing inspects the token after the key, empty-lines counts runs of newline tokens. There is no early-exit to exploit and no memory to win, because the full `text` and the composed AST are already resident; a single-pass stream would only force re-tokenization per rule or hand-rolled windowing. The streaming token form exists for *other* consumers; **the lint context is eager by nature.**

Two properties of how the context is built are load-bearing:

- **`document` is always present, including for input that does not parse.** The context is built through the engine's recovered compose path, so a malformed document still reaches every rule carrying its `errors` / `warnings`, which is what parse-validity reports. That materializer stays **internal**: it builds a document from raw records, and exporting it would put a second, unvalidated document constructor on the public surface next to `Yaml.parse`. The lint layer is in-package, so it can use the internal path without widening anything.
- **The context composes with `uniqueKeys: false`.** Duplicate-key *policy* belongs to the configurable `key-duplicates` rule, so the engine's own duplicate warnings are switched off when building the context and parse-validity never double-reports what `key-duplicates` already owns.

### `YamlRule`

The public rule interface is `id`, a `check` function from context and options to an iterable of diagnostics, and an optional `infer` hook — the mirror image of `check`, feeding [config inference](#config-inference). Built-ins and custom rules are the same shape: a consumer registers a custom rule by putting it in the array alongside them, and config references any rule by `id`. There is no privileged built-in mechanism a custom rule cannot reach.

### `YamlLintDiagnostic`

A **separate** `Schema.Class` from the engine's `YamlDiagnostic`, carrying `rule`, `severity`, `message`, position and an optional `fix: YamlEdit`.

It is separate because `YamlDiagnostic.code` is the lexer/parser/composer/stringifier error-code union — it carries no severity and no fix, and it is the single source of truth for engine fatality ([packages/yaml.md](packages/yaml.md)). Forcing rule id, severity and fix onto it would pollute an engine type with lint-layer concerns it has no business modelling. So the two stay distinct, and parse-validity bridges them: rule #1 runs the engine parse and **maps** each engine diagnostic into a `YamlLintDiagnostic` with `rule: "parse-validity"`, `severity: "error"` and no fix.

## Autofix: surgical and comment-safe

A diagnostic may carry a `fix`. `YamlEdit` already models a positioned replacement, and `YamlEdit.applyAll` applies edits in reverse-offset order, preserves comments and whitespace, and throws on overlaps ([packages/yaml.md](packages/yaml.md)). So `YamlLint.fix` applies non-overlapping rule fixes and is **comment-safe by construction**.

**Autofix must never route through `YamlFormat.formatToString`.** Surgical per-rule edits replace exactly the span a rule flagged; a linter that reflows the whole file to fix one flagged span is not fixing, it is formatting under another name. The constraint is **structurally tested** — a test asserts `YamlLint.ts` contains no import of `YamlFormat` — so it cannot be violated by a well-meaning refactor rather than only by a reviewer noticing. Rules omit `fix` when no safe surgical edit exists; `line-length` and `indentation` are the two that ship without one, because satisfying either means reformatting.

**Conflict resolution is deterministic.** Fixes are collected in `run` order — position, then length, then rule id — and a fix is dropped when it overlaps the previously accepted one **or starts at the same offset**. The same-offset clause is not redundant with overlap: two zero-length insertions at one position do not overlap yet would apply in arbitrary order, so the tie is broken by the same total order everything else uses. A dropped fix is still **reported** by `run`; only its application is skipped, and a second `fix` pass applies it.

**`fix` fails with `YamlParseError` when the input carries a fatal parse error.** A document the engine cannot compose has no trustworthy offsets to edit against, so refusing to fix is the honest answer; `run` still works on that input, because reporting is exactly what parse-validity is for.

## The facade

`YamlLint` is a class of statics: `run` and `fix`, the `builtins` catalog, and the [config-inference](#config-inference) surface (`observe`, `resolveStrict`, `resolveLenient`, `inferStrict`, `inferLenient`). Custom usage is array concatenation, nothing more:

```ts
YamlLint.run(text, [...YamlLint.builtins, myRule], config);
```

## Module layout

- `packages/yaml/src/YamlToken.ts` — the public positioned token stream.
- `packages/yaml/src/YamlLintRule.ts` — the **model**: severity, `YamlLintDiagnostic`, `LintLine`, `LintContext`, `YamlRule`, and the per-occurrence inference vocabulary.
- `packages/yaml/src/YamlLint.ts` — the **config and facade**: the rule-setting and config schemas, the aggregate inference vocabulary, and the `YamlLint` statics.
- `packages/yaml/src/internal/rules/` — one file per built-in rule, plus `catalog.ts` (the ordered rule array and the id → options-schema map) and `util.ts` (shared token/scalar-span helpers).

**The model/facade split is a cycle-firewall requirement, not taste.** Built-in rules must construct `YamlLintDiagnostic`, and the facade must import the built-in catalog, so a single module would close the cycle `YamlLint → rules → YamlLint`, and [`noImportCycles` is error-level in this package](packages/yaml.md#cycle-firewall). Splitting the model out breaks it: `YamlLintRule.ts` imports nothing back, `src/internal/rules/*` import the model, and `YamlLint.ts` imports both. This is the same firewall discipline that keeps the engine returning raw records instead of importing public modules.

## Config schema and severity model

The config schema is **fresh and Effect-native, owing Python yamllint nothing** — designed for kit DX, not for wire compatibility with a `.yamllint` file.

- `YamlLintConfig` is a `Schema.Class` whose single load-bearing field is a `rules` map.
- Each entry keys a **rule id** to either a bare **severity literal** — `"error" | "warning" | "off"` — or a **typed per-rule options object**. The bare literal is the common case; the options object is the tuning case.
- **Every built-in rule exports its own options schema**, and the `rules` map is assembled from that catalog, so config validation is **rule-aware, never unknown-shaped**: a typo'd or mistyped option fails schema validation with a typed error naming the field, rather than being carried as an opaque `unknown` into the rule's `check`.
- A custom rule id — one not in the built-in catalog — is accepted with a bare severity or an opaque options object the custom rule validates itself. Rule-aware validation is a property of the built-in catalog, not a barrier to registering a rule the catalog has never heard of.
- `"off"` is a **config-level disable only**. It never reaches a diagnostic: severity stays `"error" | "warning"`, and a rule set to `"off"` is not run.

**Presets ship as statics — `YamlLintConfig.default` and `YamlLintConfig.relaxed` — not as an `extends` string mechanism.** An `extends: "default"` string is a resolution step that only exists to survive serialization into a config file, and this package deliberately owns no config-file loader ([the pure half only](#the-governing-constraint-the-pure-half-only)). In TypeScript a preset is a value; composing one is object spread over a static, which typechecks and needs no resolver. Adding a string indirection would import a file-format problem into a package that has no files.

Three rules close ways a config could otherwise lie:

- **Unknown option keys are rejected.** Per-rule options decode with `onExcessProperty: "error"`, because v4 `Struct`s *strip* unknown keys by default — without the flag a typo'd option would decode cleanly to `{}` and the rule would silently run on its defaults, which is precisely the failure mode "rule-aware, never unknown-shaped" was chosen to prevent.
- **Numeric options are bounded, not merely numeric.** Options like `line-length`'s `max` take a shared non-negative-integer schema, so `-1` or `2.5` fails at config validation rather than producing a rule that never fires or fires on every line.
- **Overriding parse-validity fails loud.** It is rule #1 and always-on, so setting it to `"off"` or `"warning"`, or handing it an options object, is a config *error* rather than a silently ignored entry. An entry that looks like it does something must either do it or say why it cannot.

**Severity may also be embedded in the options object**, so choosing options does not cost the ability to grade the rule. Resolution order is: `severity` in the options object, else the bare literal, else `"error"`. parse-validity is exempt — its bridged engine diagnostics keep the engine's own grading, since fatality is `YamlDiagnostic`'s to declare, not the config's.

Why fresh rather than yamllint-shaped: both compatibility postures cost more than they return. Wire compatibility (consuming an existing `.yamllint`) requires the deferred loader and would fossilize Python's option spellings inside an Effect Schema that would then have to keep them forever. Kit-native-but-yamllint-shaped buys the same fossilization for none of the compatibility. The rule *ids* remain recognizable to anyone who has used yamllint, which is where the familiarity actually pays; the schema underneath them is ours.

## The built-in rule set

The catalog is parse-validity plus a YAGNI-filtered set of mechanical rules — whitespace and line shape, `---` / `...` markers, duplicate keys, scalar style and the YAML 1.1 truthy trap, token adjacency, and indentation. `src/internal/rules/catalog.ts` is the roster; each rule is one file beside it.

Rulings that hold across the catalog:

- **Layout rules skip scalar content — a recorded divergence from yamllint.** Trailing whitespace inside a scalar is part of the parsed *value*, and lines inside a scalar or a flow collection are value or flow syntax rather than block indentation. yamllint flags them; we do not, because a layout rule that reports content is noise and a layout *fix* that edits content is data corruption.
- **`line-length` defaults to the kit-native width, not yamllint's 80.** The rule ids are the compatibility surface; the option surface and defaults are ours.
- **The marker rules (`document-start`, `document-end`) ship outside both presets.** Whether a file leads with `---` is a house convention, not a defect, and a preset that flagged every unmarked file by default would train users to disable presets. They are one config entry away for anyone who wants them.
- **`key-duplicates` owns duplicate policy outright**, which is why the [`LintContext`](#lintcontext) composes with `uniqueKeys: false`. One configurable rule reporting duplicates beats a rule and an engine warning reporting the same key twice at two severities nobody can reconcile.
- **`indentation` checks indent style only** — a consistent unit per level, and one sequence-under-key policy — because structural *legality* is the parser's job and parse-validity already reports it. It is the only rule that reasons about block structure rather than about a token and its neighbours, and it does so over the same `LintContext` as the rest.

## Config inference

The inverse of `run`: read existing YAML and produce the config its style already follows. This is the adoption story for a repo that has never had a lint config — point the linter at your workflows, get the config out — and the machinery it needs (the eager context, rule-owned option semantics) is exactly what the rule engine already built.

### One primitive, two resolution policies

The surface is **one primitive and two resolvers**, deliberately not a mode enum:

- **`observe`** returns `StyleEvidence` — pure, per-dimension evidence: histograms and measurements (quote types seen, indent widths, marker presence, spacing before `#`, longest line, max blank run). **Evidence is a monoid**: observing N files and merging their evidence gives multi-file inference for free, and the N-file loop stays the caller's — so [the governing constraint](#the-governing-constraint-the-pure-half-only) holds untouched, strings in, config out, no IO enters the package.
- **`resolveStrict`** requires every *observed* dimension to be unanimous and yields an exact config; conflicting evidence fails with `YamlStyleConflictError`, a `Schema.TaggedError` carrying structured conflicts, dominant spelling first. A "mode that fails" is this resolver's **error channel**, not a separate mode — which is why a three-mode design was two modes too many. One nuance is pinned explicitly: **unobserved ≠ conflicting.** A document with no comments says nothing about `comments-spacing`; it falls back to defaults rather than failing. The return is a sync `Result`, per the [sync primitive policy](sync-primitive-policy.md).
- **`resolveLenient`** takes the dominant style per dimension with base-config defaults for the unobserved rest. It is **total, with no thresholding** — plurality wins outright, and ties break deterministically to canonical value order rather than by a tunable cutoff.

The residual report — the diagnostics the inferred config would still produce, "here is your config, and the three places that do not match it" — lives on the `inferStrict` / `inferLenient` pair, which return a `YamlLintInference` of config plus residual. The residual reuses the same context and engine, so the whole round costs one tokenize/compose.

The evidence vocabulary is Schema classes across the two lint modules. `YamlLintRule.ts` holds the per-occurrence side — `StyleVote` and `StyleFloor`, with `StyleObservation` their union. Both are `Schema.TaggedClass`, not plain `Schema.Class`, and aggregation branches on the runtime `_tag`, **never `instanceof`**: Schema class instances are structurally assignable, so a custom rule returning a plain object that type-checks as a `StyleVote` would fail `instanceof` and silently fall into the floor branch. `YamlLint.ts` holds the aggregate side — the canonically-sorted tallies and `StyleEvidence`, with an `empty` static and an associative `combine` (counts add, left first-seen position wins, floors max, output canonicalized) plus the homomorphism from observation lists into the monoid. Monoid laws are generative tests over Schema-derived arbitraries. Value keys are type-discriminating: `"2"` ≠ `2`.

### Ownership: an `infer` hook on the rule

Detection logic lives beside check logic. `YamlRule`'s optional `infer` hook is the mirror image of `check`, so each rule owns its own style detection with the same fixtures its `check` already has, and custom rules participate in inference for free, on the same no-privileged-built-ins principle as [the rule model](#yamlrule). Rules that need the same detection on both sides share the helper between `check` and `infer`, so the two cannot disagree.

The key refinement is that a vote's `dimension` IS the rule's option key and its `value` IS the option value — so the resolvers turn votes into config entries with **zero per-rule knowledge**, and a custom rule's hook feeds the same machinery untranslated. An emergent property rode in for free: rule-aware config validation means a hook voting a bogus dimension on a built-in fails config validation loudly.

Strict overlay semantics are pinned: unanimity is required per **observed** dimension; unobserved dimensions fall to the base config; base `"off"` outranks inference; a base `"warning"` severity survives the overlay; observed rules absent from the base are added.

### Honesty about detectability

Some rules have no detectable *style* and must say so rather than guess:

- **`truthy`** and **`key-duplicates`** are policy rules — their only evidence is violations, so nothing about a clean corpus reveals what the policy should be.
- **`line-length`** and **`empty-lines`** are inferable only as a **floor**: the longest observed line, or the longest observed blank run, proves the limit is *at least* N, not what N is.

Floor-only dimensions stay default-driven under **both** resolvers — floors are informational, never resolved into config. An inference surface that fabricated a `line-length` max from the longest line it happened to see would be lying with a straight face.

The remaining max-constraint rules (`trailing-spaces`, `eof-newline`, `colon-spacing`, `hyphen-spacing`) have no hook for the same reason as the policy rules: their only evidence is violations.

## Testing

Three pieces, and **no Python-yamllint differential**.

- **A shared per-rule fixture harness** (`__test__/rules/harness.ts`), driving fixture sets grouped by rule family. Each fixture is a triple: input → expected diagnostics → expected fixed output where a fix exists. Uniform structure is the point — a per-rule bespoke test file is how a rule set drifts into N dialects of "tested".
- **Every rule proven falsifiable by mutation.** This is the kit's [fidelity obligation](formatter-convention.md#decision-5--the-fidelity-obligation) applied to rules: a deliberately mutated implementation must make its fixtures fail. The mutants are automated and **two-sided** — a dead-rule mutant, which reports nothing, and an unfixing mutant, which reports but declines to fix. The second half catches the failure the first cannot: a rule whose diagnostics are right and whose `fix` is inert. The harness carries a dead-infer mutant per rule set too, so a hook that silently stops observing fails its fixtures.
- **A token-stream position-fidelity conformance check** across the vendored yaml-test-suite corpus. This is the one invariant the whole rule layer rests on — every diagnostic position and every autofix span is a token position. It is a **tiling** check rather than mere slice-equality: tokens must be ordered, non-overlapping, and every gap between consecutive tokens must be horizontal-whitespace-only, so the walk proves the stream **covers** the source rather than merely quoting it correctly where it happens to speak. A floor assertion stops a silently-empty walk passing as green.

**The harness guards its own fixtures.** Every fixture input is asserted to parse cleanly, with an explicit `expectsParseErrors: true` opt-out for the fixtures that are *about* malformed input. The guard is bidirectional — declaring the opt-out on an input that parses fine fails too. Without it, a fixture with an accidental syntax error tests the rule against a document the composer never built, and the rule passes for the wrong reason; checking the opt-out in both directions is what stops it decaying into a blanket suppression pasted onto every fixture.

**Strict-mode inference over our own emitted output is a self-consistency test of the stringifier** — unanimous evidence out of our own emit, or the stringifier is inconsistent with itself. It runs as an e2e suite and pins the stringifier's voice.

A differential against Python yamllint is **explicitly rejected**. It would install a Python toolchain into a TypeScript monorepo's test path, and it would bind our diagnostics to another tool's message text and off-by-one conventions — pinning us to bug-for-bug agreement with an implementation whose config schema we just decided not to copy. The mutation proofs give the falsifiability a differential was wanted for, without the second toolchain.

## Dependence on the comment model

`comments-spacing` needs to know whether a comment is an own-line comment or a trailing one to say anything true about the space before its `#`. That distinction lives in the node-level [comment model](packages/yaml.md#comment-model), which the rule is written against.

The same model is why [autofix](#autofix-surgical-and-comment-safe) is surgical by design rather than by necessity: `YamlFormat.formatToString` preserves per-node comments too, and autofix still must not route through it — surgical edits are the right shape for a linter, not merely the safe one.
