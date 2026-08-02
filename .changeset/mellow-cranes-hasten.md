---
"@effected/markdown": patch
---

## Bug Fixes

- Cap link-destination parenthesis nesting at 32, matching the reference implementation's spec-sanctioned limit. The uncapped bare-destination scan was quadratic on pathological unclosed-link input — thirty thousand repetitions of an unclosed link took over five seconds to parse and now take thirty milliseconds — and the same input class could stall any consumer parsing untrusted markdown.

## Performance

- The `RowContent`, `TableContent` and `ListContent` categories are now real one-member unions, so table and list children pass through construction by identity instead of being deep re-constructed per element. Parsing the pathological tables corpus drops from 7.4 to 2.8 seconds, and consumers building large tables from pre-built rows no longer pay a per-element re-construction cost.
