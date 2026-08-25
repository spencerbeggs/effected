---
"@effected/npm": patch
---

## Documentation

- Corrected the README's description of `CorepackIntegrityHash.fromSri`'s base64 reader: it was documented as "strict and canonical," but the reader in fact accepts both the padded and unpadded spelling of a digest — both decode to the identical corepack pin. Padding is its one latitude; a stray character, an interior `=`, or non-zero trailing bits still fail
