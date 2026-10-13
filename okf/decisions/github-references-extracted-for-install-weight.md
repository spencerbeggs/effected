---
type: Decision
title: github-references was extracted from github for install weight
description: Why a pure vendor rule moved out of the client package it was born in.
status: draft
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5c2c3c1d90b759e9
---

# github-references was extracted from github for install weight

## Context

The GitHub closing-issue-reference grammar — the nine closing keywords, the
non-closing reference set, and the three dialects that read them — began
life inside `@effected/github`, alongside the octokit client. It is pure
string and regex work with zero effectful dependencies, but it lived next
to a package that pulls in `@octokit/core`, the paginator, the App JWT
signer and a sealed-box crypto pair.

The kit's standing rule is that pure-but-GitHub-shaped vendor logic belongs
in the kit rather than being re-derived by every consumer — a downstream
copy of this exact grammar had already drifted from GitHub's own linking
rules in several ways (see
[the drift settlements](../modules/github-references.md#drift-settlements)).
That rule says the grammar belongs *somewhere* in the kit; it does not say
where.

## Decision

Extract the grammar into its own pure-tier package,
`@effected/github-references`, with `effect` as its only peer and zero
runtime dependencies. `@effected/github` keeps a six-name compat
re-export and nothing else, so existing consumers of the old location keep
compiling — see
[the compat re-export decision](github-compat-re-export-droppable.md).

The deciding test was not "does a client already link here" but "can the
consumers most likely to re-derive this grammar actually reach it". A
consumer with no octokit edge at all — a commitlint rule, a changesets
harvester — is exactly the kind of consumer that would otherwise re-derive
this grammar by hand, and hosting it beside the octokit client would have
cost that consumer the entire client tree to reach a few pure functions.

## Alternatives rejected

- **Leave the grammar inside `@effected/github`.** Correct on the
  "pure-but-GitHub-shaped belongs in the kit" rule, but wrong on *which*
  package: it costs `github`'s own consumers nothing to host it there, and
  costs every octokit-free consumer the whole client tree.
- **Leave the grammar in each downstream consumer.** This is the status
  quo the extraction fixes: multiple hand-rolled copies had already
  disagreed with each other and with GitHub's actual linking behaviour.

## Consequences

`@effected/github-references` is pure tier and must stay that way: no
dependency is ever added to it, because the package exists precisely so a
consumer with no octokit can speak the grammar instead of re-deriving it.
`@effected/github` retains a `workspace:^` dependency on it for exactly one
reason — the compat re-export — and that re-export is itself scheduled to
be dropped at a later `github` bump once consumers migrate to importing
`@effected/github-references` directly.
