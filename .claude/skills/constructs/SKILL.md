---
name: constructs
description: Use when maintaining the generated construct index at plugins/claude-code/skills/effected-packages/references/constructs/ — regenerating it after a package's exports change, authoring intent annotations for new value-kind exports, or repairing a construct-index.bats failure (drift, stale annotation, missing intent). The index is generated; never hand-edit it.
---

# Maintaining the construct index

The construct index (effected#188) is one generated markdown table per kit
package under `plugins/claude-code/skills/effected-packages/references/constructs/`,
rendered by `plugins/claude-code/scripts/generate-constructs.mts` from each package's
build-emitted doc model (`packages/<dir>/dist/prod/npm/meta/<dir>.api.json`)
joined with `plugins/claude-code/scripts/construct-annotations.json`. The generated files
are never hand-edited — every change flows through the annotations file or the
source itself, then regeneration.

`plugins/claude-code/__test__/construct-index.bats` enforces three things: the committed
files match a fresh regeneration, no annotation names a construct that no
longer exists, and every value-kind export (Class / Variable / Function /
Enum) carries an intent annotation. Interfaces and type aliases ride on their
TSDoc summary; annotating them is optional.

## The loop

1. `pnpm build` — the doc models must postdate the source (a missing model
   fails the generator with exit 2 and a `build first:` message).
2. `node plugins/claude-code/scripts/generate-constructs.mts check --require-intent` —
   lists stale annotations and unannotated value constructs.
3. Author what it lists in `plugins/claude-code/scripts/construct-annotations.json`
   (shape below). Read the construct's source first — never write intent
   keywords from the name alone.
4. `node plugins/claude-code/scripts/generate-constructs.mts generate` — rewrites the
   committed tables.
5. `bats plugins/claude-code/__test__/construct-index.bats` — must be green before commit.

## Annotations file shape

```json
{
 "<packageDir>": {
  "<ConstructName>": "intent keywords as a plain string",
  "<OtherName>": {
   "intent": "intent keywords",
   "implements": "<packageDir>.<ContractName>"
  }
 }
}
```

`implements` is single-sided: annotate only the implementing construct; the
generator inverts the link so the contract's row says "implemented by …" and
the implementation's row says "implements …" — both packages' files update
from one entry.

## Writing intent keywords

The intent column is what an agent greps when it knows the *goal* but not the
*name* — that failure mode is the whole reason the index exists (four real
misses documented in #188). Rules:

- Write the words a consumer would search: verbs plus objects. "validate NTIA
  minimum elements, check SBOM compliance" — not "NTIA report class".
- Never restate the construct's name; the name is already in the row.
- Aim for 3–12 words, hard cap 14, lowercase, comma-separated phrases. Terse
  beats complete.
- Emphasis-active tokens — anything containing `*` or `_` (env-var patterns
  like `GITHUB_*`, `snake_case` names) — must be wrapped in code spans. The
  pre-commit markdown fixer rewrites bare emphasis-like sequences, and an
  un-spanned token breaks the committed-equals-regenerated fixed point.
- A schema-plus-class merged row gets ONE annotation covering both faces.
- If two constructs are a contract/implementation pair across packages, the
  implementing side carries `implements` — check for the kit's known splits
  (`commands`/`workspaces`, `npm`/`workspaces`, `sbom`/`github-actions`).
- A construct whose TSDoc summary already contains the searchable verbs still
  needs an annotation if it is value-kind — the check does not parse prose.

## Repairing a red construct-index.bats

- "has drifted" — someone changed exports or annotations without
  regenerating: run step 4 and commit the result. Never hand-edit the tables.
  If it goes red AGAIN after that regeneration+commit, the markdown fixer
  mutated a cell at commit time — code-span the offending emphasis-active
  token in the annotation (rule above) and regenerate once more. Never loop on
  plain regeneration; that never converges against a fixer that keeps
  rewriting the same token.
- "stale annotation" — the export was renamed or removed: move or delete the
  annotation entry, regenerate.
- "dangling implements" — an `implements` target names a package or construct
  that does not exist: fix or drop the `implements` field. `check` validates
  every `implements` target, not just staleness of the annotated name itself.
- "missing intent annotation" — a new value-kind export landed: author it
  (rules above), regenerate.
- "build first" — the doc models are missing or the checkout is stale:
  `pnpm build`, then rerun.
