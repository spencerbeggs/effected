# @effected/source

Source-text positions as plain values: `LineIndex` converts a UTF-16 offset to a zero-based `{ line, character }` and back, and `SourcePosition`, `SourceRange`, `SourceSpan`, `SourceLocation` and `SourceDiagnostic` are the structural shapes the kit's format packages (`jsonc`, `yaml`, `toml`, `markdown`) already share.

**Tier: pure.** No `effect` (not even a peer), no `node:` import, no service, no dependency of any kind, no `@effected/*` edge, `"sideEffects": false`. Never add one: format packages and LSP servers at every tier depend on this one, as a REGULAR dependency, and that is only sound while it asks for nothing and carries no shared-instance contract. `__test__/entrypoints.test.ts` pins both.

**Design doc:** `@./okf/modules/source.md` — Load when: changing a ruling (base, encoding, line breaks, clamping), adding an option, or adopting `LineIndex` in a format package. Its "What each package computes today" table is the byte-for-byte mapping each adopter needs, and its findings list the bugs adoption fixes.

## Rules that are load-bearing

- **Name `SourceIndex`, never the `LineIndex` class, in any signature that takes or returns an index** — here and in every adopter. `LineIndex`'s `private` members make it nominal, so two installed copies fail TS2345 against each other's class; `__test__/SourceIndex.test.ts` pins the difference. Never add a `private` or `#private` member to any other exported type.
- **The shapes are interfaces, never Schema classes.** Two installed copies must never disagree about what a position is; a class compared by identity would. Each format package keeps its own diagnostic class, code union and errors — this is not a shared errors package (`okf/decisions/no-shared-errors-package.md`).
- **Zero-based, UTF-16 code units, LSP line breaks (`\n`, `\r\n`, bare `\r`) by default.** `"lf"` and `"unicode"` exist only so existing producers can be reproduced; do not add a rule without an adopter.
- **Clamp out-of-range input the way `vscode-languageserver-textdocument` does**, including an offset inside a `\r\n` reading as the end of its line. Every hand-rolled loop in the kit answered `character: -1` there.
- **A non-integer argument throws `RangeError`.** Never clamp `NaN`.
- **No static that duplicates an instance method** (no `LineIndex.positionAt(text, offset)`): API Extractor cannot link either.
- **The differential test's oracle shares no code with `LineIndex`.** Keep it a regular-expression splitter; never make it call `src/`.
- **Write astral and separator characters as escapes** (`\u2028`, `\u{1F600}`) in source and tests, never literally.

```bash
pnpm vitest run packages/source/__test__
pnpm build --filter '@effected/sourc*'   # never the raw savvy.build.ts
```
