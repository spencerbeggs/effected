---
"@effected/plugin": minor
---

## Features

* New package: the effected carrier. Installing `@effected/plugin` provides the `effected` command and the `effected-mcp` server through bin shims that call `@effected/cli` and `@effected/mcp`, so `effected --version` ends with `via @effected/plugin <version>` and the `identity` MCP tool reports the carrier as its distribution. `PLUGIN_VERSION` is exported from the root.
* Install it as a root devDependency with `"@effected/plugin": "catalog:effected"`.
