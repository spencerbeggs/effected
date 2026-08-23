---
"@effected/yaml": minor
---

## Features

Added lint config inference: `YamlLint` can now infer a `YamlLintConfig` from existing YAML documents instead of requiring one to be hand-written.

- `YamlLint.observe(text, rules)` runs every rule's optional `infer` hook over `text` and returns `StyleEvidence` — a monoid (`StyleEvidence.empty` / `StyleEvidence.combine`) so multi-file evidence merges with an `observe`-per-file, `combine`, resolve loop.
- `YamlLint.resolveStrict(evidence, base?)` overlays unanimous picks onto `base` (default `YamlLintConfig.default`), failing with the new `YamlStyleConflictError` when an observed dimension disagrees across the corpus. Unobserved dimensions fall back to `base`, and an explicit `"off"` in `base` always outranks inference.
- `YamlLint.resolveLenient(evidence, base?)` picks the dominant (plurality) spelling per observed dimension and cannot fail.
- `YamlLint.inferStrict(text, rules, base?)` and `YamlLint.inferLenient(text, rules, base?)` are single-text conveniences combining `observe` and the matching resolver; `inferLenient` also returns `residual` — the diagnostics the inferred config still produces against `text`.

```ts
import { YamlLint } from "@effected/yaml";

const evidence = YamlLint.observe(text, YamlLint.builtins);
const result = YamlLint.resolveStrict(evidence);
// Result.Result<YamlLintConfig, YamlStyleConflictError>
```

Custom rules opt into inference by implementing the new optional `infer` hook on `YamlRule`, yielding `StyleVote` or `StyleFloor` observations. Rules with no detectable style (`truthy`, `key-duplicates`, `line-length`, …) stay default-driven.
