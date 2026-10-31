# @effected/jwt

[![npm](https://img.shields.io/npm/v/@effected%2Fjwt?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/jwt)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

Sign and verify JWTs for Effect v4, and resolve verification keys from an issuer's published key set. A thin layer over core `effect/jose`, which runs every signature, key import and claim check, so it works anywhere WebCrypto does: Node, Bun, Deno, browsers and Cloudflare Workers, with no `node:` import.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on
> stable Effect v4 and still in `0.x` development. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/jwt

Core `effect/jose` already signs and verifies JWS and JWT, imports JWKs and fetches a key set. Use it directly when you verify against a key you already hold, or against one fixed HTTPS JWKS URL (`Jwks.layerRemote`), sign with a PKCS#8 key, or need HMAC or JWE.

Reach for this package when you need what core leaves to you:

- **Keys found by OIDC discovery.** `JwksResolver` finds each issuer's key set from `<issuer>/.well-known/openid-configuration`, checks the discovery document names that issuer exactly, serves many issuers from one service, and refetches once when a token names a rotated `kid`.
- **A cache you choose.** The fetched key sets live in a `JwksStore`: in process with `JwksStore.layerMemory`, or in Workers KV so every isolate shares one fetch.
- **The PEMs people actually have.** `JwtKey.fromPkcs8Pem` takes PKCS#8 and PKCS#1 (`BEGIN RSA PRIVATE KEY`, the format github.com hands out for App keys), including a key whose newlines arrive escaped as `\n` in a one-line environment variable.
- **Safer defaults.** `Jwt.verify` allows 60 seconds of clock skew, requires `exp` unless you opt out, and refuses a token issued in the future. Core's defaults are zero skew and an optional `exp`.
- **One error to route on.** Every failure is a `JwtError` with a flat `reason` string.
- **A test issuer.** `TestIssuer` signs tokens that verify through the real resolver, with no network.

Keys are core's own types, so a key from `JwtKey` also works with core `Jws` and `Jwt` directly.

## Install

```bash
npm install @effected/jwt effect
```

```bash
pnpm add @effected/jwt effect
```

On Node, requires Node.js >=24.11.0; it also runs on any other WebCrypto runtime, Cloudflare Workers included. `effect` v4 is the only peer. All `@effected/*` packages are ESM-only.

## What to provide

Signing and verifying run on core services, which you provide once at your program's edge:

| Operation | Requires |
| --- | --- |
| `Jws.sign`, `Jws.verify`, `Jwt.sign`, `Jwt.verify`, `JwtKey.generate`, `TestIssuer` | `Signature.Signature` |
| `JwksResolver.layer`, `JwksResolver.layerWith` | `HttpClient.HttpClient` and `JwksStore` |
| `Jwt.verify` keyed by `JwksResolver.forIssuer` | `Signature.Signature` and `JwksResolver` |

`JwtKey.fromPkcs8Pem`, `JwtKey.fromJwk` and `Jws.decodeUnverified` need nothing.

| Service | Any WebCrypto runtime (Workers included) | Node |
| --- | --- | --- |
| `Signature.Signature` | `Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto` | `NodeCrypto.layerSignature` from `@effect/platform-node` |
| `HttpClient.HttpClient` | `FetchHttpClient.layer` from `effect/http` | `NodeHttpClient.layerUndici` from `@effect/platform-node`, or `FetchHttpClient.layer` |
| `JwksStore` | `JwksStore.layerMemory`, or your own KV-backed layer | `JwksStore.layerMemory` |

```ts
import { JwksResolver, JwksStore } from "@effected/jwt";
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { FetchHttpClient } from "effect/http";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

const JwtLive = Layer.merge(
  JwksResolver.layer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, JwksStore.layerMemory))),
  CryptoLive,
);
```

## Sign a JWT

A GitHub App JWT from the PKCS#1 key github.com issues. The header is `{"alg":"RS256","typ":"JWT"}`: `alg` always comes from the key.

```ts
import { Jwt, JwtKey } from "@effected/jwt";
import { Effect, Redacted } from "effect";

const signAppJwt = (pem: Redacted.Redacted<string>, appId: string, nowSeconds: number) =>
  Effect.gen(function* () {
    const key = yield* JwtKey.fromPkcs8Pem(pem, { alg: "RS256" });
    return yield* Jwt.sign({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }, key);
  });
```

## Verify against an issuer's published keys

Pass the issuer you expect to `forIssuer`, never one read from the token: the issuer decides which keys are trusted. Always pass `audience` for a shared issuer, whose one key set signs tokens for every relying party.

```ts
import { JwksResolver, Jwt } from "@effected/jwt";
import { Schema } from "effect";

const Claims = Schema.Struct({ sub: Schema.String });

const verify = (token: string) =>
  Jwt.verify(token, {
    key: JwksResolver.forIssuer("https://issuer.example"),
    claims: Claims,
    issuer: "https://issuer.example",
    audience: "my-service",
  });
// Effect<{ readonly sub: string }, JwtError, JwksResolver | Signature>
```

The checks run in this order: the signature, then `exp` present, `iss`, `aud`, `exp` not passed, `nbf` reached, your `claims` schema, and finally `iat` not in the future. `clockTolerance` and `requireExpiry` adjust the defaults.

## Verify with a key you hold

`key` is a `VerificationKey`, or a function from the token's header to one.

```ts
import { Jwk, Jwt, JwtKey } from "@effected/jwt";
import { Effect, Schema } from "effect";

const verifyWith = (jwk: Jwk, token: string) =>
  Effect.gen(function* () {
    const key = yield* JwtKey.fromJwk(jwk);
    return yield* Jwt.verify(token, { key, claims: Schema.Struct({ sub: Schema.String }) });
  });
```

`Jws` is the same signature layer without claim rules (`Jws.sign`, `Jws.verify`), and `Jws.decodeUnverified` reads a token's header and payload as a synchronous `Result`, for routing on `kid` or `iss` before choosing a key. Never trust what it returns.

## Algorithms

Every asymmetric algorithm core implements: `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512` and `EdDSA` (Ed25519). The algorithm comes from the key, never the token's header, and RSA keys under 2048 bits are refused. HMAC is refused, because a key published in a key set must never be used as a shared secret; for HMAC use core's `Jwk.importSecret` with core `Jwt`. `alg: "none"` is never accepted.

## Errors

Every failure is a `JwtError`. Route on `reason`, never on `message` or `detail`; when core produced the failure, its `JoseError` is the `cause`.

| `reason` | Meaning |
| --- | --- |
| `malformed` | Not a compact JWS: wrong segment count, non-canonical base64url, a header that is not a JOSE header, `alg: "none"` or an unknown algorithm, a `crit` or `b64` member, or a payload that is not JSON. |
| `unsupportedAlgorithm` | The token or JWK names an HMAC (or other non-asymmetric) algorithm. No key is resolved. |
| `algorithmMismatch` | The token's `alg` is not the key's algorithm, or a JWK's `alg` differs from the one required. |
| `badSignature` | The signature does not verify. |
| `unknownKid` | No key in the set matches the token's algorithm and `kid`, or several do. |
| `expired` | `exp` has passed, beyond the tolerance. |
| `notYetValid` | `nbf` is in the future, or `iat` is, beyond the tolerance. |
| `wrongIssuer` | `iss` is missing or not an accepted issuer. |
| `wrongAudience` | `aud` is missing or contains no accepted audience. |
| `claims` | A registered claim has the wrong type, `exp` is missing, the payload is not a JSON object, your `claims` schema refused it, or the clock tolerance is invalid. |
| `key` | Key material did not import: a malformed or unsupported PEM, an RSA key under 2048 bits, a JWK whose type, curve, `use` or `key_ops` cannot verify. |
| `jwksFetch` | The key set could not be discovered or fetched: unreachable, slow, oversized, not `https:`, redirected off `https:`, a discovery document naming another issuer, or a set with no supported keys. |

A token string is not an identity: ECDSA signatures are malleable, so one signed payload can have two valid token strings. Detect replay and revoke on verified claims (`jti`, or `iss` with `sub` and `iat`), never on the token text.

## Testing

`@effected/jwt/testing` exports `TestIssuer`: a generated key pair, a signer that stamps `iss`, `iat` and a ten-minute `exp`, and `resolverLayer`, the real `JwksResolver` over an in-memory `HttpClient` serving the issuer's discovery document and key set.

```ts
import { JwksResolver, Jwt } from "@effected/jwt";
import { TestIssuer } from "@effected/jwt/testing";
import { Effect, Schema } from "effect";

const program = Effect.gen(function* () {
  const issuer = yield* TestIssuer.make({ issuer: "https://issuer.test" });
  const token = yield* issuer.sign({ aud: "my-app", sub: "user-1" });
  return yield* Jwt.verify(token, {
    key: JwksResolver.forIssuer("https://issuer.test"),
    claims: Schema.Struct({ sub: Schema.String }),
    issuer: "https://issuer.test",
    audience: "my-app",
  }).pipe(Effect.provide(issuer.resolverLayer));
});
// provide CryptoLive: TestIssuer and Jwt.verify both need Signature
```

Provide `resolverLayer` once around a whole test when it relies on caching or a rotation. `TestIssuer.rotate(issuer, kid)` adds a key under a new `kid`; the resolver still refetches at most once per 30 seconds, so advance the `TestClock` before verifying with the new key. With `@effect/vitest`, provide `Signature` per test (`layer(CryptoLive, { buildPerTest: true })`): a layer built once for a whole block shares one `TestClock` across its tests.

## License

[MIT](LICENSE)
