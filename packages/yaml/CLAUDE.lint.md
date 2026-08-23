# CLAUDE.lint.md — @effected/yaml token stream and lint system

The lexical half of the package: the public positioned token stream and the yamllint-class lint system built on it (#129). Both stay **pure tier** — strings in, tokens, diagnostics or a fixed string out. No file discovery, no config loading, no CLI, no autofix-to-disk; the runner is a consumer's tier.

**Design doc:** `@../../.claude/design/effected/yaml-lint.md` — load when changing the token surface, the rule model, a built-in rule, the config schema or autofix.

## Public modules

- `YamlToken.ts` — 22 `YamlTokenKind`s, `YamlToken`, and `YamlTokens.tokenize`/`.stream`. `tokenize` is a sync `Result` primitive that **always succeeds** — lexical errors arrive as `"error"`-kind tokens and the failure channel is reserved; do not start using it. `stream` is derived from `tokenize`, not a second walk. `line`/`character` derive from `offset` and `text` is the raw source slice — never surface the internal `column`/`value`, which mean something else.
- `YamlLintRule.ts` — the lint **model**: `LintContext`, `LintLine`, `YamlRule`, `YamlLintSeverity`, `YamlLintDiagnostic`, plus the per-occurrence inference vocabulary `StyleVote`/`StyleFloor`/`StyleObservation` and the optional `infer?: (ctx) => Iterable<StyleObservation>` hook on `YamlRule` — the mirror image of `check`, so custom rules participate in inference for free. Imports nothing back.
- `YamlLint.ts` — the **config and facade**: `YamlLintRuleSetting`, `YamlLintConfig` (presets as the statics `default`/`relaxed`), `YamlLint.run`/`.fix`/`.builtins`, and the config-inference surface (#345): the `StyleEvidence` monoid (`empty`/`combine`/`fromObservations`, with `StyleVoteTally`/`StyleFloorTally`), `StyleConflict`/`YamlStyleConflictError`, and `YamlLint.observe`/`.resolveStrict` (sync `Result`)/`.resolveLenient`/`.inferStrict`/`.inferLenient` → `YamlLintInference { config, residual }`. Semantics (strict overlay, unobserved ≠ conflicting, floors never resolved into config) live in the design doc.

The model is split from the facade for the cycle firewall: rules construct `YamlLintDiagnostic` while `YamlLint.ts` imports the rule catalog, so one module would close `YamlLint → rules → YamlLint`. Do not merge them.

## Load-bearing rules

- **`parse-validity` is rule #1 and always on.** Config entries disabling, demoting or configuring it are rejected loudly, as are unknown option keys (`onExcessProperty: "error"`) and out-of-bounds numerics. Silently ignoring an entry that looks like it does something is the failure mode this prevents.
- **`fix` routes only through `YamlEdit.applyAll`** — surgical, comment-safe edits, never a reflow. A structural test asserts `YamlLint.ts` never imports `YamlFormat`; keep it that way. Same-offset fixes apply deterministically.
- **No second parser.** Rules read one materialized token array, the composed document and the source lines; the engine tokenizes and composes once per run.
- Rule context carries `uniqueKeys: false` — `key-duplicates` owns duplicate policy, not the composer.
- The 14 built-ins live one-per-file under `src/internal/rules/`, registered in `catalog.ts` alongside their option schemas. Layout rules skip scalar content; marker rules (`document-start`/`document-end`) stay outside both presets; `line-length` defaults to 120; `quoted-strings` defaults to double, and its fix delegates to `src/internal/requote.ts` in conservative mode (the format path's `requoteScalars` shares the helper in escaping mode); `indentation` is style-only and offers **no fix**.
- Seven built-ins carry `infer` hooks: five vote (`quoted-strings`, `indentation`, `document-start`, `document-end`, `comments-spacing`), two emit floor-only evidence (`line-length`, `empty-lines`). The rest stay default-driven — do not add a hook a rule's evidence cannot honestly support.

## Testing

Rules are tested through the shared `__test__/rules/harness.ts` (input → expected diagnostics → expected fixed output), never a bespoke suite — thirteen rules must not become thirteen dialects of "tested". Two guards ride on it:

- Every fixture input must **parse cleanly** unless it declares `expectsParseErrors`, checked **bidirectionally** so the opt-out cannot decay into a pasted suppression.
- Automated **dead-rule** and **unfixing** mutants prove each rule falsifiable; the second catches correct diagnostics with an inert `fix`.

`infer` hooks are tested the same way: the harness's `testRuleInference` runner (input → expected observations) rides a **dead-infer** mutant, so a hook that silently stops observing fails its fixtures.

`__test__/e2e/token-fidelity.e2e.test.ts` runs the whole yaml-test-suite corpus through the token stream: tokens must **tile** the source — ordered, non-overlapping, `text` equal to the source slice, gaps horizontal-whitespace-only — with a floor assertion so a silently-empty walk cannot pass green. Every diagnostic position and fix span rests on that invariant.
