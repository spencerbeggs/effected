---
type: Limitation
title: ConstantTime.equal is best-effort constant time
description: "@effected/crypto compares through core Mac.timingSafeEqual, a JavaScript XOR loop whose timing the JIT does not guarantee; secretsEqual blinds both sides with a keyed MAC first to bound what leaks."
status: draft
bounds: ../modules/crypto.md
tags:
  - security
  - compat
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-22T00:00:00Z
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-31T19:37:34Z
integrity:
  generated:
    body: 462ca42ea3313596
---

# ConstantTime.equal is best-effort constant time

## Condition

Any comparison made through [`@effected/crypto`](../modules/crypto.md)'s `ConstantTime.equal` (core's `Mac.timingSafeEqual` over UTF-8 bytes), and every `Hmac.verify` and [`webhooks`](../modules/webhooks.md) preset, which compare through core `Mac.verify`. On `Mac.layerWebCrypto` that verify is WebCrypto's own `subtle.verify`; on `NodeCrypto.layerMac` it is `Mac.timingSafeEqual` over the computed tag.

## Symptom

None observable in normal use. The guarantee is weaker than `node:crypto`'s `timingSafeEqual`: the loop visits every byte and never returns early on a mismatch, but a JavaScript engine is free to optimize it, so the timing is not contractually independent of the inputs. A length mismatch returns `false` immediately, which reveals the length.

## Why it is acceptable

WebCrypto offers no general constant-time comparison, and the package must run where `node:crypto` does not. The kit no longer carries a loop of its own: it uses core's, which is the standard approach in WebCrypto-only libraries. The exposure is narrow: an HMAC comparison is over a fixed-length tag, so the length leak reveals nothing, and a shared secret goes through `ConstantTime.secretsEqual`, which MACs the expected side under a fresh key from `Mac.generateKey` and checks the received side with `Mac.verify`, so only two 32-byte MACs are compared and neither length nor prefix of the secret is.[^owner]

## What a fix would take

A runtime-native constant-time primitive in WebCrypto or in core. Core's `Mac.timingSafeEqual` (`effect/crypto`), which the kit now uses, is not one: it is an XOR-accumulate loop, returns early on a length mismatch, and documents that JavaScript runtimes do not guarantee constant-time execution. If core ever backs it with a native primitive, the kit inherits that with no change. Until then, a Node-only caller wanting the stronger guarantee can compare with `node:crypto` itself.

[^owner]: conversation with the repository owner
