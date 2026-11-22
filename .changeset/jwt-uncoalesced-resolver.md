---
"@effected/jwt": minor
---

## Features

* `JwksResolver.layerWith({ coalesce: false })` builds a resolver that is safe to share between requests on Cloudflare Workers. The default resolver coalesces concurrent misses for one issuer behind a lock, so one request waits on another's fetch; workerd cancels that waiter as hung, and a cancelled waiter that was handed the lock never released it, so every later refetch for that issuer in the isolate hung too. Uncoalesced, no caller ever waits on another: each miss fetches for itself, a caller with no usable key set always fetches, the refetch interval only answers an unknown-`kid` refetch with `unknownKid` once a set is held, and of overlapping fetches the one that started last is kept, in the resolver and in the `JwksStore`, even within one millisecond. Every caller selects its key from the newest set held, so a key a newer set dropped never resolves from an older fetch that finished last. The default stays coalesced
* `JwtKey.verificationOf(signing)` derives the `VerificationKey` for a `SigningKey`, under the same algorithm and `kid`, for a service that signs and verifies its own tokens from one private key

## Bug Fixes

* `JwksResolver` writes a fetched set to the `JwksStore` only when it is the newest the resolver holds, and never over a newer set already in the store, so a store shared by several isolates (KV on Workers) is not rolled back to an older key set that refuses a rotated `kid`. The store has no conditional write, so two isolates writing at once can still race; the TTL bounds how long that lasts

## Documentation

* `JwksResolver.layer`, `layerWith`, `fetchTimeout` and `JwksStore` say that on Workers the resolver shared between requests must be uncoalesced, and that an uncoalesced fetch's timeout timer is always the calling request's own
