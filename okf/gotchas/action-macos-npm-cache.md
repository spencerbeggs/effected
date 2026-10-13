---
type: Gotcha
title: A macOS Actions runner's npm cache is partly root-owned
description: GitHub's macOS runners ship a partly root-owned ~/.npm/_cacache, so a bare npm pack or npm publish dies with EACCES unless the cache directory is redirected explicitly at the call site.
status: stable
resource: ../../packages/npm/src/NpmExecutor.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 92877ebeaee2e336
---

# A macOS Actions runner's npm cache is partly root-owned

## What a reader sees

A publish step that runs `npm pack` or `npm publish` on a macOS Actions
runner, with no cache configuration of its own, works locally and in CI
on Linux runners.

## What they would wrongly conclude

That the step is portable across runner images, or that a failure on the
macOS runner points at a credentials or registry problem rather than the
filesystem npm is writing its cache to.

## What is actually true

GitHub's macOS runner images ship `~/.npm/_cacache` with some entries
already owned by root. npm silently tries to use that directory, and the
process (running as the normal runner user) dies with `EACCES` the moment
it needs to write there — a run that previously reported 11 of 11 publish
targets failing at once on the first real run against a fresh macOS
image. There is nothing wrong with the credentials, the registry, or the
packages being published; the cache directory itself is not writable.

## The check

Never invoke npm without an explicit cache redirect on a macOS runner.
`NpmExecutor.withCacheDir` owns this — build the executor with a runner-
temp cache directory rather than letting it fall through to the default,
and keep the redirect visible at the call site rather than hidden behind
an environment variable a later reader will not think to look
for.[^npm-executor]

[^npm-executor]: `packages/npm/src/NpmExecutor.ts:27-77` — `cacheDir` is
    emitted as `--cache <dir>` on every invocation, and `withCacheDir`
    documents the root-owned-cache failure mode this redirect exists to
    avoid.
