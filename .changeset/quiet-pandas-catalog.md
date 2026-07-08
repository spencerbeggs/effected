---
"@effected/pnpm-plugin-effect": minor
---

## Features

Initial release of `@effected/pnpm-plugin-effect` — a pnpm **config dependency** that centralizes Effect-ecosystem versioning across a workspace. Installed with `pnpm add --config`, it publishes two pnpm [catalogs](https://pnpm.io/catalogs) so every project pins Effect the same way:

* **`effect`** — every `effect` / `@effect/*` package pinned to the latest Effect v4 (beta) release.
* **`effectPeers`** — the same package set resolved to a calculated shared floor, the widest peer range a library can safely advertise.

```bash
pnpm add --config @effected/pnpm-plugin-effect
```

### Consuming the catalogs

* **Applications** reference the pinned versions directly, so the app always runs the current Effect:

  ```json
  { "dependencies": { "effect": "catalog:effect", "@effect/ai-openai": "catalog:effect" } }
  ```

* **Libraries** pin the dev version and declare the calculated floor as the peer range consumers must satisfy:

  ```json
  {
    "devDependencies": { "effect": "catalog:effect", "@effect/ai-openai": "catalog:effect" },
    "peerDependencies": { "effect": "catalog:effectPeers", "@effect/ai-openai": "catalog:effectPeers" }
  }
  ```

All `@effected/*` packages follow this same versioning.
