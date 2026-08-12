# @effected/yaml

Zero-dependency YAML 1.2 parsing, editing, formatting and linting as Effect schemas. Third migration, merged. 47 source files, 19 test modules, ~1,600 tests — the largest package in the repo. **Tier: pure** — peer-depends on `effect` only, zero runtime deps, no IO, no services. Inputs are strings; outputs are values, documents, edits, streams, diagnostics or typed errors.

**Design docs:**

- `@../../.claude/design/effected/packages/yaml.md` — load when changing the public API, the engine seams, the comment model or the hardening guards.
- `@../../.claude/design/effected/yaml-lint.md` — load when changing the token stream, the rule model, a built-in rule or autofix.

**Child context file:** `@./CLAUDE.lint.md` — the token stream and lint system (`YamlToken.ts`, `YamlLintRule.ts`, `YamlLint.ts`, `internal/rules/`). Load when touching tokens, rules, lint config, autofix or a rule test.

## Engine and facade

`src/internal/` holds a **vendored engine** (~20 files, ~11,100 lines) ported with attribution from the `yaml` package. House policy for pure-tier format packages: a pure package owns its parser — do not add `yaml` as a dependency.

It is the lex → CST → compose → stringify pipeline: `lexer.ts`, `cst-parser.ts`, `cst-visitor.ts`, `composer/` (state, block, flow, scalars, tags, anchors, comments, document), `stringifier.ts`, plus `fold.ts`, `diff.ts`, `equal.ts`, `options.ts`. `internal/rules/` holds one file per built-in lint rule plus the catalog.

### Cycle firewall

`noImportCycles` is error-level. Two rules keep it green; the lint layer's third is in the child file.

- The engine returns **raw records** (`{ code, message, offset, length }`) and never imports public modules; the facade materializes `YamlDiagnostic` (adding `line`/`character`) and the typed errors.
- Mutual recursion threads through a **dispatch record on state**, never a direct import: `state.ts` declares `FlowComposers`, `document.ts` injects `{ composeFlowMap, composeFlowSeq }`.

## Public modules

Re-exported from `src/index.ts`; nothing else is public.

- `Yaml.ts` — value-level facade: `parse`/`parseAll`, `stringify`, `stripComments`, `equals`/`equalsValue`, the schema factories (`schema`, `fromString`, `allFromString`, the `YamlFromString` singleton) and `bind(target)` → a `YamlBoundCodec` `{ schema, decode, encode }` (thin sugar; fails with `Schema.SchemaError`, adds no error taxonomy). Schema-producing: bind to a `const` on hot paths. Owns `YamlParseOptions`, `YamlStringifyOptions`, `YamlParseError`, `YamlStringifyError`.
- `YamlDiagnostic.ts` — structured diagnostic carrying errors *and* warnings-as-data, the staged code unions, and the **single** fatal-code predicate.
- `YamlNode.ts` — the co-located mutually-recursive AST: `YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`, the union, the `ScalarStyle`/`CollectionStyle`/`ScalarChomp` sets. Co-location breaks the AST import cycle. The first four carry the comment triple — `commentBefore` (own-line block above), `comment` (strictly **trailing**), `spaceBefore` (a blank line preceded them); `YamlAlias` deliberately carries none.
- `YamlDocument.ts` — `YamlDocument` and `YamlDirective`: full AST plus recovered `errors`/`warnings`. `comment` is the leading **header** block, `commentAfter` the trailing one — the header spelling is kept on purpose, unlike the node classes.
- `YamlEdit.ts` — `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment`. `applyAll(text, edits)` applies in reverse-offset order and **rejects overlapping edits as a thrown defect** — a programmer-error guard on hand-constructed arrays, parity with jsonc, toml and markdown; `YamlFormat` and `YamlLint.fix` never emit overlaps.
- `YamlFormat.ts` — non-mutating `format`/`modify` edits preserving comments and whitespace. Owns `YamlFormattingOptions`, `YamlModificationError`.
- `YamlVisitor.ts` — SAX-style AST events as `Stream<YamlVisitorEvent>`. Infallible: diagnostics surface as `Error` events, never a stream failure; `Comment` events carry `placement: "leading" | "trailing"`.
- `YamlToken.ts`, `YamlLintRule.ts`, `YamlLint.ts` — token stream and lint system; see `@./CLAUDE.lint.md`.

Pure sync where nothing can fail; `Effect` only where the error channel is real; `Stream` for the visitor and the token stream.

## Input hardening

Malformed and adversarial input **fails typed, never as a defect**. Four regression-tested caps:

1. **Composer depth** — `MAX_NESTING_DEPTH = 256` in `composer/state.ts`, fatal `NestingDepthExceeded`.
2. **CST parser depth** — `MAX_CST_DEPTH = 256 + 8` in `cst-parser.ts`, deliberately **above** the composer's cap so the composer's positioned diagnostic fires first. Never lower it to or below 256.
3. **Stringify recursion** — the value and node paths both cap at `MAX_NESTING_DEPTH`; the internal throw is materialized at the facade into a typed `YamlStringifyError`.
4. **Alias-expansion budget** — a "billion laughs" bomb can stay under `maxAliasCount` and still OOM during materialization, so `YamlNode.ts` bounds materialized nodes via `aliasExpansionLimit(maxAliasCount)` → typed `YamlParseError`.

The lesson from (4): when an engine expands references, budget the **materialization**, not just static input depth.

## Conventions

- Parity with `@effected/jsonc` binds `Edit`, `Range`, `Path`, `Segment` and the diagnostic core. `YamlFormattingOptions` is the **one exception** — read the design doc's options-derivation section first.
- `lineWidth` folding is **value-path-only by contract** (#105): only `Yaml.stringify` / `Yaml.stringifyResult` fold; it is deliberately inert on `YamlDocument.stringify` and the `YamlFormat` helpers, and a regression test pins that inertness — node-path folding cannot land without failing it and rewriting the TSDoc.
- Comment attribution runs **forward** — an own-line comment belongs to the *following* node — and comment text is the raw post-`#` slice. The **six recorded divergences** from the reference `yaml` package sit in one place, atop `src/internal/composer/comments.ts`: read them before touching attribution or emission, do not re-derive them. Canonical mode (`forceDefaultStyles`) is comment-free by design.
- Both stringify paths spill a block-mapping key whose **rendered** form exceeds 1024 characters (strictly `>`, block context only) into explicit-key form (#323); compact continuations pad a structural two columns (`EXPLICIT_COMPACT_PAD`), a recorded oracle divergence. Nine byte-pinned fixtures under `__test__/fixtures/explicit-key/` are the contract — never regenerate them.
- The engine keeps `new` on its hot composition path; all public surface, tests and doc examples use `X.make(...)`.
- `savvy.build.ts` carries a narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for synthesized class heritage symbols. **Never widen it** — it keeps `issues.json` zero-warning without hiding real forgotten exports.

## Testing and building

Tests live in `__test__/`, never in `src/`. Use `@effect/vitest` with `it.effect`; assert with `assert.*`, never `expect`. Two e2e suites run from `__test__/e2e/` against committed fixtures: the 1,226-assertion yaml-test-suite harness, which must stay at 100% with empty skip maps, and token position fidelity. Lint rule tests go through the shared harness (both: child file), never a bespoke suite.

```bash
pnpm vitest run packages/yaml            # this package's tests
pnpm build --filter @effected/yaml       # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` indistinguishable from a clean gate.
