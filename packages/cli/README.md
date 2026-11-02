# @effected/cli

The `effected` command: the tool's command tree on the kit's front-end runtime (`@effected/cli-kit`).

This release answers `--version` and `--help` only. `effected --version` prints `effected <version>`; when a carrier package launched the bin, it ends with "via" and the carrier's name and version.

```ts
import { main } from "@effected/cli/main";

main({ distribution: { name: "@effected/plugin", version: "1.0.0" } });
```

> **Pre-`1.0.0`.** Part of the `@effected/*` kit; unstable across `0.x` releases. Pin an exact version.
