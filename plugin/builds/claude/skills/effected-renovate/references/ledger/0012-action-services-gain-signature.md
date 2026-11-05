---
id: "0012"
title: "ActionServices gains Signature: drop hand-wired NodeCrypto.layerSignature around GitHubApp.layer"
kind: breaking
shows: typed
applies:
  "@effected/github-actions": ">=0.32.0"
detect: ["layerSignature", "ActionServices"]
changesets: ["github-actions-signature-service"]
---

The Action runtime now provides the `Signature` service, so `GitHubApp.layer` typechecks inside `Action.run`.

- **Remove the hand-wired layer.** Delete a `NodeCrypto.layerSignature` provided around `GitHubApp.layer` only to satisfy it.
- **Stand-in layers must provide it.** A custom layer that replaces the runtime's platform layer, in a test or a second entry point, must now provide `Signature` too, or the compiler reports it missing.

Check the installed `.d.ts` for the `ActionServices` members.
