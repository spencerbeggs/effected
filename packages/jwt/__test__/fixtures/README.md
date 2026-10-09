# Test fixtures

## `actions-jwks.json`

GitHub Actions' live OIDC JSON Web Key Set, captured verbatim (no edits, not hand-authored).

- **Source:** `https://token.actions.githubusercontent.com/.well-known/jwks`
- **Captured:** 2026-10-09T22:39:56Z
- **Tool:** curl 8.7.1 (macOS)
- **Command:** `curl -sS https://token.actions.githubusercontent.com/.well-known/jwks -o __test__/fixtures/actions-jwks.json`

**What it pins:** that `Jwks` decodes a real production key set: four RSA keys with `kty`, `alg`, `use`, `kid`, `n` and `e`, three of which also carry `x5c` and `x5t`. Those two members are not named by the schema, so the fixture also pins that decoding keeps unknown members. Later tasks import its first key as an RS256 `VerificationKey`.

**Refreshing:** re-run the command and update the capture date. GitHub rotates these keys, so a refresh changes `kid`, `n` and `x5c`. No test hard-codes a `kid`, so a refresh should only break a test if GitHub changes the document's shape.
