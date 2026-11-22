---
"@effected/workspaces": patch
---

## Bug Fixes

* `PackedInstall.run` no longer lets a `pnprServer` in pnpm's global config reach the pnpm consumer install. A pnpr server resolves on the server, which cannot read the consumer's local tarballs, so on such a machine every pnpm install failed with `pnpr request failed` while CI passed. The install now reads its global config from a scratch copy of pnpm's global config directory with only `pnprServer` removed, so the user's registry, auth and proxy settings still apply
