---
"@effected/jwt": minor
---

## Features

### JWS, JWT, JWK and JWKS over WebCrypto

`@effected/jwt` signs and verifies JSON Web Signatures and Tokens, models JSON Web Keys, and resolves keys from a JWKS endpoint. It is built on WebCrypto with no `node:` imports, so it runs on Node and on Cloudflare workerd.

* RS256 and ES256 are the supported algorithms, and the algorithm is taken from the key rather than from the token header.
* A token whose `alg` is outside that set is refused before any key is resolved, and a token carrying `crit` is refused.
* RSA keys must be at least 2048 bits and EC keys must be P-256.
* PEM keys are accepted as PKCS#1 or PKCS#8, including PEM text whose line breaks arrive as escaped `\n`.
* Every failure is a single `JwtError` with a `reason` you can route on.

### Key resolution with `JwksResolver`

`JwksResolver` fetches and caches a remote key set and selects the key for a token.

* Storage goes through the `JwksStore` seam, so the cache can live in memory or in a store you provide.
* Entries honour a TTL, refetches are rate-limited, and the fetch has a timeout.
* Discovery is https-only.

### Test issuer at `@effected/jwt/testing`

`TestIssuer` mints keys and signed tokens, and serves a matching key set, so tests can exercise verification without a network or a real identity provider.
