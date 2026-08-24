# @effected/yaml

Zero-dependency YAML 1.2 parsing, editing, formatting and linting as Effect schemas. 48 source files, 25 test modules, ~1,950 tests. **Tier: pure** — peer-depends on `effect` only, zero runtime deps, no IO, no services.

**Design docs:**

- `@../../.claude/design/effected/packages/yaml.md` — load when changing the public API, the engine seams, the comment model or the hardening guards.
- `@../../.claude/design/effected/yaml-lint.md` — load when changing the token stream, the rule model, a built-in rule or autofix.

**Child context file:** `@./CLAUDE.lint.md` — the token stream and lint system. Load when touching tokens, rules, lint config, autofix or a rule test.

## Engine and facade

`src/internal/` holds a **vendored engine** ported with attribution from the `yaml` package. House policy: a pure package owns its parser — never add `yaml` as a dependency.

It is the lex→CST→compose→stringify pipeline (`lexer.ts`, `cst-parser.ts`, `cst-visitor.ts`, `composer/`, `stringifier.ts`); `internal/rules/` holds one file per built-in lint rule plus the catalog.

### Cycle firewall

`noImportCycles` is error-level. Two rules keep it green; the lint layer's third is in the child file.

- The engine returns **raw records** (`{ code, message, offset, length }`) and never imports public modules; the facade materializes `YamlDiagnostic` (adding `line`/`character`) and the typed errors.
- Mutual recursion threads through a **dispatch record on state**, never a direct import: `state.ts` declares `FlowComposers`, `document.ts` injects `{ composeFlowMap, composeFlowSeq }`.

## Public modules

Re-exported from `src/index.ts`; nothing else is public.

- `Yaml.ts` — value-level facade: `parse`/`parseAll`, `stringify`, `stripComments`, `equals`/`equalsValue`, the schema factories (`schema`, `fromString`, `allFromString`, the `YamlFromString` singleton) and `bind(target)` → a `YamlBoundCodec` `{ schema, decode, encode }` (thin sugar; fails with `Schema.SchemaError`, no error taxonomy). Schema-producing: bind to a `const` on hot paths. Owns the parse/stringify option and error types.
- `YamlDiagnostic.ts` — structured diagnostic carrying errors *and* warnings-as-data, the staged code unions, and the **single** fatal-code predicate.
- `YamlNode.ts` — the co-located mutually-recursive AST: `YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`, the union, the `ScalarStyle`/`CollectionStyle`/`ScalarChomp` sets. Co-location breaks the AST import cycle. **Comments live on nodes, never on pairs**: every class *except* `YamlPair` carries the triple — `commentBefore` (own-line block above), `comment` (strictly **trailing**), `spaceBefore` (a blank line preceded it). `YamlPair` is `key` and `value`, nothing else; `YamlAlias` carries the triple like the rest.
- `YamlDocument.ts` — `YamlDocument` and `YamlDirective`: full AST plus recovered `errors`/`warnings`. `commentBefore` is the header block sitting **ahead of a `---` marker**, `comment` the trailing one — the same two names the node classes use. A header after the marker leads the root node; a header with no marker leads the first entry's key.
- `YamlEdit.ts` — `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment`. `applyAll(text, edits)` applies in reverse-offset order and **rejects overlapping edits as a thrown defect** — a programmer-error guard on hand-built arrays (parity with jsonc/toml/markdown); `YamlFormat` and `YamlLint.fix` never emit overlaps.
- `YamlFormat.ts` — non-mutating `format`/`modify` edits preserving comments and whitespace. Owns `YamlFormattingOptions`, `YamlModificationError`. Opt-in `requoteScalars` applies `quoteStyle` to already-quoted scalars via shared `src/internal/requote.ts` (semantics-preserving-or-skip; modes: design doc).
- `YamlVisitor.ts` — SAX-style AST events as `Stream<YamlVisitorEvent>`. Infallible: diagnostics surface as `Error` events, never a stream failure; `Comment` events carry `placement: "leading" | "trailing"`.
- `YamlToken.ts`, `YamlLintRule.ts`, `YamlLint.ts` — token stream and lint system; see `@./CLAUDE.lint.md`.

