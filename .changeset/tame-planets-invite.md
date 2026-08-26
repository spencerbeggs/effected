---
"@effected/app": patch
---

## Documentation

The bundled `effected-packages` skill (part of the "effected" Claude Code
plugin) now covers the kit's 31st package:

- Added a `@effected/schema-org` row to the package index, and a new
  `references/schema-org.md` reference covering both entrypoints, the
  `buildResult`-not-`make` construction rule, the script-safe serializer's
  idempotent escaping, and the validator's prefix-resolution rules.
- The skill's routing `description` now mentions "emitting and validating
  schema.org JSON-LD structured data" — the phrase a router matches against
  to decide whether the skill loads at all, so this is what makes the new
  package discoverable rather than merely documented.
- Added `references/constructs/schema-org.md` and regenerated
  `references/constructs/package-json.md` (now listing `Funding` and
  `licenseExpressionOf`) from the build-emitted API Extractor models.

No change to the plugin's own runtime behavior — routing and reference
content only.
