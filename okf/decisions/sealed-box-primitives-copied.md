---
type: Decision
title: The sealed box's primitives are copied from noble into @effected/github, with no third-party crypto dependency
description: "@effected/github builds the libsodium sealed box from in-house copies of audited @noble code (X25519, HSalsa20 and XSalsa20-Poly1305, BLAKE2b), each with a provenance header in core's style; tweetnacl, blakejs and libsodium-wrappers are devDependencies used only as test oracles, libsodium being the authority. The ephemeral secret comes from globalThis.crypto.getRandomValues, and the modules stay confined to RepositorySecret."
status: stable
x-okfit-supersedes: sealed-box-home.md
tags:
  - architecture
  - security
  - bundle
  - deps
sources:
  - id: issue-1363
    resource: https://github.com/spencerbeggs/effected/issues/1363
    title: "github: copy noble's sealed-box primitives in-house, drop tweetnacl and blakejs"
  - id: github-crypto
    resource: ../../packages/github/src/internal/crypto.ts
    title: "encryptSecret: the only sealed-box call site in the kit"
  - id: core-chacha
    resource: ../../.repos/effect/packages/effect/src/crypto/internal/chacha.ts
    title: "Core's copy of @noble/ciphers, the precedent for the header and the trimming"
verified:
  - by: human:spencer
    at: 2026-11-16T16:59:20Z
  - by: human:spencer
    at: 2026-11-16T18:54:03Z
  - by: human:spencer
    at: 2026-11-25T21:38:57Z
x-okfit-integrity:
  generated:
    body: b1417e0fd29e0783
  verified:
    by: human:spencer
    at: 2026-11-25T21:38:57Z
    content: 733bac9d590e6fc4
generated:
  by: okfit/claude-code
  at: 2026-11-16T17:04:15Z
---

# The sealed box's primitives are copied from noble into `@effected/github`

## Context

[The previous decision](sealed-box-home.md) kept the sealed box in `@effected/github` on `tweetnacl` and `blakejs`, and declined an in-house port because the only adequate cross-check was libsodium, which would re-enter the kit as a test dependency. Two things changed. Both libraries are unmaintained CommonJS leaves, and `blakejs` needed a default-import workaround because Node's `cjs-module-lexer` detects only part of its export surface. And Effect core copied noble code in house with a provenance header (`chacha.ts` from `@noble/ciphers`, `md5.ts` from `@noble/hashes`), which is a proven shape for taking audited arithmetic without a dependency edge.[^core-chacha] Core ships neither XSalsa20-Poly1305 nor BLAKE2b, and its `KeyAgreement.x25519` draws the ephemeral key from a swappable `SecureRandom`, so nothing in core can be reused.[^issue-1363]

## Decision

`packages/github/src/internal/` holds three copied modules, each with a header naming the upstream repository, version, commit, files taken, every change and the full MIT licence: `xsalsa20poly1305.ts` (HSalsa20, XSalsa20 and Poly1305, from `@noble/ciphers` 2.4.0), `blake2b.ts` (variable-length BLAKE2b, from `@noble/hashes` 2.4.0) and `x25519.ts` (the Montgomery ladder and scalar clamping, from `@noble/curves` 2.4.0). They are trimmed to one-shot functions; the arithmetic and cipher cores are unchanged. `encryptSecret` composes them, keeps its synchronous `Result` signature, and now also fails typed on a recipient key that is not 32 bytes or is a low-order point.[^github-crypto]

The ephemeral secret key comes from `globalThis.crypto.getRandomValues`, not from core `SecureRandom`: a secret key must not depend on a swappable service. No module in the graph imports a builtin, so it runs on workerd.

`tweetnacl` and `blakejs` move to `devDependencies` and are test oracles only: differential tests on random inputs, and opening the sealed box with `nacl.box.open`. `libsodium-wrappers` joins them as the authoritative oracle, the cross-check the previous decision required: `crypto_box_seal_open` opens what `encryptSecret` seals, and `crypto_generichash` (every output length, including the 24-byte nonce, which has no published vector), `crypto_scalarmult` and `crypto_box_easy` match the copied primitives on random inputs (`__test__/crypto.libsodium.test.ts`). The vectors that pin the copies are RFC 7693 (BLAKE2b), RFC 7748 §5.2 and §6.1 (X25519) and NaCl's `box.c` `crypto_box` vector. The reachability test confines the three modules and `crypto.ts` to `RepositorySecret` and asserts no runtime import of either oracle.

## Alternatives rejected

- **Keep `tweetnacl` and `blakejs` as runtime dependencies.** Unmaintained, CommonJS-only, and the source of the `blakejs` default-import trap. The oracle role costs nothing at runtime.
- **Depend on `@noble/*`.** Trades two runtime dependencies for three, and `@noble/curves` pulls far more than the one ladder this needs.
- **A shared package for the primitives.** Still premature with one caller; the revisit trigger below stands.

## Consequences

- `@effected/github` has no third-party crypto dependency; its non-octokit runtime dependencies are `@effected/*` edges only.
- The copies are the kit's to maintain. A fix upstream does not arrive by upgrade: re-copy against the new commit and update the header.
- Differential tests against libsodium, `tweetnacl` and `blakejs` are the standing guard against a mis-copy, so the oracles must stay in `devDependencies`.

## Revisit trigger

A second consumer that needs a sealed box, `open`, or BLAKE2b outside `@effected/github`. The home is then a new package carrying these copies, never a subpath of `@effected/crypto`, whose boundary tier does not change.

[^issue-1363]: <https://github.com/spencerbeggs/effected/issues/1363>
[^github-crypto]: `../../packages/github/src/internal/crypto.ts`
[^core-chacha]: `.repos/effect/packages/effect/src/crypto/internal/chacha.ts`