## Input hardening

Malformed and adversarial input **fails typed, never as a defect**. Four regression-tested caps, detailed in the design doc:

1. **Composer depth** — `MAX_NESTING_DEPTH = 256` (`composer/state.ts`), fatal `NestingDepthExceeded`.
2. **CST parser depth** — `MAX_CST_DEPTH = 256 + 8`, deliberately **above** the composer's cap so its positioned diagnostic fires first. Never lower it to or below 256.
3. **Stringify recursion** — both paths cap at `MAX_NESTING_DEPTH`, materialized into `YamlStringifyError`.
4. **Alias-expansion budget** — a "billion laughs" bomb can stay under `maxAliasCount` and still OOM, so `YamlNode.ts` bounds *materialized* nodes via `aliasExpansionLimit(maxAliasCount)`.

## Conventions

- `quoteStyle` has a dialect-compat sibling, **`quoteCompat: "yaml-1.1"`**: additionally quotes a plain scalar a YAML 1.1 resolver (js-yaml, PyYAML, libyaml) would coerce to a non-string (`yes`/`no`/`on`/`off`, timestamps, sexagesimal, underscored/base-N numbers) — additive only, never narrows what already quotes. It is a `YamlStringifyOptions` field read straight off `ctx` inside `internal/stringifier.ts`, so any new call path into the stringifier must forward it explicitly — nothing derives it from another option. All three current adapters (`Yaml.ts`, `YamlDocument.ts`, `YamlFormat.ts`'s `toStringifyInput`) thread it; a fourth that omits it silently no-ops rather than erroring.
- Parity with `@effected/jsonc` binds `Edit`, `Range`, `Path`, `Segment` and the diagnostic core. `YamlFormattingOptions` is the **one exception** — read the design doc's options-derivation section first.
- `lineWidth` folding is **value-path-only by contract** (#105): only `Yaml.stringify` / `Yaml.stringifyResult` fold; it is deliberately inert on `YamlDocument.stringify` and the `YamlFormat` helpers, and a regression test pins that inertness — node-path folding cannot land without failing it and rewriting the TSDoc.
- Comment attribution runs **forward** — an own-line comment leads the *following* entry's key node — and a trailing comment belongs to the **last node on its line**: the value when the value ends there (`a: 1 # t`), the key when it does not (`push: # only main`, value below). Comment text is the raw post-`#` slice (spaces-only slices store one extra escape space so a bare `#` cannot collide with the embedded-blank-line encoding `""`; renderers strip it — see `rawCommentText`). The **three recorded divergences** from the reference `yaml` package sit in one place, atop `src/internal/composer/comments.ts`: read them before touching attribution or emission, do not re-derive them. Canonical mode (`forceDefaultStyles`) is comment-free by design.
- Both stringify paths spill a block-mapping key whose **rendered** form exceeds 1024 characters (strictly `>`, block context only) into explicit-key form (#323); compact continuations pad a structural two columns (`EXPLICIT_COMPACT_PAD`), a recorded oracle divergence. Nine byte-pinned fixtures under `__test__/fixtures/explicit-key/` are the contract — never regenerate them, nor the `yaml@2.9.0` literals in `__test__/comment-model-oracle.test.ts`.
- The engine keeps `new` on its hot composition path; all public surface, tests and doc examples use `X.make(...)`.
- `savvy.build.ts` carries a narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for synthesized class heritage symbols. **Never widen it** — it keeps `issues.json` zero-warning without hiding real forgotten exports.

## Testing and building

Test conventions follow the root context file (`__test__/`, `it.effect`, `assert.*` never `expect`). Four e2e suites run from `__test__/e2e/`: the 1,226-assertion yaml-test-suite harness (100%, empty skip maps, always); token position fidelity; format properties, whose idempotence ledger is 5 pinned ids — a new one is a loss bug to fix, not to park; and strict-inference self-consistency over our own emitted output. Lint rule tests go through the shared harness (both: child file), never a bespoke suite.

```bash
pnpm vitest run packages/yaml            # this package's tests
pnpm build --filter @effected/yaml       # dev + prod, from the repo root
```
