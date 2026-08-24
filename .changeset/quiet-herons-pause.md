---
"@effected/github": minor
---

## Features

`repositoryPatch` — builds a `RepositoryPatch` from a `RepositoryPatchDraft`, dropping every explicitly-`undefined` field. Solves the `exactOptionalPropertyTypes` mismatch between a settings object built from your own schema (`has_issues: boolean | undefined`) and octokit's generated params (`has_issues?: boolean`, no `undefined`), so a sync action that applies only what was configured no longer needs an `as` cast.

```ts
import { repositoryPatch } from "@effected/github";

// `config.has_issues` is `boolean | undefined`; absent fields drop out.
const patch = repositoryPatch({
	has_issues: config.has_issues,
	has_wiki: config.has_wiki,
	description: config.description,
});
```
