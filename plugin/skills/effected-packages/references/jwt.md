# @effected/jwt

Sign and verify compact JWS tokens, validate JWT claims, import keys, and resolve verification keys from an issuer's JWKS. A thin layer over core `effect/jose`, which does every signature, key import and claim check, so it runs anywhere WebCrypto does: Node, browsers and Cloudflare workerd. Boundary tier: no `node:` import, `@effected/crypto` as its only runtime dependency, and `effect` is the only peer.

**Reach for core `effect/jose` directly** when you verify against a key you already hold or one fixed HTTPS JWKS URL (`Jwks.layerRemote`), sign with a PKCS#8 key, or need HMAC or JWE. Reach for this package when you need what core lacks: OIDC discovery across issuers with a pluggable (KV-backable) cache, PKCS#1 GitHub App keys or one-line PEMs, the safer verification defaults below, or `TestIssuer`.

## Import

```ts
import { Jwk, Jwks, JwksResolver, JwksStore, Jws, Jwt, JwtError, JwtKey, RegisteredClaims } from "@effected/jwt";
import { TestIssuer } from "@effected/jwt/testing";
```

**Requirements**: signing and verifying (`Jws.sign`/`verify`, `Jwt.sign`/`verify`, `JwtKey.generate`, `TestIssuer`) require core's `Signature` service in `R`. Provide it once at the edge: `Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto`. Key import needs no service. For `JwksResolver`, also provide an `HttpClient` (for example `FetchHttpClient.layer`) and `JwksStore.layerMemory`, or a KV-backed store on a Worker.

## Core API

- **`JwtKey`** — the importers. `fromPkcs8Pem(pem: Redacted<string>, { alg, kid? })` imports a private key as a `SigningKey`: PKCS#8 for any algorithm, and PKCS#1 (`BEGIN RSA PRIVATE KEY`, what github.com hands out for App keys) for `RS*`/`PS*`, converted by core in-process so it imports on workerd too. A key whose newlines arrive escaped as `\n` (a one-line environment variable) is accepted. RSA under 2048 bits, a wrong key type or an unreadable body is `key`. `fromJwk(jwk, { alg? })` imports the public half of a JWK as a `VerificationKey`. `generate(alg, { kid? })` makes a pair plus its public `Jwk`, for tests.
- **`SigningKey` / `VerificationKey`** are core's `Jwk.PrivateKey` / `Jwk.PublicKey` (fields `algorithm`, `kid`, `key`), so they work with core `Jws`/`Jwt` too.
- **`Jwt.sign(claims, key, header?)`** → `Effect<string, JwtError, Signature>`; the header's `alg` (and `kid`, when the key has one) come from the key, `typ` defaults to `JWT`, and claims keep their key order.
- **`Jwt.verify(token, { key, claims, issuer?, audience?, clockTolerance?, requireExpiry? })`** → `Effect<S["Type"], JwtError, R | Signature>`. Checks the signature, then `exp` presence (required by default), `iss`, `aud` (an array containing the expected audience is accepted), `exp`, `nbf`, decodes the payload with your `claims` schema, and finally refuses a future `iat`. `key` is a `VerificationKey` or a function from the decoded header to one, such as `JwksResolver.forIssuer(issuer)`. Time is `Clock`'s, so `TestClock` drives it; tolerance defaults to 60 seconds. Always pass `audience` for a shared issuer such as GitHub Actions OIDC, whose one JWKS signs tokens for every relying party.
- **`Jws`** — the signature layer without claim rules: `Jws.sign(payload, key, header?)`, `Jws.verify(token, key)` → `{ header, payload }`, and `Jws.decodeUnverified(token)` (a sync `Result` whose payload must be a JSON object, for routing on `kid`/`iss` before choosing a key — never trust what it returns).
- **`JwksResolver`** — `layer` (discovery from `<issuer>/.well-known/openid-configuration`, a 1 hour TTL, a 30 second refetch interval) or `layerWith({ ttl, minRefetchInterval, fetchTimeout, jwksUri })`. A `kid` missing from the cached set triggers one refetch, at most once per interval per issuer, so a rotation is picked up and a flood of made-up `kid`s is not. Issuers and JWKS URLs must be `https:` (localhost `http:` excepted). **Pass the issuer you expect to `forIssuer`, never one read from the token.**
- **`JwksStore`** — the cache seam (`get`/`set` with a TTL); `layerMemory` keeps it in process. A store's own failures never fail a verification.
- **`JwtError`** — one tagged error; route on `reason`, never on `message` or `detail`: `malformed`, `unsupportedAlgorithm`, `algorithmMismatch`, `badSignature`, `unknownKid`, `expired`, `notYetValid`, `wrongIssuer`, `wrongAudience`, `claims`, `key`, `jwksFetch`. Core's `JoseError` rides on `cause`.
- **`Jwk`, `Jwks`, `JoseHeader`, `RegisteredClaims`** — the schemas, decodable from the wire. Private JWK members decode to `Redacted`.

