---
"@effected/workspaces": patch
---

## Bug Fixes

* `PackedInstall` strips `NODE_OPTIONS` from the install, probe and bin environments, so a workspace `nodeOptions` such as `--import=tsx` no longer crashes a scratch consumer. A bin that needs it passes it in its own `env`, which still wins
