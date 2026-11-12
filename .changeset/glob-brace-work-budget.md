---
"@effected/glob": minor
---

## Bug Fixes

Brace expansion now carries the work budget from brace-expansion 5.0.13, so hostile brace patterns finish quickly and answer as minimatch does.

* A pattern whose expansion would take more than 20,000,000 steps of work keeps the brace set where the budget runs out, and the rest of the pattern, literal, as brace-expansion 5.0.13 does. Such a set then matches only its own text. A pattern can reach this with few results, for example deep nesting padded with long literal text, or a long chain of `{a},b}` rewrites. Running past the work budget is not an error; going over `braceExpandMax` results or 4,000,000 characters still fails typed with `ExpansionBudgetExceeded`, as before.
* Three scans that took quadratic time on hostile input are now linear: an unmatched `{` at the head of every group, a long run of commas before a line break when deciding whether `{a},b}` expands, and a brace set of many empty values following one that is mostly empty.
