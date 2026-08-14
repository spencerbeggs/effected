---
"@effected/github": patch
---

## Documentation

* `CodeScanning.configure` now records that turning default setup back to `not-configured` **does not remove the synthetic CodeQL workflow** GitHub created when it was enabled — it stays listed among the repository's workflows. A caller treating "default setup is off" as "no CodeQL workflow exists", or counting workflows to decide whether a repository has CI, will be wrong. Observed against a real organization rather than inferred from the API description.
* `RepositoryVariable.set` now states that its 404-for-absent existence check is **documented, not probed** — no suite has issued that read against real GitHub. If the assumption is wrong, every write takes the create branch, so a surprising `alreadyExists` from the `POST` is evidence about the assumption rather than about the caller.
