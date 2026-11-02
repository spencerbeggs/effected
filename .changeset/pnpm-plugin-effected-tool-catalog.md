---
"@effected/pnpm-plugin-effected": minor
---

## Features

* The `effected` catalog lists the effected tool's packages: `@effected/plugin`, `@effected/cli`, `@effected/mcp` and `@effected/engine`.
* `publicHoistPattern` now hoists `@effected/plugin`, so its `effected` and `effected-mcp` bins reach every package of a consumer's pnpm workspace even when only one leaf package declares it.
