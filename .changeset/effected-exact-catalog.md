---
"@effected/pnpm-plugin-effected": patch
---

## Features

- Serves a third runtime catalog, `effected:exact`: every `effected` entry with its operator stripped, following the frozen Effect-family versions. A tool package writes `catalog:effected:exact` to pin the kit exactly while still moving with every plugin release; libraries keep `catalog:effected` and `catalog:effected:peers`. It derives no override.
