---
"@effected/copilot-plugin": patch
---

## Other

- `building-schemastore-schemas`, `actions-inputs-outputs` (output-contracts), `structuring-an-action`, `bootstrapping-an-action`, `building-a-github-action` and the `action-engineer` agent now teach the hosted-identity pattern: a `HostedSchema` declared beside the schema is what the payload's `$schema` and `defineConfig`'s `hosted` entry both read, the `schemastore` command is the drift gate, and there is no generator script, no layer composed in the config and no drift test to write. Generated objects are closed by default, so the `onExcessProperty: "error"` pin is retired. `@effected/schemastore` is documented as a runtime dependency and `@effected/schemastore-cli` — now the home of the ajv engine (`AjvValidator.layer`) — as a devDependency; `effected-packages` gains a construct index for the CLI and retiers the library to boundary.
