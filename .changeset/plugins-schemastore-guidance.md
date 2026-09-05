---
"@effected/claude-code-plugin": minor
"@effected/copilot-plugin": minor
---

## Features

- The actions-inputs-outputs skill drops the hand-rolled check-then-run contract preflight: `SchemaPipeline.run` refuses a pinned versioned target's contract change itself, and the drift test reads `contractBlocked` to print the right remedy.
- The LLM-annotation guidance is reversed: `x-ai-hint` is a declared family carried into emitted schemas, replacing the description-only advice.
- The schemastore package reference and construct index cover `contractChanges`, `SchemaContractChangeError`, `ContractChangeTarget`, `SchemaVersioning.isPinned` and `SchemaVersioning.next`.
