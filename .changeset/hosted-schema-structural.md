---
"@effected/schemastore": patch
"@effected/plugin": patch
---

## Bug Fixes

- A `HostedSchema` built by `@effected/schemastore` now type-checks as an entry's `hosted` in a config built with `defineSchemastore` from `@effected/plugin`. The plugin inlines its own declaration of the class, and the class's two private members made it nominal, so `tsc` rejected the installed copy's value with `Types have separate declarations of a private property 'resolved'` even at the same version. The class now declares no private members. The runtime brand and the tool's version check still reject a value built by a different schemastore version.
