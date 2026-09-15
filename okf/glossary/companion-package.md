---
type: Glossary
title: Companion package
description: A published, installable package that is not a library — its API is not why you install it, and it carries no tier; the pnpm plugin and the schemastore bin.
status: stable
tags:
  - architecture
  - release
sources:
  - id: project
    resource: ../project.md
generated:
  by: "claude-code/opus-5"
  at: 2026-09-14T04:45:45Z
  body_sha256: b412178e33d2b84bb1d58a1ce66c90d6f3dcd3e2eaec52ea8f5477d7d9731801
---

# Companion package

A **companion** package is published and installable but is not a
library: its API is not the reason to install it. One exposes no API at
all; the other exposes a single layer over the library it fronts, as a
courtesy to a program that wires the layers itself. It ships in the
kit's release waves alongside the libraries, and installing it is
optional for the consumer.

## Companion is a category, not a fourth tier

The [three tiers](library-tier.md) — pure, boundary, integrated — sit on
one axis, external dependency surface, and answer "what does depending
on this cost you?" That question is meaningless for a package nobody
depends on for its API: one companion has no exported surface at all,
and the other's one export is a layer implementing the fronting
library's own contract, not a surface of its own. A companion is
therefore not ranked against pure, boundary and integrated; it sits off
the axis entirely. The three tiers continue
to classify **libraries only**, and a companion has no tier rather than a
fourth one.

## The companions in the kit today

Two packages are companions.[^project]

`@effected/pnpm-plugin-effect` ships the pnpm catalogs and a pnpmfile —
configuration, not code — and installing it pins a consumer's `effect`
versions and peer floors, and the kit's own package versions, to the
values the kit was built and tested against. It is a real published
package a consumer installs and depends on for its effect, even though
there is no JavaScript to import from it.

`@effected/schemastore-cli` is the `schemastore` bin over
`@effected/schemastore`: its published surface is the executable,
`./package.json` and one `.` export, `AjvValidator` — the shipped
`SchemaValidator` engine the command composes, exported so a program
driving the library's `SchemaPipeline` itself can run the same engine
(see [the engine lives in the CLI](../decisions/schemastore-engine-lives-in-the-cli.md)).
Every type a config file needs still comes from the library. That it
runs under a CLI environment, touches the filesystem and carries `ajv`
does not give it a tier: tier answers what depending on a package costs
an importer, and the one thing an importer reaches here is a layer over
the library's contract — the command is the canonical use. It releases
as a fixed pair with the library it fronts, at one version, with an
exact peer pin on it.

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
