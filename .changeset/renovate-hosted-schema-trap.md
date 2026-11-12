---
"@effected/ai-plugins": patch
---

## Documentation

- The `effected-renovate` skill's ledger entry 0012 now states that passing a runtime `HostedSchema` from `@effected/schemastore` as a config's `hosted` needs `@effected/plugin` 0.6.2 and `@effected/schemastore` 0.33.1 to type-check, and that a config which rebuilt the identity from the plugin's copy should return to the runtime value. A new trap names the `separate declarations of a private property 'resolved'` error those versions fix.
