---
id: "0010"
title: "@effected/github: a check-run PATCH retries a 404 before failing"
kind: behaviour
shows: behavioural
applies:
  "@effected/github": ">=0.32.1"
detect: ["CheckRun"]
changesets: ["github-check-run-stale-404"]
closes: ["spencerbeggs/effected#1330"]
---

`CheckRun.complete`, `completeRef`, `update` and `updateRef` now retry a 404 three times, waiting 250ms, 500ms and 1s on `Clock`, before they fail with the original `GitHubError`. GitHub's checks API can answer 404 for a run created moments earlier; that used to fail the call and leave the run `in_progress` forever.

- **A hand-rolled retry or delay around these calls** for that 404 is no longer needed. Where the search matched `CheckRun` next to an `Effect.retry`, a `Schedule` or an `Effect.sleep` that exists only for this, offer to remove it.
- **A test that scripts a 404 for one of these PATCHes** now sees four requests, and under `TestClock` it waits until the clock moves 1.75s. Script four 404s, or advance the clock, and expect the same `notFound` failure.
- **A wrong id still fails `notFound`**, 1.75s later than before. Every other status is unchanged.

Run the tests that drive `CheckRun`; a hang or a request-count mismatch on a 404 is this entry.
