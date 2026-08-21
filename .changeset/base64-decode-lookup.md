---
"@effected/npm": patch
---

## Performance

Speed up `CorepackIntegrityHash.FromSri` decoding by replacing per-character base64 alphabet scans with a precomputed ASCII lookup table.

- The conversion output and validation behavior stay the same; only the character-to-sextet lookup path changed.
