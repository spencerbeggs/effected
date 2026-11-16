---
"@effected/github": minor
---

## Refactoring

* The libsodium sealed box behind `RepositorySecret` is now built from in-house copies of audited `@noble` code: X25519, XSalsa20-Poly1305 and BLAKE2b, each with a provenance header. The output is byte-compatible with libsodium's `crypto_box_seal`, and the tests check it against libsodium itself.

## Bug Fixes

* `RepositorySecret` fails with a decode `GitHubError` when GitHub's public key is not 32 bytes or is a low-order X25519 point. Before, a wrong-length key died as a defect and a low-order key was used unchecked.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| tweetnacl | dependency | removed | 1.0.3 | — |
| blakejs | dependency | removed | 1.2.1 | — |
