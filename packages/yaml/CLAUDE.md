# @effected/yaml

YAML 1.2 parsing, editing, formatting and linting as Effect schemas. **Tier: pure** — peer-depends on `effect` only; its one runtime dependency is the dependency-free `@effected/source`, whose `LineIndex` computes every position the package reports (diagnostics, tokens and lint lines, all with `\n`, `\r\n` and a bare `\r` as line breaks — never U+2028/U+2029). No IO, no services. Never hand-roll an offset → line/character loop again. `src/internal/` holds a **vendored engine** ported with attribution from the `yaml` package; a pure package owns its parser — never add `yaml` as a dependency.

## Knowledge bundle

Durable knowledge about this package lives in `okf/`, not here. Load the concept a task needs:

- Purpose, tier, module layout and cycle firewall, Effect-wrapping policy, AST and value extraction, diagnostics and the error set, input hardening caps, jsonc/yaml parity, multi-document support, Equal/Hash, internal construction, fixture corpus and compliance harness, testing, build → `okf/modules/yaml.md` — Load when: changing the public API, the engine seams or the hardening guards.
- Comment model (which node owns a comment, forward attribution, trailing ownership, the three recorded divergences atop `src/internal/composer/comments.ts`) → `okf/interfaces/yaml-comment-model.md` — Load when: changing where a comment is captured, which node owns it, or how the stringifier puts it back.
- Emitter options (`indentSequences`, the explicit-key spill, `lineWidth` value-path-only folding, `requoteScalars`, `quoteCompat: "yaml-1.1"`) → `okf/interfaces/yaml-stringify-options.md`, `okf/gotchas/yaml-three-stringify-adapters.md`, `okf/limitations/yaml-explicit-key-spill.md` — Load when: changing an emitter option, or adding a call path into `internal/stringifier.ts` (a new adapter that omits `quoteCompat` silently no-ops).
- Token stream and lint system (`YamlToken.ts`, `YamlLintRule.ts`, `YamlLint.ts`, `src/internal/rules/`; the model/facade split, `parse-validity` always on, autofix only through `YamlEdit.applyAll`, the built-in catalog and its rulings, `infer` hooks and config inference, the rule harness and its mutants, token tiling) → `okf/interfaces/yaml-lint.md`, `okf/decisions/yaml-lint-pure-half-only.md` — Load when: touching tokens, rules, lint config, autofix, config inference or a rule test.
- Format-package conventions and the fidelity guarantee → `okf/conventions/format-package-convention.md`, `okf/decisions/format-naming.md` — Load when: adding or renaming a public entry point.

## Operating instructions

- `src/index.ts` is the only re-exporting module; read it for the public surface. `noImportCycles` is error-level — the engine returns raw records and never imports public modules, and mutual recursion threads through the dispatch record on state, never a direct import.
- Lint rules are tested through `__test__/rules/harness.ts` (input → expected diagnostics → expected fixed output), never a bespoke suite; a fixture input must parse cleanly unless it declares `expectsParseErrors`.
- The nine byte-pinned fixtures under `__test__/fixtures/explicit-key/` and the `yaml@2.9.0` literals in `__test__/comment-model-oracle.test.ts` are the contract — never regenerate them.
- The yaml-test-suite e2e harness stays at 100% with empty skip maps; a new entry in the format-idempotence ledger is a loss bug to fix, not to park.
- `savvy.build.ts` carries a narrow `{ messageId: "ae-forgotten-export", pattern: "_base" }` suppression — never widen it.

## Testing and building

Test conventions follow the root context file (`__test__/`, `it.effect`, `assert.*` never `expect`).

```bash
pnpm vitest run packages/yaml            # this package's tests
pnpm build --filter @effected/yaml       # dev + prod, from the repo root
```
