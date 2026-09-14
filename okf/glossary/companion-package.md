---
type: Glossary
title: Companion package
description: A published, installable package that is not a library — no API, nothing to import, no tier.
status: stable
tags:
  - architecture
  - release
sources:
  - id: project
    resource: ../project.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-14T02:44:47Z
  body_sha256: 4d274552508ff63b7cc2f19c644d19699805f409bfb8fb34266a3c51791576d1
---

# Companion package

A **companion** package is published and installable but is not a
library: it exposes no API, there is nothing to import and nothing to
call. It ships in the kit's release waves alongside the libraries, and
installing it is optional for the consumer.

## Companion is a category, not a fourth tier

The [three tiers](library-tier.md) — pure, boundary, integrated — sit on
one axis, external dependency surface, and answer "what does depending
on this cost you?" That question is meaningless for a package nothing
can depend on, because it has no exported surface to depend on in the
first place. A companion is therefore not ranked against pure, boundary
and integrated; it sits off the axis entirely. The three tiers continue
to classify **libraries only**, and a companion has no tier rather than a
fourth one.

## The one companion in the kit today

`@effected/pnpm-plugin-effect` is the only companion: it ships the pnpm
catalogs and a pnpmfile — configuration, not code — and installing it
pins a consumer's `effect` versions and peer floors, and the kit's own
package versions, to the values the kit was built and tested
against.[^project] It is a real published package a consumer
installs and depends on for its effect, even though there is no
JavaScript to import from it.

## Why "companion" and not "infrastructure"

"Infrastructure" would name the package's relationship to this repo and
would read as internal-only tooling, inviting the (wrong) inference that
it is not a real shipped package. `companion` instead names the
package's relationship to the *consumer* — it ships alongside the kit,
installation of it is optional, and it has no API — which makes that
wrong reading harder to fall into.

[^project]: `project.md` — the packages table's `pnpm-plugin-effect` row:
    "companion — no tier | invention; publishes the Effect catalogs the
    kit pins against."
