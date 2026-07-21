---
"@effected/app": patch
"@effected/config-file": patch
"@effected/lockfiles": patch
"@effected/markdown": patch
"@effected/npm": patch
"@effected/package-json": patch
"@effected/runtimes": patch
"@effected/tsconfig-json": patch
"@effected/walker": patch
"@effected/workspaces": patch
"@effected/xdg": patch
---

## Bug Fixes

### Internal @effected edges float patches instead of pinning exact versions

The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged.
