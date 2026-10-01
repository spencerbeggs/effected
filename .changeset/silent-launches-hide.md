---
"@effected/mcp": patch
---

## Bug Fixes

- A failed server launch no longer leaks Effect's runtime report markers into a dump of its error. The error `McpStdio.launch` fails with carries them as prototype getters, so a JSON or logger dump of it shows only its message and name; the exit code and "already reported" behaviour are unchanged.
