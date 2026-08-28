---
"@effected/jsonc": patch
---

## Performance

Reduced string-token scan cost for escape-heavy JSONC by accumulating decoded segments and joining once, instead of repeatedly concatenating in the scanner loop.

- Output, public API, and JSONC compatibility behavior are unchanged; this only changes how token text is assembled internally.
