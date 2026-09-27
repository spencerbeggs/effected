---
type: Decision
title: A lockfile is a YAML stream, not always one document
description: pnpm lockfiles using config dependencies are two YAML documents in one file, and lockfiles is parsed against that fact by position rather than by content heuristic.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-27T06:20:52Z
  body_sha256: 8631bd47ee27e8af0838b8fee8e9050fcbfd53235d1f7ca8a081f96af3fc2826
---

# A lockfile is a YAML stream, not always one document

## Context

pnpm 11 and 12 write `pnpm-lock.yaml` as **two YAML documents** in one file when the workspace declares `configDependencies` or `devEngines.packageManager`: an "env" preamble, followed by the actual lockfile document. This repository's own lockfile is that shape. Both documents declare the same top-level keys (`lockfileVersion`, `importers`, `packages`), so a naive single-document parse **succeeds** on the preamble alone — it returns a valid-looking `Lockfile` with one package and no workspace importers, silently reporting an apparently empty workspace instead of failing or reading the real document.

## Decision

`@effected/lockfiles` treats a pnpm lockfile as a **YAML stream** and selects the correct document by **position**: the lockfile is always the **last** document in the stream, because pnpm's own writer composes the file as env-prefix followed by the main document (`writeEnvLockfile` emits `${env}---${main}`, and `extractMainDocument` reads back everything after the first separator) — so the preamble is always a prefix, never a suffix. `src/internal/documents.ts` owns this selection.

## Alternatives rejected

**A structural or content-based heuristic** — for instance, "the document with a populated `importers` map wins" — was rejected. Both documents in a config-dependencies lockfile carry the same keys, so a structural rule would pick the preamble just as happily as the real document in the cases that matter; the two documents are not distinguishable by content in general, since a legitimately empty workspace's real document can look exactly like the preamble. Position, driven directly by the writer's own contract, is the only sound discriminator available.

**Treating the framing rule as universal across formats** was also rejected. yarn shares YAML as its underlying syntax but defines no document-framing convention of its own, so a multi-document `yarn.lock` fails typed rather than being silently truncated to a guessed document — where a format states no rule, the package refuses to guess rather than inventing one. npm and bun were checked, not assumed, to confirm they never share this hazard at all: a second top-level value is a syntax error in both of their underlying formats (JSON and JSONC respectively), so there is no multi-document case to frame for either.

## Consequences

An unlocatable lockfile document now fails typed through `LockfileFramingError`, carrying the format, the document count and a reason (`noLockfileDocument`, `noImporters`, or `unexpectedDocuments`) — and never a `cause`, since the text parsed fine and there is no foreign throwable to wrap. The invariant this buys: **an unlocatable lockfile fails typed; it can never return an empty `Lockfile`.** Before this rule, the silent single-document parse of a config-dependencies lockfile was the most dangerous kind of wrong answer, because it was indistinguishable from a legitimately empty workspace — a parser that succeeds on the wrong input is worse than one that fails outright, and this decision closes exactly that gap for the one format where it was possible.

The same position rule, read from the other end, locates the preamble: `PnpmEnvLockfile.packageManager` takes the **first** of exactly two documents, treats a single-document stream as having no preamble, and fails a stream of more than two with `unexpectedDocuments` rather than guessing, because that selection feeds integrity verification (see [lockfiles](../modules/lockfiles.md#the-env-preamble-the-pinned-package-manager)).
