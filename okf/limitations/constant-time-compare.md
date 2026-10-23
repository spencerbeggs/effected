---
type: Limitation
title: ConstantTime.equal is best-effort constant time
description: "WebCrypto has no timingSafeEqual, so @effected/crypto compares with a JavaScript XOR loop whose timing the JIT does not guarantee; secretsEqual blinds both sides with a keyed MAC first to bound what leaks."
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
  at: 2026-10-23T01:39:30Z
integrity:
  generated:
    body: 9a03d8999091b5ee
---

# ConstantTime.equal is best-effort constant time

## Condition

Any comparison made through [`@effected/crypto`](../modules/crypto.md)'s `ConstantTime.equal`, including every `Hmac.verify` and every [`webhooks`](../modules/webhooks.md) preset.

## Symptom

None observable in normal use. The guarantee is weaker than `node:crypto`'s `timingSafeEqual`: the loop visits every byte and never returns early on a mismatch, but a JavaScript engine is free to optimize it, so the timing is not contractually independent of the inputs. A length mismatch returns `false` immediately, which reveals the length.

## Why it is acceptable

WebCrypto offers no constant-time comparison, and the package must run where `node:crypto` does not. This is the standard approach in WebCrypto-only libraries. The exposure is narrow: an HMAC comparison is over a fixed-length digest, so the length leak reveals nothing, and a shared secret goes through `ConstantTime.secretsEqual`, which MACs both sides under a fresh random WebCrypto key first, so only two 32-byte MACs reach the loop and neither length nor prefix of the secret does.[^owner]

## What a fix would take

A runtime-native constant-time primitive in WebCrypto or in core `Crypto`. Until then, a Node-only caller wanting the stronger guarantee can compare with `node:crypto` itself.

[^owner]: conversation with the repository owner
