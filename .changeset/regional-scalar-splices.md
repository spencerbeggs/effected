---
"@effected/yaml": patch
---

## Bug Fixes

- `YamlFormat.modify` now takes a region-confined fast path when the target resolves to an existing single-line scalar: only that scalar's source span is spliced, preserving the original quote style, trailing same-line comments, and CRLF line endings everywhere else in the document. Previously every modify re-serialised the whole document, dropping the replaced node's comment and quote style and normalising line endings throughout. Closes effected#659.
- The whole-document pipeline remains the path for removals, insertions, `null` values, object values, block or multi-line scalars, tagged or anchored targets, and any explicit stringify option (`defaultScalarStyle`, `forceDefaultStyles`, `sortKeys`, `indent`, `indentSequences`, `finalNewline`); those results are byte-identical to prior behavior (line endings normalised to LF).
- An `Object.is` round-trip probe re-composes the spliced document before the edit is returned; any mismatch falls back to the whole-document pipeline, so the fast path can never change the resolved value.
