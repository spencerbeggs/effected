---
"@effected/schemastore": patch
---

## Bug Fixes

- `SchemaValidator.layer` now registers the standard `ajv-formats` vocabulary (`date-time`, `date`, `time`, `duration`, `uri`, `uri-reference`, `uri-template`, `url`, `email`, `hostname`, `ipv4`, `ipv6`, `regex`, `uuid`, `json-pointer`, `relative-json-pointer`, and more) on every per-call ajv instance. Previously ajv knew no formats, so under the package's default `strict: true` gate any document using `format` was rejected as an unknown format — a consumer could not express "this string is an ISO-8601 instant" and had to fall back to a `pattern` plus a runtime filter the document itself could not carry. Closes effected#657.
- `ajv-formats@^3.0.1` is now a direct dependency.
- An unknown format string is still a strict-mode rejection — registering the standard set is not a license for arbitrary format names.
- The plugin is applied with `keywords: false`, so its `formatMaximum` / `formatMinimum` (and exclusive) keywords are not registered — `DocumentLint` still answers those as unknown keywords, keeping the engine verdict and the lint verdict from drifting apart.
- No behavior change for documents that never use `format`; meta-schema (`validateSchema`) verdicts are unaffected.
