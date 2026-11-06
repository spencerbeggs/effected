---
"@effected/mcp": minor
---

## Features

* Adds the `package_build` tool, which builds one package into its `dist/prod`; a failed build arrives as a `failed` verdict with its issues, not as an error
* Adds the `action_build` tool, which builds one GitHub Action from its `effected.toml`. It writes only `dist` unless `persist` is set; `persist` defaults to false

## Breaking Changes

* `typescript` (`7.1.0-beta || 7.1.0-rc || >=7.1.0 <8`) and `@types/node` are now peer dependencies. A consumer without them installed gets a peer warning
