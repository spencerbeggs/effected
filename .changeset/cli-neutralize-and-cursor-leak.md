---
"@effected/cli": patch
---

## Bug Fixes

* `Render.githubLog` now neutralizes legacy `##[` workflow commands inside `Doc.annotation` messages, titles and file names, and inside collapsible group titles, the same way it already did for plain lines. Text a bundle author or pull request controls can no longer inject `##[group]`, `##[endgroup]` or similar into an annotation line. Closes #980.
* `@effected/cli/ui/testing` no longer leaks a cursor-show escape (`ESC[?25h`) to the test runner's real stderr when a test mounts an Ink view on the fake streams. Closes #983.
