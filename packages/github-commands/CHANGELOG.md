# @effected/github-commands

## 0.2.1

### Maintenance

- Republished to re-verify the package's npm trusted publishing setup. No code changes. [#986][#986]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#986]: https://github.com/spencerbeggs/effected/pull/986

## 0.2.0

### Breaking Changes

- Neutralized text now carries U+2800, which draws as one blank column, where it used to carry an invisible zero-width space. Output is one column wider per marker (one for a line that starts with `::`, plus one for each `##[` in it), and anything that compared against the old U+200B marker must expect U+2800. [#959][#959]

### Bug Fixes

#### Security: neutralized workflow commands were still executed by the runner

- `CommandNeutralizer` marked a neutralized line with a zero-width space (U+200B). The GitHub Actions runner matches `::` and `##[` with ICU culture-sensitive comparisons, which skip zero-width and other ignorable characters, so a line neutralized that way was still parsed as a workflow command. Text that was meant to be inert, such as an error message or a document body, could inject `::add-mask::`, `::error::` or `##[error]` in every earlier release. Treat any release that neutralizes with U+200B as affected, and upgrade.

- The marker is now U+2800 BRAILLE PATTERN BLANK. The runner does not trim it, ICU gives it a weight of its own so `::` and `##[` no longer match across it, and renderers that drop ignorable characters keep it.

- Detection now sees through the full set of code points ICU ignores: controls, format characters, combining marks, variation selectors and tag characters. A line such as `":​:add-mask::x"` is neutralized.

- Text that already carries a U+200B in front of a command is neutralized again, so output stored by an earlier release is made safe on its next pass.

- Neutralization stays idempotent, and a bare `##` heading is still left alone.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#959]: https://github.com/spencerbeggs/effected/pull/959

## 0.1.0

### Breaking Changes

- The kit now builds on and peers stable `effect` `^4.0.0`, in place of an exact release-candidate pin. Move `effect` and every `@effect/*` package to the same `4.x` version in one install: Effect releases them together at one version. A package from this release cannot share an install with an `effect` release candidate. The peer is a caret range, so later `4.x` releases of Effect satisfy the kit without a kit release.
- Kit exports are unchanged. A consumer moving to stable `effect` meets these changes in its own code:
  - `Array`, `Chunk`, `Effect` and `Record` `partition`, their `separate` helpers and `Option.partitionMap` return `[successes, failures]`. Where both sides share a type, the reversed destructuring still compiles, so search for every call.
  - `Schema.brand` takes one identifier and is type-only: the identifier is not stored on the AST and does not survive `SchemaRepresentation`. Compose distinct brands by applying `brand` more than once.
  - `TestSchema`'s round-trip assertion is `verifyRoundTrip`, with Effect forms `succeedEffect`, `failEffect` and `verifyRoundTripEffect`.
  - Effect marks some APIs `@stability unstable`: those may change in a minor Effect release. Untagged APIs follow semver.

### Features

- First release. `@effected/github-commands` is the GitHub Actions workflow-command grammar as pure functions: render a command with the runner's escaping, and neutralize text so the runner cannot read it as one. Strings in, strings out, with no service, no layer, no `effect` and no dependency at all.

- `WorkflowCommand` — `render(name, properties, message)` and the `debug`, `notice`, `warning`, `error`, `group`, `endGroup` and `addMask` helpers. Annotation properties use readable names (`startLine`, `startColumn`) and go out as the wire's (`line`, `col`). Message and property escaping follow the runner's protocol, with `%` escaped first so nothing is escaped twice. This is the module `@effected/github-actions` shipped; it moved here, and `@effected/github-actions` re-exports it.

- `CommandNeutralizer` — `lines(text)` and `text(text)` defang text you did not mean as a command, such as an error message or a file name. It models both runner parsers: `::` after leading whitespace, and the legacy parser's `##[` anywhere in a line. A bare `##` is left alone, so a markdown heading is unharmed. It splits lines at CR, LF and CRLF as the runner does, and it is idempotent. [#905][#905]

```ts
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";

WorkflowCommand.error("build failed", { file: "src/main.ts", startLine: 12 });
// "::error file=src/main.ts,line=12::build failed"

CommandNeutralizer.text("prefix ##[add-mask]secret\n::error::x");
// a zero-width space inside the ##[ and before the ::, so neither parser reads a command
```

### Documentation

- Every exported construct's TSDoc was reviewed against the current API. Summaries open with what the construct does, error channels and requirements are stated, examples use real imports and compile, and links resolve. Comments that described options, errors or defaults the code does not have were corrected. [#910][#910]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#905]: https://github.com/spencerbeggs/effected/pull/905

[#910]: https://github.com/spencerbeggs/effected/pull/910
