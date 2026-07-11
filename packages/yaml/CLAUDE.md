# @effected/yaml

Zero-dependency YAML 1.2 parsing, editing and formatting as Effect schemas.
Third migration, merged. 27 source files, 8 test files, 1,346 tests — the largest
package in the repo. **Tier: pure** — peer-depends on `effect` only, zero runtime
deps, no IO, no services. Inputs are strings; outputs are values, documents,
edits, streams or typed errors.

**Design doc:** `@../../.claude/design/effected/packages/yaml.md` — load when
changing the public API, the engine seams, or the hardening guards.

## Engine and facade

`src/internal/` holds a **vendored engine** (~19 files, ~9,973 lines) ported with
attribution from the `yaml` package rather than taken as a runtime dep. House
policy for pure-tier format packages: a pure package owns its parser. Do not add
`yaml` as a dependency.

It is the lex → CST → compose → stringify pipeline: `lexer.ts`, `cst-parser.ts`,
`cst-visitor.ts`, `composer/` (`state.ts`, `block.ts`, `flow.ts`, `scalars.ts`,
`tags.ts`, `anchors.ts`, `document.ts`), `stringifier.ts`, plus `fold.ts`,
`diff.ts`, `equal.ts`, `options.ts`.

### Cycle firewall

`noImportCycles` is error-level. Two rules keep it green:

- The engine returns **raw records** (`{ code, message, offset, length }`) and
  never imports public modules. The facade materializes `YamlDiagnostic` (adding
  `line`/`character`) and constructs the typed errors.
- Mutual recursion threads through a **dispatch record on state**, never a direct
  import. `block.ts` needs `flow.ts`, so `state.ts` declares `FlowComposers` and
  `document.ts` injects `{ composeFlowMap, composeFlowSeq }`.

## Public modules

Re-exported from `src/index.ts`; nothing else is public.

- `Yaml.ts` — value-level facade: `parse`/`parseAll`, `stringify`,
  `stripComments`, `equals`/`equalsValue`, schema factories (`schema`,
  `fromString`, `allFromString`, the `YamlFromString` singleton). Owns
  `YamlParseOptions`, `YamlStringifyOptions`, `YamlParseError`,
  `YamlStringifyError`.
- `YamlDiagnostic.ts` — structured diagnostic carrying errors *and*
  warnings-as-data, the staged code unions, and the **single** fatal-code
  predicate: one source of truth for fatality.
- `YamlNode.ts` — the co-located mutually-recursive AST: `YamlScalar`, `YamlMap`,
  `YamlSeq`, `YamlPair`, `YamlAlias`, the `YamlNode` union, and the
  `ScalarStyle`/`CollectionStyle`/`ScalarChomp` sets. Co-location is what breaks
  the AST import cycle.
- `YamlDocument.ts` — `YamlDocument` and `YamlDirective`: full parsed AST plus
  recovered `errors`/`warnings` arrays.
- `YamlEdit.ts` — `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment`.
  `applyAll(text, edits)` applies in reverse-offset order.
- `YamlFormat.ts` — non-mutating `format`/`modify` edits preserving comments and
  whitespace. Owns `YamlFormattingOptions`, `YamlModificationError`.
- `YamlVisitor.ts` — SAX-style AST events as `Stream<YamlVisitorEvent>`.
  Infallible: diagnostics surface as `Error` events, never a stream failure.

Pure sync where nothing can fail; `Effect` only where the error channel is real;
`Stream` for the visitor.

## Input hardening

Malformed and adversarial input **fails typed, never as a defect**. Four
surfaces, all regression-tested:

1. **Composer depth cap** — `MAX_NESTING_DEPTH = 256` in `composer/state.ts`,
   fatal `NestingDepthExceeded`.
2. **CST parser depth cap** — `MAX_CST_DEPTH = 256 + 8` in `cst-parser.ts`. It
   sits **above** the composer's cap on purpose, so the composer's guard fires
   first and the user sees a positioned diagnostic rather than the CST parser's
   flat error node. Never lower it to or below 256.
3. **Stringify recursion** — `Yaml.stringify` (value path, `stringifyLines`) and
   `YamlDocument.stringify` (node path, `stringifyNodeLines`) both cap at
   `MAX_NESTING_DEPTH`. An internal `StringifyDepthExceeded` throw is caught at
   the facade and materialized into a typed `YamlStringifyError`.
4. **Alias-expansion budget** — a "billion laughs" bomb can stay under
   `maxAliasCount` and still OOM the heap during materialization. `YamlNode.ts`
   bounds materialized nodes via `aliasExpansionLimit(maxAliasCount)`; the
   internal `AliasExpansionBudgetExceeded` throw becomes a typed `YamlParseError`
   carrying an `AliasCountExceeded` diagnostic.

The lesson from (4): depth is not the only DoS vector. When an engine expands
references during materialization, budget the **materialization**, not just the
input's static depth.

## Conventions

- Parity with `@effected/jsonc` binds `Edit`, `Range`, `Path`, `Segment` and the
  diagnostic core. `YamlFormattingOptions` is the **one exception** — read the
  design doc's options-derivation section before assuming parity.
- The engine keeps `new` on its hot composition path; all public surface, tests
  and doc examples use `X.make(...)`.
- `savvy.build.ts` carries a narrow suppression
  `{ messageId: "ae-forgotten-export", pattern: "_base" }` for synthesized class
  heritage symbols. **Never widen it** — it keeps `issues.json` zero-warning
  without hiding real forgotten exports.

## Testing and building

Tests live in `__test__/`, never in `src/`. Use `@effect/vitest` with `it.effect`;
assert with `assert.*`, never `expect`. The 1,226-assertion yaml-test-suite
compliance harness runs from `__test__/e2e/` against committed fixtures and must
stay at 100% with empty skip maps.

```bash
pnpm vitest run packages/yaml            # this package's tests
pnpm build --filter @effected/yaml       # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` indistinguishable from a
clean gate.

## Known issues

- Per-node comments are captured by the composer but never re-emitted by the
  stringifier; only a document-level leading comment round-trips. Carried over
  from v3, not a regression.
