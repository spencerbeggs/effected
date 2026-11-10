---
"@effected/pnpm-plugin-effected": minor
---

## Features

* The plugin now carries the pnpm settings the `effected:build` chain needs. Until now they came only from `@savvy-web/pnpm-plugin-silk`, so a repository that builds with the kit keeps them even if it runs a silk release that drops them, or no silk at all.
  * `minimumReleaseAgeExclude` adds `@effected/*`, so a kit release installs the day it ships. It also adds `@rolldown/*`, `@oxc-project/*` and `@typescript/*`, the platform bindings and type packages that rolldown and TypeScript publish alongside each release and pin exactly.
  * `allowBuilds` allows `esbuild`, whose postinstall is the only install script in the build chain; tsx pulls it in. Without the entry, `strictDepBuilds` fails the install.
* Each value is silk's for the same key. A repository running both plugins gets lists that union to one copy of each entry and maps that agree, so the merge warns about nothing. A repository's own value for a key still wins.
* The release-age quarantine itself, `strictDepBuilds` and `blockExoticSubdeps` stay with silk. They are repository security policy, not part of the build chain.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| tsdown | config | updated | ^0.23.4 | ^0.23.7 |
| @tsdown/exe | config | updated | ^0.23.4 | ^0.23.7 |
| rolldown | config | updated | ^1.2.16 | ^1.3.1 |
| @rsbuild/core | config | updated | ^2.3.0 | ^2.3.1 |
| @effect/tsgo | config | updated | ^0.63.0 | ^0.67.5 |
