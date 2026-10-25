---
type: Decision
title: The libsodium sealed box stays in @effected/github until a second consumer appears
description: "tweetnacl and blakejs remain a private leaf of @effected/github, confined to RepositorySecret; they do not move into @effected/crypto, which would turn the boundary crypto package and every package over it integrated under the dependency policy, and the primitives are not ported in house. The revisit trigger is a second consumer that seals or opens a box, or needs BLAKE2b, outside github; when it fires, the home is a new integrated package, never a subpath of crypto."
status: stable
tags:
  - architecture
  - security
  - bundle
sources:
  - id: issue-1043
    resource: https://github.com/spencerbeggs/effected/issues/1043
    title: "crypto: explore an Effect-native home for tweetnacl and blakejs (libsodium sealed box)"
  - id: github-crypto
    resource: ../../packages/github/src/internal/crypto.ts
    title: "encryptSecret: the only sealed-box call site in the kit"
  - id: github-manifest
    resource: ../../packages/github/package.json
    title: "github's runtime dependencies: octokit, four @effected edges, blakejs 1.2.1 and tweetnacl 1.0.3"
  - id: crypto-manifest
    resource: ../../packages/crypto/package.json
    title: "crypto's manifest: effect as its only peer, no runtime dependencies, one root entrypoint"
  - id: core-crypto
    resource: ../../.repos/effect/packages/effect/src/Crypto.ts
    title: "Core Crypto: randomBytes and a one-shot digest, nothing keyed and no X25519, XSalsa20-Poly1305 or BLAKE2b"
generated:
  by: "okfit/claude-code"
  at: 2026-10-24T00:28:31Z
integrity:
  generated:
    body: 340f3a1159317921
  verified:
    by: human:spencer
    at: 2026-10-25T20:04:29Z
    content: 63e16801a0f2a424
verified:
  - by: human:spencer
    at: 2026-10-25T20:04:29Z
---

# The libsodium sealed box stays in `@effected/github` until a second consumer appears

## Context

GitHub's secrets API accepts a secret only as a libsodium sealed box: X25519 plus XSalsa20-Poly1305 under an ephemeral keypair, with the nonce derived as `blake2b(ephemeral_pk ‖ recipient_pk, 24)`. The kit builds that box in one place, `encryptSecret` in [`@effected/github`](../modules/github.md), on `tweetnacl` for the box and `blakejs` for the nonce.[^github-crypto] The module imports no builtin, so it runs on workerd as well as Node; a malformed public key fails as a typed `Result`; and `github`'s reachability test pins both libraries to `RepositorySecret`, so no other consumer of the package links them.[^github-manifest]

WebCrypto offers X25519 on some runtimes, but no XSalsa20-Poly1305 and no BLAKE2b, and core `Crypto` offers random bytes and a one-shot digest, nothing keyed.[^core-crypto] So no Effect-native backend exists for two of the three primitives, and an "Effect-native home" can only mean wrapping the same two libraries somewhere else, or writing the primitives by hand. This decision settles the sealed-box half of the question that opened when [`crypto`](../modules/crypto.md) was carved out: whether the pair belongs there.[^issue-1043]

## Decision

The sealed box stays where it is: a private leaf of `@effected/github`, reachable only from `RepositorySecret`, built on `tweetnacl` and `blakejs`. Nothing is exported, no subpath is added, and `@effected/crypto` takes no runtime dependency.

The deciding evidence is the dependency policy, not taste. [R1](../conventions/dependency-policy.md#r1-tiers-1-and-2-take-no-external-runtime-dependencies) makes a package with an external runtime dependency integrated whatever its own imports say, and [R2](../conventions/dependency-policy.md#r2-tier-3-propagates) propagates that tier through every `@effected/*` edge. `crypto` is boundary with `effect` as its only peer,[^crypto-manifest] and [`webhooks`](../modules/webhooks.md), which is boundary, and [`github-actions`](../modules/github-actions.md) both depend on it. Adding `tweetnacl` and `blakejs` to `crypto`, even behind a subpath no root consumer links, retiers `crypto` to integrated and drags `webhooks` with it, because tier is read from the manifest graph rather than from what a bundler happens to drop. A Workers webhook handler would then carry two cryptographic libraries it never calls on its install bill. `github` is already integrated for octokit, so the pair costs it nothing in tier, and the one consumer that needs a sealed box, `reposets`, already depends on `github` for the resource services that send the box.

## Alternatives rejected

- **A `SealedBox.seal` / `SealedBox.open` wrapper under `@effected/crypto/sealed-box`.** Tree-shaking would keep the root entrypoint clean, but the tier would not survive: R1 and R2 are manifest rules, so the subpath buys bundle hygiene and loses the boundary tier of `crypto` and `webhooks`. It would also be a wrapper with one caller, and `open` has no caller at all. Its two sub-questions fall with it, and would be answered the same way in any home. Drawing the ephemeral key from core `Crypto.randomBytes` would make a secret key depend on a swappable service, the footgun [the backend decision](crypto-backends.md) already names for nonces, and a deterministic key buys no test the current suite lacks: it opens the box with the recipient's secret key, a stronger oracle than a fixed vector. Using WebCrypto X25519 where present would put a runtime branch in a path whose failure mode is a box GitHub accepts and cannot decrypt, for no gain over the audited pure-JavaScript implementation.
- **Pure-Effect ports of the primitives.** A stream cipher, a Poly1305 MAC and BLAKE2b written in house, replacing two small, audited libraries. The failure is silent: a subtle bug produces a box GitHub stores and a workflow later reads as a corrupt secret. The only adequate cross-check is libsodium itself, which would re-enter the kit as a test dependency. Nothing forces this cost, so it is declined.
- **A new `@effected/sealed-box` package today.** The right shape for a second consumer, premature for one: it would be an integrated package with a single internal caller, and `github` would gain a dependency edge in exchange for moving one internal module.

## Consequences

- `@effected/github` keeps `tweetnacl` and `blakejs` as regular dependencies, the reachability test keeps confining them to `RepositorySecret`, and the default-import rule for `blakejs` stays in `internal/crypto.ts` with the test that pins Node's detected export set.
- `@effected/crypto` stays boundary with no runtime dependency, which is what keeps `webhooks` boundary and workerd-deployable at no install cost.
- The kit exposes no `open`. A caller that needs to decrypt a sealed box is, by definition, the revisit trigger below.
- `node:crypto` remains not an alternative for this leaf: Node ships neither `crypto_box` nor BLAKE2b.

## Revisit trigger

A second consumer that needs a sealed box, or BLAKE2b, outside `@effected/github`: a Worker or action setting secrets for something other than GitHub's API, or any need to open a box. When that happens, the home is a new integrated-tier package (a `sealed-box` or `nacl` library carrying `tweetnacl` and `blakejs`) that `github` then depends on. It is never a subpath of `@effected/crypto`, for the tier reason above, and it is never a hand-written port without libsodium test vectors and a libsodium cross-check.

[^issue-1043]: <https://github.com/spencerbeggs/effected/issues/1043>
[^github-crypto]: `../../packages/github/src/internal/crypto.ts`
[^github-manifest]: `../../packages/github/package.json`
[^crypto-manifest]: `../../packages/crypto/package.json`
[^core-crypto]: `../../.repos/effect/packages/effect/src/Crypto.ts`
