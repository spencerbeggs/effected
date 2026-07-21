---
"@effected/app": patch
"@effected/config-file": patch
"@effected/lockfiles": patch
"@effected/markdown": patch
"@effected/npm": patch
"@effected/tsconfig-json": patch
"@effected/walker": patch
"@effected/xdg": patch
---

## Bug Fixes

### Internal @effected peers float patches instead of pinning exact versions

The kit's internal `@effected/*` peer dependencies were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release: a single sibling patch forced a coordinated re-release of every package peering it, just to move the pin, and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

Every internal `@effected/*` peer is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. The `effect` peer, the catalog specifiers, and every non-peer dependency are unchanged.
