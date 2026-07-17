---
"@effected/app": patch
---

## Documentation

Corrects effected-plugin skill guidance surfaced by dogfooding (the plugin ships bundled with `@effected/app`).

* `@effected/workspaces` sync escape hatch documented as free-standing consts in the main entrypoint taking a consumer-supplied sync filesystem/path — not a `WorkspacesSync` namespace, and not Node-only
* Construct map gains the namespace-qualified `ChildProcessSpawner.ChildProcessSpawner` access pattern, the `NodeHttpClient.layer` removal, and the `ConfigProvider.fromMap` → `fromUnknown` / `withConfigProvider` reshapes; the platform reference is re-verified against beta.98
* Migration guidance now tells plain-Vitest repos to adopt `@effect/vitest` from `catalog:effect` rather than treating plain Vitest as nothing to migrate
* Clarifies that the `@effected/app` no-dependency rule bars other libraries, not the application itself, which is its intended consumer
* Adds a predecessor (`*-effect`) → `@effected` migration bridge for `xdg-effect`, `config-file-effect` and `workspaces-effect`
