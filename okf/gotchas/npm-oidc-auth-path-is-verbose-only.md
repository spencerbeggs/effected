---
type: Gotcha
title: npm names its publish auth path only below its default log level
description: A release pipeline that needs to know whether a publish used npm's OIDC exchange or the npmrc credential finds nothing in npm's default output, concludes npm does not say, and infers the answer from its own setup — which is wrong whenever an identity token was reachable, because the exchanged token silently beats the configured one and a failed exchange silently falls back to it.
status: stable
resource: ../../packages/npm/src/PackagePublish.ts
stale_after: 2027-04-23T00:00:00Z
tags:
  - release
  - security
sources:
  - id: publish
    resource: ../../packages/npm/src/PackagePublish.ts
  - id: npm-log
    resource: ../../packages/npm/src/internal/npmLog.ts
  - id: npm-oidc
    resource: https://github.com/npm/cli/blob/v12.2.1/lib/utils/oidc.js
  - id: npm-display
    resource: https://github.com/npm/cli/blob/v12.2.1/lib/utils/display.js
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-23T21:09:05Z
integrity:
  generated:
    body: c311866625353456
---

# npm names its publish auth path only below its default log level

## What a reader sees

`npm publish` exits 0 and prints `+ pkg@1.0.0` on stdout and a few
`npm notice` lines on stderr. Nothing says whether npm authenticated with a
token it exchanged from the CI identity token (trusted publishing) or with
the `_authToken` / `_auth` the npmrc holds. A pipeline that reports "how did
this publish authenticate" therefore reports what it *set up*: OIDC offered,
token configured, `tokenAuth` on.

## What they wrongly conclude

That npm does not report the path, so the setup is the best answer — and,
alongside it, two beliefs about npm that the setup-based answer depends on:
that a configured token is used whenever one is present, and that a failed
OIDC exchange fails the publish ("npm does not fall back to the configured
token").

## What is actually true

npm does say, but only at `verbose` and below, on stderr.[^npm-display]
`lib/utils/oidc.js` writes `verbose oidc Successfully retrieved and set
token` once the exchanged token is installed, `verbose oidc Failed …` /
`Failure …` when the id-token fetch or the exchange fails, and `silly oidc
Skipped …` when there is no id token or no `id-token` permission. Outside CI
it returns without a word.[^npm-oidc] The file is identical across the npm
majors in the support window.

The two beliefs are both false:

- **The exchanged token beats the configured one.** On a successful exchange
  npm installs the exchanged token over the npmrc credential for that
  registry; the publish goes out with the exchanged token even though a
  configured token was present.
- **A failed exchange falls back silently.** Every failure path in
  `oidc.js` returns without touching the configured credential, and the
  publish then authenticates with whatever the npmrc holds. Only a run with
  no credential at all fails, with `ENEEDAUTH`.

A third trap sits beside them: npm's first identity-token source is
`NPM_ID_TOKEN`, read before the Actions token service. Blanking only
`ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN` does not
stop the exchange when `NPM_ID_TOKEN` is set.

`@effected/npm`'s `PackagePublish.publishTarball` therefore runs npm at
`--loglevel=silly` and reports `PublishOutcome.auth` from those markers on
positive evidence only: the success marker is `"oidc-exchange"` (it wins,
because `Failed to set provenance …` is logged only after a successful
exchange), a failed or skipped marker on a successful publish is
`"configured-credential"`, and no marker is `"unknown"`.[^publish][^npm-log]
`tokenAuth` blanks all three identity-token variables, so it is
`"configured-credential"` by construction.

Three consequences a consumer inherits:

- **The forced level overrides the user's.** A `loglevel` in an npmrc or in
  `npm_config_loglevel` loses to the command-line flag. Only a `--loglevel`
  in the executor's `extraArgs`, which comes later on the command line, wins
  — and that run reports `"unknown"`.
- **`"unknown"` is common and honest.** It is what a run outside CI reports,
  what an npm without trusted-publishing support reports (including a
  runner's bundled npm used through `NpmExecutor.ambient`), and what a run
  with an npm `heading` configured empty or containing a space reports.
  Inferring an answer from the npm version or the setup would be a guess.
- **Failure output is filtered back.** A `PublishError.output` drops the
  `verbose`/`silly`/`http`/`info`/`timing` lines and keeps repeated notices
  once, as npm does below `verbose`; the stdout fallback runs on the
  filtered text. npm redacts the npmrc credential at every level, so the
  extra lines carry no secret.

`tokenAuth` also drops `--provenance`: on GitHub Actions npm's provenance
needs the same token service the option blanks, and npm fails the whole
publish without it.

[^publish]: `PackagePublish.ts` — `publishTarball`, the `PublishOutcome.auth`
    and `tokenAuth` TSDoc.
[^npm-log]: `internal/npmLog.ts` — `classifyPublishAuth` and
    `publishFailureOutput`.
[^npm-oidc]: `lib/utils/oidc.js` — the `log.verbose('oidc', …)` and
    `log.silly('oidc', …)` calls, and the `NPM_ID_TOKEN` read ahead of the
    Actions request path.
[^npm-display]: `lib/utils/display.js` — `#writeLog` writes every level to
    stderr with a `[heading, level, title]` prefix, and deduplicates notices
    only below `verbose`.
