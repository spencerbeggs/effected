---
"@effected/store": patch
---

## Bug Fixes

- Cache tags decode through a Schema codec. A tags column holding a mixed-type JSON array (for example `["a", 1]`) now decodes to an empty list instead of keeping its string elements, the same as any other corrupt column.
