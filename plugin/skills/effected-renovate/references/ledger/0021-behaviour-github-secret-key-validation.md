---
id: "0021"
title: "@effected/github RepositorySecret: a malformed or low-order secrets public key fails as a decode GitHubError instead of a defect"
kind: behaviour
shows: behavioural
applies:
  "@effected/github": ">=0.33.0"
detect: ["RepositorySecret", "catchAllDefect", "catchDefect", "not valid base64"]
closes: ["1363"]
changesets: ["github-sealed-box-noble-copies"]
---

`RepositorySecret` now seals secrets with in-house copies of the libsodium primitives instead of `tweetnacl` and `blakejs`. The sealed box GitHub receives is unchanged.

- A secrets public key that is not 32 bytes, or is a low-order X25519 point, now fails as a `GitHubError` of the decode kind. Before, a wrong-length key died as a defect and a low-order key was used unchecked. Where a hit catches a defect around a `RepositorySecret` call, move that handling to the typed error channel.
- The failure message no longer says "not valid base64". Update any test or log match that pinned that text.
- If the consumer itself depends on `tweetnacl` or `blakejs` only because the kit once did, it can drop them.

Check the installed `.d.ts` for the `GitHubError` constructors before matching on them.
