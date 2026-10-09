---
type: Decision
title: config-file's codecs are free-standing named exports, never a namespace object
description: JsonCodec, JsoncCodec, YamlCodec and TomlCodec are four independent module-level exports rather than members of one collecting object.
status: stable
tags:
  - bundle
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: fb4a1c4ef2b26e871610c7f0826605b373dcc30ca410eac118b1708c1cc49c45
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# config-file's codecs are free-standing named exports, never a namespace object

## Context

`@effected/config-file` carries four config codecs — one each for JSON, JSONC, YAML and TOML — each wrapping a corresponding pure format package (`jsonc`, `yaml`, `toml`). A consumer typically needs exactly one codec (a JSON-only tool never touches TOML), but the four need to live in one package so `ConfigFile.layer` and the resolver/strategy machinery can compose against any of them through one shared `ConfigCodec` interface.

## Decision

Each codec is a distinct named export, its own binding in its own module (`JsonCodec.ts`, `JsoncCodec.ts`, `YamlCodec.ts`, `TomlCodec.ts`), importable in complete isolation. `ConfigCodec` is exported as an interface only — never as a value carrying the four codecs together. No form of a collecting object may exist: not a namespace object, not a dotted accessor, not a record, not a map.

## Alternatives rejected

**A namespace object collecting all four codecs** (`ConfigCodec = { json, jsonc, yaml, toml }`) was rejected. Such an object is a dispatch table: referencing it at all — even to reach the type, or to destructure one member — reaches every codec, and every codec reaches its own parsing engine. A consumer that only ever uses the JSON codec would still pull the jsonc, yaml and toml engines into its bundle. Tree-shaking fails **silently** in this shape — no error, no warning, just a bundle several hundred kilobytes larger than it should be, which is a defect nobody notices until someone measures bundle size directly.

## Consequences

The tree-shaking property this decision protects is **measured, not assumed**: bundling a consumer that names only one codec produces a bundle carrying that engine and no other engine's fingerprint, and bundling all four carries all four — a check cheap enough to re-run against any doubt. With no namespace object to grow, the constraint is structurally impossible to violate rather than a convention a contributor could helpfully (and silently) undo by collecting the exports "for convenience." The one entity that would notice a violation immediately is `@soda3js/tools`, a real consumer that takes `@effected/config-file` needing only TOML — it therefore carries unexecuted dependency edges on `jsonc` and `yaml` today and pays nothing for them only because this decision holds; a namespace object introduced here would cost that consumer real bundle weight the next time it installs. **The tripwire stands:** if tree-shaking is ever falsified for this package, realistically only by someone reintroducing a collecting object, this whole codec consolidation into one package must be revisited.
