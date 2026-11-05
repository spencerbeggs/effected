---
id: "0004"
title: "@effected/cli-kit no longer peers on @effected/config-file"
kind: tooling
shows: none
applies:
  "@effected/cli-kit": ">=0.27.0"
detect: ["\"@effected/config-file\""]
changesets: ["cli-kit-drops-config-peer"]
---

`@effected/cli-kit` no longer declares `@effected/config-file` as an optional peer, because it no longer reaches it.

- **Drop the dependency if cli-kit was the only reason for it.** A package that declared `@effected/config-file` only to satisfy this peer can delete it. Keep it where the package imports `ConfigFile` or a codec itself.
- **A peer warning that named it is gone.** Nothing else needs to change.

The detect hits are every mention of the package; read each manifest hit to see whether the code imports it.
