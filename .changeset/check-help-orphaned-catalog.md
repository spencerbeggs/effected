---
"@effected/schemastore-cli": patch
---

## Other

- `check`'s `--help` description and the package README exit-code table now name the orphaned-catalog failure: a `catalog.json` no schema declares fails `check`, and its remedy is deleting the file (or restoring a `catalog` block), not running `build`. The behavior shipped in #746; this aligns the two surfaces a user reads at exit 1 with it.
