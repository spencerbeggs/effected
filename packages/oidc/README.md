# @effected/oidc

[![npm](https://img.shields.io/npm/v/@effected%2Foidc?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/oidc)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

OpenID Connect for Effect v4: verify an ID token against its issuer's discovered keys, read the standard ID-token claims, and ask for a workload identity token through one small contract that any runtime can serve. It runs anywhere WebCrypto does, Cloudflare Workers included, with no `node:` import.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on
> stable Effect v4 and still in `0.x` development. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/oidc

Verifying an OIDC ID token is a JWT verification with three rules that are easy to get wrong: the keys come from the issuer's discovery document, the issuer you trust is the one you configured rather than the one the token claims, and the audience must always be checked, because an issuer's one key set signs tokens for every relying party. `Oidc.verify` holds all three: it looks keys up for the configured issuer only, and it refuses an empty audience before making any request.

The signature and claim checks run on core `effect/jose`, through [`@effected/jwt`](https://www.npmjs.com/package/@effected/jwt)'s discovery-backed `JwksResolver`. If you hold the issuer's key, or its JWKS URL is fixed in your configuration, core `effect/jose` (`Jwt.verify` with `Jwks.layerRemote`) does the job without this package. Reach for `Oidc.verify` when the keys are found by discovery, when you want `@effected/jwt`'s safer defaults (60 seconds of clock skew, `exp` required), or when you want `IdTokenClaims` and the `IdentityToken` contract.

For a GitHub Actions OIDC token, use `ActionsOidc.verify` from [`@effected/github`](https://www.npmjs.com/package/@effected/github), which is `Oidc.verify` pinned to GitHub's issuer with typed claims.

## Install

```bash
npm install @effected/oidc effect
```

```bash
pnpm add @effected/oidc effect
```

On Node, requires Node.js >=24.11.0; it also runs on any other WebCrypto runtime, Cloudflare Workers included. `effect` v4 is the only peer, and `@effected/jwt` comes with it. Import `JwksResolver` and `JwksStore` from `@effected/jwt`. All `@effected/*` packages are ESM-only.

## What to provide

| Operation | Requires |
| --- | --- |
| `Oidc.verify` | `JwksResolver` (from `@effected/jwt`) and `Signature.Signature` (from `effect/crypto`) |
| `Oidc.decodeUnverified` | nothing |
| a program using `IdentityToken` | an `IdentityToken` layer (below) |

| Service | Any WebCrypto runtime (Workers included) | Node |
| --- | --- | --- |
| `Signature.Signature` | `Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` | `NodeCrypto.layerSignature` from `@effect/platform-node` |
| `JwksResolver` | `JwksResolver.layer`, over an `HttpClient` (`FetchHttpClient.layer`) and a `JwksStore` (`JwksStore.layerMemory`, or a KV-backed store) | the same, or `NodeHttpClient.layerUndici` for the client |
| `IdentityToken` | `IdentityToken.layerStatic(token)`; in GitHub Actions, `ActionsIdentityToken.layer` from `@effected/github-actions` | the same |

```ts
import { JwksResolver, JwksStore } from "@effected/jwt";
import { Layer } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { FetchHttpClient } from "effect/http";

const OidcLive = Layer.merge(
  JwksResolver.layer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, JwksStore.layerMemory))),
  Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);
```

## Verify an ID token

```ts
import { IdTokenClaims, Oidc } from "@effected/oidc";

const verifyIdToken = (token: string) =>
  Oidc.verify(token, {
    issuer: "https://accounts.example.com",
    audience: "my-client-id",
    claims: IdTokenClaims,
  });
// Effect<IdTokenClaims, JwtError, JwksResolver | Signature>
```

The keys are discovered from `<issuer>/.well-known/openid-configuration`, and the discovery document must name that issuer exactly. Then come the signature, `exp` (required), `iss` (must equal `issuer`), `aud` (must contain one of `audience`, which may be a list), `nbf`, your `claims` schema, and `iat` not in the future, with 60 seconds of clock skew allowed (`clockTolerance` changes it).

## The ID-token claims

`IdTokenClaims` is the registered JWT claims (`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`) plus the OpenID Connect ID-token claims `azp`, `nonce`, `auth_time`, `acr` and `amr`. Every claim is optional, so it decodes any provider's token, and the schema is open, so claims it does not name survive the decode. Optional in the schema does not mean optional in a verified token: `Oidc.verify` still requires `exp` and checks `iss` and `aud`.

A provider's own claims belong in your own schema, built on `IdTokenClaims`'s fields:

```ts
import { IdTokenClaims, Oidc } from "@effected/oidc";
import { Schema } from "effect";

const GoogleClaims = Schema.StructWithRest(
  Schema.Struct({
    ...IdTokenClaims.schema.fields,
    email: Schema.String,
    email_verified: Schema.Boolean,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

const verifyGoogle = (token: string) =>
  Oidc.verify(token, { issuer: "https://accounts.google.com", audience: "my-client-id", claims: GoogleClaims });
```

`Oidc.decodeUnverified(token, claims)` decodes a token's payload with a schema **without verifying anything**. It is for reading a token your process was handed by a runtime it already trusts, never for authorizing a request.

## The `IdentityToken` contract

`IdentityToken` is the other direction: a program that needs to *present* a workload identity (to exchange it for a signing certificate, say) asks for one token for one audience, and the runtime decides how to get it.

```ts
import { IdentityToken } from "@effected/oidc";
import { Effect, Redacted } from "effect";

const presentIdentity = Effect.gen(function* () {
  const identity = yield* IdentityToken;
  const token = yield* identity.token("https://my-service.example");
  return Redacted.value(token);
});

// A token you already hold. The audience is ignored: mint it for the audience it will be used with.
const program = presentIdentity.pipe(Effect.provide(IdentityToken.layerStatic(process.env.OIDC_TOKEN ?? "")));
```

In GitHub Actions, provide `ActionsIdentityToken.layer` from `@effected/github-actions`, which asks the runner's token service. `IdentityToken` itself imports nothing but `effect`, so a package that only needs the contract links no JWT code.

## Errors

`Oidc.verify` and `Oidc.decodeUnverified` fail with `@effected/jwt`'s `JwtError` and add no error of their own. Route on `reason`:

| `reason` | Meaning |
| --- | --- |
| `wrongAudience` | `aud` contains none of the accepted audiences, or is missing; also an empty `audience` option, refused before any request. |
| `wrongIssuer` | `iss` is missing or is not the configured issuer. |
| `expired` / `notYetValid` | `exp` has passed, or `nbf` or `iat` is in the future, beyond the clock tolerance. |
| `claims` | `exp` is missing, a registered claim has the wrong type, or your `claims` schema refused the payload. |
| `badSignature` | The signature does not verify against the issuer's key. |
| `unknownKid` | The issuer's key set has no key for the token's algorithm and `kid`, even after one refetch. |
| `jwksFetch` | The discovery document or key set could not be fetched, was not `https:`, or named another issuer. |
| `malformed` | Not a compact JWS with a JSON-object payload, or `alg: "none"`. |
| `unsupportedAlgorithm` / `algorithmMismatch` / `key` | An HMAC algorithm, an `alg` that is not the key's, or a published key that will not import. |

`IdentityToken.token` fails with `IdentityTokenError`, carrying the `audience` the token was requested for and the underlying `cause`.

## Testing

`IdentityToken.layerTest()` answers every request with a fixed test token; pass `{ token }` to answer differently. To test `Oidc.verify`, sign with `TestIssuer` from `@effected/jwt/testing` and provide its `resolverLayer`, the real resolver over an in-memory issuer:

```ts
import { TestIssuer } from "@effected/jwt/testing";
import { IdTokenClaims, Oidc } from "@effected/oidc";
import { Effect } from "effect";

const test = Effect.gen(function* () {
  const issuer = yield* TestIssuer.make({ issuer: "https://accounts.example.com" });
  const token = yield* issuer.sign({ aud: "my-client-id", sub: "user-1" });
  return yield* Oidc.verify(token, {
    issuer: "https://accounts.example.com",
    audience: "my-client-id",
    claims: IdTokenClaims,
  }).pipe(Effect.provide(issuer.resolverLayer));
});
// provide Signature (see "What to provide") around the test
```

## License

[MIT](LICENSE)
