---
"@effected/github": minor
---

## Features

### `ActionsOidcClaimsFromWire`

New export: a schema that decodes the wire form of a GitHub Actions OIDC token payload (GitHub's own snake_case claim names) into `ActionsOidcClaims`, and encodes it back. `@effected/github-actions` uses it to read and mint tokens.

## Maintenance

`ActionsOidc.verify` is now built on `Oidc.verify` from `@effected/oidc`. Its API and behaviour are unchanged.
