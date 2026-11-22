---
"@effected/jwt": minor
---

## Features

* `JwksResolver.layerWith({ coalesce: false })` builds a resolver that is safe to share between requests on Cloudflare Workers. The default resolver coalesces concurrent misses for one issuer behind a lock, so one request waits on another's fetch; workerd cancels that waiter as hung, and a cancelled waiter that was handed the lock never released it, so every later refetch for that issuer in the isolate hung too. Uncoalesced, no caller ever waits on another: each miss fetches for itself, a caller with no usable key set always fetches, the refetch interval only answers an unknown-`kid` refetch with `unknownKid` once a set is held, and an older fetch finishing last never replaces a newer one. The default stays coalesced
* `JwtKey.verificationOf(signing)` derives the `VerificationKey` for a `SigningKey`, under the same algorithm and `kid`, for a service that signs and verifies its own tokens from one private key

## Documentation

* `JwksResolver.layer`, `layerWith`, `fetchTimeout` and `JwksStore` say that on Workers the resolver shared between requests must be uncoalesced, and that an uncoalesced fetch's timeout timer is always the calling request's own
