---
"@effected/npm": minor
---

## Breaking Changes

`PackagePublish.setupAuth` now always upserts and no longer has an append mode. npm reads the first line whose key matches, so an appended line for a registry already in the file was silently shadowed and a re-minted credential never took effect. A call now replaces its own auth key in place, removes later duplicates of that key, and removes the same registry's other-scheme key (`_auth` when writing a token, `_authToken` when writing a basic credential), because npm checks `_authToken` first and a leftover would win over the credential just written. Every other line is left byte for byte in its original order. With no matching line, the new one is appended. Callers that relied on a second call leaving earlier lines in place now get one line per registry.

## Maintenance

Hex and base64 encoding use core's `Hex` and `Base64` encoders instead of hand-rolled ones (the strict base64 decoder stays), and `npm pack --json` output is decoded in a single schema step.
