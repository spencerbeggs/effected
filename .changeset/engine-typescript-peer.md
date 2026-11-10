---
"@effected/engine": patch
---

## Bug Fixes

* `@effected/engine` now peers `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`) and `@types/node` (`^26.6.0`). It depends on `@effected/bundler`, which requires both, but did not declare them itself, so installing the engine on its own left both of the bundler's required peers unmet. The engine imports nothing from either. Installs of `@effected/plugin`, `@effected/cli` or `@effected/mcp` are unchanged, because each already declared these peers.
