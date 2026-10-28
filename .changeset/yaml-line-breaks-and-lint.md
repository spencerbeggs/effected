---
"@effected/yaml": minor
---

## Bug Fixes

### Line breaks

* A bare CR now breaks a line in the lexer and composer, so a bare-CR document parses like its LF twin. `YamlToken` positions and lint lines follow the LSP line-break rule (LF, CRLF, bare CR), and diagnostics no longer count LS or PS as line breaks.
* A CRLF inside a single-quoted scalar no longer leaves a `\r`, and a root block scalar with an indent indicator after `---` decodes as it does without the marker.
* Positions are computed through `@effected/source`, fixing a character of `-1` at the `\n` of a `\r\n`.

### Lint fixes keep the value

Lint fixes no longer change a document's value:

* `colon-spacing` and `hyphen-spacing` decline fixes that would restructure content or move it across a later column; the issue is still reported.
* `trailing-spaces`, `empty-lines` and `comments-spacing` no longer report inside composed scalars, so they cannot edit multi-line plain scalar content.
