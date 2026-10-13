---
type: Convention
title: Plan a surface's first consumer port as a design round
description: A first consumer of a kit surface reports absence, not mere mis-projection — plan its port as a design round that may reshape the surface, never as an absorption round that merely wires an existing API to a new caller.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - dx
sources:
  - id: reposets-repo
    resource: https://github.com/spencerbeggs/reposets
  - id: tsdoctor-repo
    resource: https://github.com/spencerbeggs/tsdoctor
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e166e7823ee54a47
---

# Plan a surface's first consumer port as a design round

The dogfood pattern a consumer port reports depends on whether that
consumer is the first to exercise a given surface, and the two cases look
different enough that planning for the wrong one costs real rework.

**A repeat consumer of an already-proven surface reports projection, not
absence.** The github-split program's six consumer repos each ported
onto surfaces (`commands`, `templates`, `github`, `github-actions`,
`sbom`) that other consumers in the same program had already exercised.
None of the six reported a missing capability between them: every finding
was a *projection* the consumer had to write between two things the kit
already owned — OIDC claims mapped to a provenance predicate, a check
state mapped to a document, a row type mapped to a table — and each got
one wrong in a way that still typechecked. The right response to that
class of finding is to absorb the projection into the kit surface itself,
not merely to document the hazard and leave every future consumer to
rediscover it.

**A first consumer of a surface reports differently: it finds absence.**
`reposets`[^reposets-repo] is the worked case — the first consumer to
drive `@effected/app` and `@effected/store` from outside the kit, and the
first to run at a terminal rather than on a CI runner. It did not report
mis-projected calls against an existing API; it reported that pieces of
the surface did not exist yet: a resolver chain, a read-through cache, a
UTF-8 codec, decode options, six unrepresented GitHub route families, and
the whole `@effected/cli` boundary. Two of those findings were written up
downstream, as a design document for the kit to fold in, rather than
filed as ordinary bug reports against an existing contract.
`@effected/schema-org` followed the same shape: named into existence by
`tsdoctor`,[^tsdoctor-repo] the register's only library-monorepo
consumer, rather than built ahead of a named need.

**The convention:** plan the first port onto any new surface as a design
round, not an absorption round, and expect the surface itself to change
shape rather than merely gain a method. Treat the first consumer's report
as design input to the package doc before implementation, the same
design-doc-first cycle every new kit package already runs. Do not assume
a first port will land as smoothly as a repeat one just because the kit
has ported surfaces successfully before — that track record describes
the *second* consumer's experience, not the first's.

[^reposets-repo]: `spencerbeggs/reposets` — the kit's first consumer that
    runs at a terminal rather than on a runner, and the first to drive
    `app` and `store` from outside the kit.
[^tsdoctor-repo]: `spencerbeggs/tsdoctor` — the register's only library
    monorepo consumer, and the consumer that named `@effected/schema-org`
    into existence.
