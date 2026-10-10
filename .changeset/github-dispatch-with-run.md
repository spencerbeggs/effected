---
"@effected/github": minor
---

## Features

### `WorkflowDispatch.dispatchWithRun`

Dispatches a workflow and reports the run it created, using GitHub's `return_run_details` request field. It answers `Option<DispatchedRun>`, where `DispatchedRun` (newly exported) carries `runId`, `runUrl` and `htmlUrl`.

* A 204 is `Option.none()`, not a failure. That is what a GitHub Enterprise Server that predates the field answers.
* A 200 body that is not run details fails with a `decode` `GitHubError`.
* Request errors such as 404 and 422 pass through unchanged.
* `dispatch` is unchanged and never sends `return_run_details`.

### `dispatchAndWait` follows the exact run

When GitHub reports the run id, `dispatchAndWait` polls that run directly, so concurrent dispatches of the same workflow on the same ref can no longer be confused. On a 204 it falls back to the previous search by time, branch and path.
