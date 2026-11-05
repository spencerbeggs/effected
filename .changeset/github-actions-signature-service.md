---
"@effected/github-actions": minor
---

## Breaking Changes

`ActionServices` gains `Signature` (#1205), and `ActionRuntime.layer` provides it through `NodeCrypto.layerSignature`, so `GitHubApp.layer` now typechecks inside `Action.run`. A custom layer that stands in for the runtime platform must provide `Signature` too.

## Features

* `ActionInput.schema` takes optional parse options (#1206) that are forwarded to the decode, so `{ onExcessProperty: "error" }` rejects keys the schema does not name.
