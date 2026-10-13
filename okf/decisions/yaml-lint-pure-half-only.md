---
type: Decision
title: The yaml lint system stays inside the pure tier
description: The lint engine and built-in rules ship in pure-tier @effected/yaml; file discovery, config-file loading, a CLI and autofix-to-disk are explicitly out of scope for the package.
status: draft
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c90b8afb533af2b2
---

# The yaml lint system stays inside the pure tier

## Context

`@effected/yaml` added a yamllint-class lint system — a rule engine, a
built-in rule catalog and a config schema — on top of its existing pure
parsing and formatting engine. A lint system in the wild typically also
does file discovery, reads a config file from disk, exposes a CLI and
writes fixes back to disk. Building the yaml lint system had to decide
which of those the package itself would own.

## Decision

The lint system stays inside pure-tier `@effected/yaml`: the rule engine,
the built-in rule catalog, and a config *schema* — a validating
`Schema.Struct`, not a config-file loader. Everything with a tier smell
belongs to a later, separate boundary or integrated package, or to the
host: file discovery, config-file loading, reading and writing files, a
CLI, and autofix-to-disk. The package's contract stays strings in,
diagnostics or a fixed string out.

## Alternatives rejected

**Bundling a config-file loader and CLI into `@effected/yaml`.** Rejected
because it would repeat the tier violation the kit's [dependency
policy](../conventions/dependency-policy.md) exists to prevent: a pure
package that owns its parser must not also own its runner. Putting IO into
a pure-tier package would force every consumer of `@effected/yaml` — most
of whom never touch the lint surface — to accept a heavier dependency
closure and a tier reclassification for the whole package.

**Wire-compatible config with an existing `.yamllint` file.** Rejected
because it requires a deferred config-file loader, and it would fossilize
Python yamllint's option spellings inside an Effect `Schema` that would
then have to keep them forever. See the config schema's own [fresh vs.
yamllint-shaped reasoning in the lint interface](../interfaces/yaml-lint.md#config-schema-and-severity-model)
for the fuller argument against wire compatibility.

## Consequences

A consumer that wants file discovery, on-disk config loading, a CLI
entry point or autofix-to-disk builds that layer in a boundary or
integrated package, or in the host application, over `YamlLint.run` /
`.fix` and the config schema. The pure engine's test suite and public
surface never grow an IO dependency because of the lint feature. Any future
CLI or config-loader package for yaml lint is a new package or a host
concern, not a `@effected/yaml` addition.
