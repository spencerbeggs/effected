---
id: "0031"
title: "@effected/workspaces: PackedInstall strips NODE_OPTIONS from its install, probe and bin environments"
kind: behaviour
shows: none
applies:
  "@effected/workspaces": ">=0.44.1"
detect: ["NODE_OPTIONS:[[:space:]]*\"\""]
changesets: ["packed-install-node-options"]
closes: ["spencerbeggs/effected#1300"]
---

`PackedInstall` drops `NODE_OPTIONS` from the environment of the scratch install, its probes and the bins it runs, as it already dropped `CI` and the `npm_config_*` and `pnpm_config_*` variables. A workspace `nodeOptions` such as `--import=tsx` therefore no longer reaches a scratch consumer, which has no `tsx` and crashed on it.

- **Remove a `NODE_OPTIONS: ""` workaround** from the `env` a test gives `PackedInstall`. It is harmless if kept, since an empty value is stripped too.
- **A bin that needs `NODE_OPTIONS`** passes it in the bin command's own `env`, which is layered after the scrub and still wins. A value in the whole-process `env` handed to the install is indistinguishable from an inherited one and is dropped.

Verify by running the packed-install suite with the workaround removed.
