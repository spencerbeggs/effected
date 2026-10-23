---
"@effected/runtimes": minor
---

## Breaking Changes

### Concurrent resolves share one population

Concurrent resolves on `layerFresh` (Node, Bun and Deno) now share one in-flight population and its outcome. When the feed fetch fails, every concurrent waiter receives the same `FreshnessError`; previously each waiter retried the fetch in turn. The next sequential resolve still retries. A waiter also keeps an interrupted first caller's population running instead of restarting it.

Types are unchanged. Code that relied on concurrent callers retrying the fetch one after another should retry explicitly.

### Wildcard constraints

Following `@effected/semver`, a constraint written as `^*`, `~*` or `^x` now resolves to the latest version instead of stopping below `1.0.0`.
