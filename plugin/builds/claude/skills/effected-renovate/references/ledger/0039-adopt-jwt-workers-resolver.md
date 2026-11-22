---
id: "0039"
title: "@effected/jwt: JwksResolver.layerUncoalesced for Cloudflare Workers, TestIssuer resolver options, JwtKey.verificationOf"
kind: adopt
shows: none
applies:
  "@effected/jwt": ">=0.11.0"
detect: ["JwksResolver\\.layer([^A-Za-z]|$)", "TestIssuer\\.make", "exportPrivate"]
changesets: ["jwt-uncoalesced-resolver"]
---

Offer these to the user; apply the first without asking only where the repository runs on Cloudflare Workers.

- **On Cloudflare Workers, a `JwksResolver` shared between requests must be `JwksResolver.layerUncoalesced`** (the same as `layerWith({ coalesce: false })`). The default `JwksResolver.layer` coalesces concurrent misses for one issuer behind a lock, so one request waits on another's fetch. workerd cancels that waiter as hung, and a cancelled waiter that was handed the lock never releases it, so every later refetch for that issuer in the isolate hangs. Two concurrent requests carrying an unknown `kid` are enough to trigger it. A repository that worked around it by building the resolver per request can share one `layerUncoalesced` over its `JwksStore` again. On Node, the default stays right.
- **`TestIssuer.make({ issuer, resolver: { coalesce: false } })`** builds its `resolverLayer` with those `JwksResolverOptions`, so a Workers repository's Node tests run the resolver mode production runs.
- **`JwtKey.verificationOf(signing)`** derives the `VerificationKey` for a `SigningKey`. It replaces exporting the private key through core `effect/jose`'s `Jwk.exportPrivate` and re-importing its public members by hand.

Most `JwksResolver.layer` hits are on Node and need nothing: read each before proposing a change. Check the installed `@effected/jwt` `.d.ts` for the shapes.
