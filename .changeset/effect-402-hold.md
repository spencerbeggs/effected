---
"@effected/app": patch
"@effected/cli": patch
"@effected/commands": patch
"@effected/config-file": patch
"@effected/engine": patch
"@effected/env": patch
"@effected/git": patch
"@effected/github-actions": patch
"@effected/github-commands": patch
"@effected/github-references": patch
"@effected/glob": patch
"@effected/images": patch
"@effected/jsonc": patch
"@effected/jsonl": patch
"@effected/jwt": patch
"@effected/lockfiles": patch
"@effected/lsp": patch
"@effected/markdown": patch
"@effected/mcp": patch
"@effected/memfs": patch
"@effected/npm": patch
"@effected/package-json": patch
"@effected/runtimes": patch
"@effected/sbom": patch
"@effected/schema-org": patch
"@effected/schemastore": patch
"@effected/schemastore-cli": patch
"@effected/semver": patch
"@effected/spdx": patch
"@effected/store": patch
"@effected/templates": patch
"@effected/toml": patch
"@effected/tsconfig-json": patch
"@effected/walker": patch
"@effected/workspaces": patch
"@effected/xdg": patch
"@effected/yaml": patch
---

## Bug Fixes

Republished with every `effect` and `@effect/*` version pinned exactly to `4.0.2`, both peer and dependency ranges.

On 2026-10-10, every `@effect/*` package published at `4.0.3`, but `effect@4.0.3` itself never reached npm (Effect-TS/effect#8994). The 4.0.3 packages require `effect ^4.0.3`. A caret range on any of them therefore resolves a 4.0.3 package next to `effect@4.0.2`, and the program crashes when it imports them. Exact pins keep a fresh install of any kit package on a matched set until `effect@4.0.3` is available.
