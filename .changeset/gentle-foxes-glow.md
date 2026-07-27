---
"@effected/markdown": minor
---

## Breaking Changes

`FrontmatterMissingError` gains a required `reason: "absent" | "captureDisabled"`
field, exported as `FrontmatterMissingReason`. Any code constructing or
pattern-matching on `new FrontmatterMissingError()` with no arguments now
breaks at compile time.

```ts
// Before
new FrontmatterMissingError();

// After
new FrontmatterMissingError({ reason: "absent" });
```

`reason` distinguishes why a frontmatter decoder found no capture:
`"absent"` when the source genuinely has no frontmatter block, and
`"captureDisabled"` when the source opens with a well-formed block but the
document was parsed without `frontmatter: true` — the fix there is
re-parsing with the toggle on, not editing the document.

## Features

`MarkdownDocument.hasFrontmatterBlock` is a new derived getter: whether the
source opens with a well-formed frontmatter block, regardless of how the
document was parsed. It's what `FrontmatterMissingError`'s `reason` is
computed from, so the error and the accessor can never disagree.

### `codeBlockStyle` formatting option

`MarkdownFormattingOptions` gains `codeBlockStyle`, exported as
`CodeBlockStyle` (`"fenced" | "indented"`), converting **language-less**
code blocks between CommonMark's two spellings. It exists because the
default surprises: a language-less `Code` node with no explicit `fenceChar`
serializes as an indented block, not a fence.

```ts
import { MarkdownFormat } from "@effected/markdown";

const formatted = MarkdownFormat.formatToString(source, { codeBlockStyle: "fenced" });
```

Absent, formatting behaves exactly as before. A block with a `lang` is never
touched — it has no indented spelling. Both directions skip conversions that
would change meaning on re-parse: container prefixes, lazy paragraph
continuation, list or footnote absorption, merging with an adjacent code
block, and unrepresentable content (empty, or blank first/last lines).
