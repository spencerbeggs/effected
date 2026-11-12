---
"@effected/bundler": minor
---

## Features

* `EffectedConfigSchema` is new. It holds the published `effected.toml` JSON Schema's identity: `host` (the `HostedSchema.github` input), `url` (the document's `$id`) and `directive` (the `#:schema` line a TOML file opens with).
* The `effected.toml` config schemas now carry editor annotations: a title or description on every key, defaults, examples, and enum documentation. An Open Graph image's exactly-one-of `path` and `url` rule is expressed in JSON Schema too. Decoding and its error messages are unchanged.
