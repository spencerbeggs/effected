---
"@effected/claude-code-plugin": minor
---

## Features

Add the `building-schemastore-schemas` skill: how a consumer repository publishes SchemaStore-shaped JSON Schema documents from Effect Schemas with `@effected/schemastore` and the `schemastore` CLI.

* `SKILL.md` — the construct table, standards and footguns for writing a `schemastore.config.ts`, deciding `published`, answering a `DRIFT` line, annotating for the editor keyword families, and wiring `schema:build` / `schema:check`
* `references/config.md` — `defineConfig`, every `SchemaTarget.make` field, config discovery, path resolution and the derived catalog URL rule
* `references/drift-and-versioning.md` — the published × policy × change table, `onDrift`, `--force`, the version grammar and what `next` suggests
* `references/document-authoring.md` — annotation placement, the declared keyword families, contract-vs-annotation classification, the `onExcessProperty` pin
* `references/ci-gate.md` — scripts, turbo, exit codes, the JSON report and the GitHub step summary
* `references/migrating-a-generator-script.md` — the `generate-schema.ts` → config mapping and what to delete
* The SessionStart briefing now names the skill
