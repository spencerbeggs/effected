---
"@effected/npm": minor
---

## Features

### CatalogAssemblyError says why

`CatalogAssemblyError.message` now appends its cause's message: `Failed to assemble catalogs from hooks <name>: <cause>`. The cause is where the actionable detail lives: the declared and installed versions, the stores searched, the remediation, or the module a pnpmfile could not import. A consumer rendering only `message` previously lost all of it (#842). A cause that is itself a `CatalogAssemblyError` is rendered as its own message rather than prefixed twice.

`CatalogAssemblyError` gains an optional `reason`, set when a `hooks`-source failure could not resolve a config dependency at its declared version:

* `notInstalled`: the version is in neither `node_modules/.pnpm-config` nor any store, and the layer does not fetch.
* `ambiguous`: one store holds the version more than once.
* `fetchFailed`: fetching the version into the store failed.
* `integrityMismatch`: the inline and lockfile integrities disagree.
* `integrityUnavailable`: no integrity was recorded to verify a fetch against.

Every other failure leaves it absent.
