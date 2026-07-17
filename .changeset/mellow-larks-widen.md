---
"@effected/jsonc": minor
---

## Features

### `JsoncFormattingOptionsLike` — plain literals accepted for `formattingOptions`

`JsoncModifyOptions.formattingOptions` now accepts either a `JsoncFormattingOptions` instance or a structurally-matching plain literal, exported as `JsoncFormattingOptionsLike`:

```ts
import { JsoncModifier } from "@effected/jsonc";

yield* JsoncModifier.modify(text, ["a"], 2, {
	formattingOptions: { insertSpaces: false, tabSize: 2 },
});
```

`JsoncFormattingOptions` remains the canonical decoded form; only the option fields are read from either shape.

## Documentation

Value spans for edits now cover exactly the value, byte-exact — a fix carried over from `jsonc-effect` 0.3.x, where spans over-reached trailing content and could swallow whitespace or comments after a value ([jsonc-effect#62](https://github.com/spencerbeggs/jsonc-effect/issues/62)). Consumers migrating from `jsonc-effect` can drop any downstream AST-plus-`trimEnd` workarounds.
