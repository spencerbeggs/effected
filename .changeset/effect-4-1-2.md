---
"@effected/pnpm-plugin-effected": patch
"@effected/ai-plugins": patch
---

## Dependencies

The `effected` catalog moves the Effect family to 4.1.2, and the derived graph-wide pins follow it.

| Dependency | Type   | Action  | From  | To    |
| :--------- | :----- | :------ | :---- | :---- |
| effect     | config | updated | 4.1.1 | 4.1.2 |

## Documentation

* Four new `effected-renovate` ledger entries for Effect 4.1.2: refs compare by their contents again, `McpServer` JSON-encodes declared tool failures, core fixes that change a tested result, and SQL transaction spans plus idle OTLP exporters.
* `effect-v4-idioms` now says `Ref` and `MutableRef` compare by their current contents, and `effect-v4-module-index` lists core's `Jsonc` and `Json5` parsers.
* The `pnpm-plugin-effected` README and the `effected-packages` skill describe the Effect catalog range without naming a patch release, so they no longer go stale on each Effect patch.
