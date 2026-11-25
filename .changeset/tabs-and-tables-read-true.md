---
"@effected/markdown": minor
---

## Bug Fixes

* Tabs are accepted as whitespace around a link reference definition's destination and title and around an inline link's, as CommonMark allows. Documents that used them now parse to the link or definition rather than paragraph text.
* Link reference definitions directly above a table's header row are read as definitions rather than paragraph text.
* A literal-autolink email that follows a backslash escape or an entity has its position corrected to its source end.

## Performance

* Mapping email literals back to the source, splitting a paragraph's link reference definitions, and parsing a long paragraph of many inline nodes all run in linear time. Output is unchanged.
