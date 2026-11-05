---
type: Glossary
title: Companion package
description: A published, installable package that is not a library and not a program — its content is configuration, so it carries no tier; today only the pnpm plugin.
status: stable
tags:
  - architecture
  - release
sources:
  - id: project
    resource: ../project.md
generated:
  by: "claude-code/opus-5"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: dbc22cc89ae2d6d1
---

# Companion package

A **companion** package is published and installable but is not a
library: what it ships is configuration, not an API to import. It ships in
the kit's release waves alongside the libraries, and installing it is
optional for the consumer. A package that is a program a user runs is not a
companion either: the [effected tool](../decisions/one-tool-beside-the-libraries.md)
is an application with its own category.

## Companion is a category, not a fourth tier

The [three tiers](library-tier.md) — pure, boundary, integrated — sit on
one axis, external dependency surface, and answer "what does depending
on this cost you?" That question is meaningless for a package nobody
depends on for its API: a companion has no exported surface at all. A
companion is therefore not ranked against pure, boundary and integrated; it
sits off the axis entirely. The three tiers continue to classify
**libraries only**, and a companion has no tier rather than a fourth one.

## The companion in the kit today

One package is a companion.[^project]

`@effected/pnpm-plugin-effected` ships a pnpm catalog and a pnpmfile —
configuration, not code — and installing it pins a consumer's `effect`
versions and peer floors, and the kit's own package versions, to the
values the kit was built and tested against. It is a real published
package a consumer installs and depends on for its effect, even though
there is no JavaScript to import from it.

## Why "companion" and not "infrastructure"

"Infrastructure" would name the package's relationship to this repo and
would read as internal-only tooling, inviting the (wrong) inference that
it is not a real shipped package. `companion` instead names the
package's relationship to the *consumer* — it ships alongside the kit,
installation of it is optional, and its content is not why you would import
anything — which makes that wrong reading harder to fall into.

[^project]: `project.md` — the packages table's `pnpm-plugin-effected` row:
    "companion — no tier | invention; the one `effected` catalog (the
    Effect family on one minor, and the kit) plus the graph-wide Effect
    pins; renamed from `pnpm-plugin-effect`."
