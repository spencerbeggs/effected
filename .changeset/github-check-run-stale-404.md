---
"@effected/github": patch
---

## Bug Fixes

* `CheckRun.complete`, `completeRef`, `update` and `updateRef` retry a 404 three times over 1.75s before failing. GitHub's checks API can answer 404 for a run created moments earlier, which left the run `in_progress` forever. The waits run on `Clock`, a retried completion resends the first attempt's `completed_at`, and every other failure still follows the client's retry policy. Closes #1330