## Rules the package enforces

- Every asymmetric algorithm core implements: `RS256`-`RS512`, `PS256`-`PS512`, `ES256`-`ES512`, `EdDSA` (Ed25519). HMAC is `unsupportedAlgorithm`; `alg: "none"` and any unknown algorithm are `malformed`. Neither resolves a key.
- The algorithm comes from the **key**, never the token header: a header `alg` that differs from the key's is `algorithmMismatch` and no other algorithm is attempted (an `HS256` token against an RSA key cannot be confused into HMAC).
- Private key material stays `Redacted`; it is unwrapped only at the import call, and no error echoes key bytes.
- A token string is not an identity: ECDSA signatures are malleable. Key replay detection or revocation on verified claims (`jti`, or `iss` + `sub` + `iat`), never on token text.

## Usage

```ts
import { Jwt, JwtKey, JwksResolver, JwksStore } from "@effected/jwt";
import { Effect, Layer, Redacted, Schema } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { FetchHttpClient } from "effect/http";

// Sign: a GitHub App JWT from a PKCS#1 key.
const sign = (pem: Redacted.Redacted<string>, appId: string, nowSeconds: number) =>
  Effect.flatMap(JwtKey.fromPkcs8Pem(pem, { alg: "RS256" }), (key) =>
    Jwt.sign({ iss: appId, iat: nowSeconds - 60, exp: nowSeconds + 540 }, key),
  );

// Verify against an issuer's published keys.
const Claims = Schema.Struct({ sub: Schema.String });
const verify = (token: string) =>
  Jwt.verify(token, {
    key: JwksResolver.forIssuer("https://issuer.example"),
    claims: Claims,
    issuer: "https://issuer.example",
    audience: "my-service",
  });

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));
const Live = Layer.merge(
  JwksResolver.layer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, JwksStore.layerMemory))),
  CryptoLive,
);
```

## Testing

`@effected/jwt/testing` exports `TestIssuer.make({ issuer, alg?, kid? })` (requires `Signature`): a generated key pair, `sign(claims)` (stamps `iss`, `iat` and a ten-minute `exp` from `Clock` unless given), and `resolverLayer`, the real `JwksResolver` over an in-memory `HttpClient` serving the issuer's discovery document and JWKS. Provide `resolverLayer` once around the whole test when it relies on caching or a rotation. Provide `Signature` per test (`layer(CryptoLive, { buildPerTest: true })` in `@effect/vitest`): a block-level `layer` shares one `TestClock` across its tests. `TestIssuer.rotate(issuer, kid)` adds a key under a new `kid`; the resolver's refetch interval still applies, so advance the `TestClock` before verifying with it.

## Where it is used

`@effected/github` signs its App JWT with `JwtKey.fromPkcs8Pem` + `Jwt.sign`, and `ActionsOidc.verify` verifies GitHub Actions OIDC tokens through `Jwt.verify` and `JwksResolver.forIssuer`. Reach for those first when the token is GitHub's. `@effected/oidc` builds its `Oidc.verify` on `Jwt.verify` and `JwksResolver.forIssuer`; reach for it for an OIDC ID token from any issuer.

## Not included

HMAC (`HS*`), encrypted tokens (JWE) and private-key JWK import for signing — use core `effect/jose` (`Jwk.importSecret`, `Jwe`, `Jwk.importPrivate`) for those.
