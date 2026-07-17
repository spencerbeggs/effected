---
"@effected/yaml": minor
---

## Features

`Yaml.parseSync` and `Yaml.stringifySync` — synchronous escape hatches returning a `Result` instead of an `Effect`, for config-time callers that cannot `await` (a `vitest.config.ts` is the motivating case). They run the same engine as the Effect variants and honor the package contract: malformed or adversarial input (fatal diagnostics, duplicate keys, a "billion laughs" alias-expansion blow-up, a circular reference, or a value nested past the recursion budget) yields a `Failure` carrying the typed `YamlParseError` / `YamlStringifyError` — never a thrown defect.

`YamlStringifyOptions.lineWidth` now performs real column-based scalar folding. A positive value folds long plain, double-quoted and block-folded (`>`) scalars at approximately that column, inserting only semantically transparent line breaks (round-trip is preserved); block-literal (`|`) content is never folded.

* `parseSync(text, options?): Result<unknown, YamlParseError>`
* `stringifySync(value, options?): Result<string, YamlStringifyError>`

### lineWidth default is now 0 (never wrap)

`lineWidth` previously had no effect — it was threaded into the stringifier but never read, so output never wrapped. Its default changes from `80` to `0`, where `0` (and any value `<= 0`) means never wrap. Output for the default path, and for anyone already passing `lineWidth: 0`, is byte-identical to before. A caller passing a positive `lineWidth` now opts into folding, where previously the value was inert.
