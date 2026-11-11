---
"@effected/bundler": patch
"@effected/engine": patch
"@effected/cli": patch
"@effected/mcp": patch
---

## Maintenance

- Pins every `@effected/*` dependency to the exact version the tool was built and tested with, so a newer kit patch never reaches an installed tool without a release of the tool. Each library's kit peers resolve from these pins, so a consumer's other kit versions no longer split the tool's graph.
