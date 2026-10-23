# @effected/oidc

The kit's OpenID Connect vocabulary over `@effected/jwt`: the `IdentityToken` issuer contract, ID-token claims, an unverified decode and a discovery-backed verify. Boundary tier, deliberately thin: one regular dependency (`@effected/jwt`, which does the JWS, issuer discovery and JWKS work), `effect` the only peer, no `node:` import.

## Import

```ts
import { IdentityToken, IdentityTokenError, IdTokenClaims, Oidc } from "@effected/oidc";
import type { IdentityTokenShape, OidcVerifyOptions } from "@effected/oidc";
```

**Platform**: `Oidc.verify` needs `JwksResolver` from `@effected/jwt` in `R`, which needs an `HttpClient` and a `JwksStore` provided once at the edge. `Oidc.decodeUnverified` and `IdentityToken` need nothing.

## Core API

- **`IdentityToken`** — the inverted issuer contract, a `Context.Service` with one member: `token(audience)` → `Effect<Redacted<string>, IdentityTokenError>`. The consumer that needs *a* token (such as `@effected/sbom`'s `SigstoreSigner`) requires it; whoever can issue one provides it. `IdentityToken.ts` imports only `effect`, so depending on the contract links no JWT code.
  - **`IdentityToken.layerStatic(token)`** answers with a token the caller already holds (`Redacted` or a string) and **ignores the audience**, so minting it for the right audience is the caller's job.
  - **`IdentityToken.makeTest(overrides?)`** / **`layerTest(overrides?)`** answer with a fixed fabricated token (a real answer, where a fabricated signature would be a lie), unlike `sbom`'s `SigstoreSigner.makeTest`, which dies.
  - In GitHub Actions, provide `@effected/github-actions`'s `ActionsIdentityToken.layer`.
- **`IdentityTokenError`** — tagged error with `audience` (the one the token was requested for) and `cause`.
- **`IdTokenClaims`** — a Schema: `jwt`'s `RegisteredClaims` plus `azp`, `nonce`, `auth_time`, `acr` and `amr`, every claim optional and the struct **open**, so unnamed claims survive the decode. A provider's own claims belong in a caller-supplied schema passed to `verify` or `decodeUnverified`, not a subclass.
- **`Oidc.verify(token, { issuer, audience, claims, clockTolerance? })`** → `Effect<S["Type"], JwtError, JwksResolver | S["DecodingServices"]>`. It is `Jwt.verify` keyed through `JwksResolver.forIssuer(issuer)`: the signature against the issuer's discovered JWKS, then `exp` (required), `nbf`, `iat`, `iss` and `aud`, then the decode with `claims`. `audience` is a string or an array and is **required and non-empty**; an empty one, or an empty string among several, fails as `wrongAudience` before any network call. Tolerance defaults to 60 seconds.
- **`Oidc.decodeUnverified(token, claims)`** → `Effect<S["Type"], JwtError, S["DecodingServices"]>`. `Jws.decodeUnverified` plus a schema decode, with no signature, issuer, audience or time check. For reading a token a runtime you already trust handed this process; **never for authorizing anything**. Fails `malformed` or `claims`.

Both `Oidc` operations fail with `@effected/jwt`'s `JwtError` and add no error of their own; route on its `reason`.

## Rules the package enforces

- The key is looked up for the **configured** issuer, never the token's own `iss`.
- An OIDC issuer's one key set signs tokens for every relying party, so the audience check is not optional.
- Private claims are not guessed at: pass a schema.

## Usage

```ts
import { JwksResolver, JwksStore } from "@effected/jwt";
import { IdTokenClaims, Oidc } from "@effected/oidc";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const program = Oidc.verify("eyJ...", {
  issuer: "https://accounts.example.com",
  audience: "my-client-id",
  claims: IdTokenClaims,
});

const Live = JwksResolver.layer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, JwksStore.layerMemory)));
export const main = program.pipe(Effect.provide(Live));
```

```ts
// Supplying a token you already hold to something that needs the contract.
import { IdentityToken } from "@effected/oidc";
import { SigstoreSigner } from "@effected/sbom";
import { Layer } from "effect";

const layer = SigstoreSigner.layer.pipe(Layer.provide(IdentityToken.layerStatic(process.env.OIDC_TOKEN ?? "")));
```

## Where it is used

`@effected/sbom`'s `SigstoreSigner` requires `IdentityToken`; `@effected/github-actions` implements it (`ActionsIdentityToken`) and reads its runner token with `Oidc.decodeUnverified`; `@effected/github`'s `ActionsOidc.verify` is `Oidc.verify` pinned to GitHub's issuer, with `ActionsOidcClaims` as the claims schema.

## Not included

Authorization-code or PKCE flows, userinfo and token endpoints, a session or cookie layer, and non-OIDC token formats. Signing and raw JWKS handling are `@effected/jwt`.
