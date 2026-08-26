---
"@effected/pnpm-plugin-effect": patch
---

## Documentation

### `pnpm add --config` destroys integrity pinning

The README told you the command "fills in the version and the required
integrity hash for you." Reproduced on pnpm 11.24.0, it does neither: the
entry it adds is written with no `+sha512-…` suffix, and every **other**
`configDependencies` entry loses its suffix too.

```text
BEFORE: "@savvy-web/pnpm-plugin-silk": 0.30.0+sha512-B3vQOdaC…
AFTER:  "@effected/pnpm-plugin-effect": 0.6.11     ← added without integrity
        "@savvy-web/pnpm-plugin-silk": 0.30.0      ← stripped, untouched entry
```

A subsequent plain `pnpm install` does not restore them; a hand-written hash
is accepted and preserved. Config dependencies install ahead of the tree and
can run hooks, so this silently removes the guard on the packages with the
most reach.

The README now documents the hazard and the remediation — recover a hash with
`npm view <pkg> dist.integrity` and write it in by hand — beside the install
step that causes it. Found by a consumer following that step.
