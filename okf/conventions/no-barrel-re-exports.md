---
type: Convention
title: Only entrypoint files re-export; never a barrel or a namespace object
description: Restrict re-exports to src/index.ts and published subpath entrypoints; every other module imports explicitly, and grouped implementations that each reach a distinct engine are never collected into one binding.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - bundle
sources:
  - id: config-file-index
    resource: ../../packages/config-file/src/index.ts
  - id: config-file-codec
    resource: ../../packages/config-file/src/ConfigCodec.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 34b360c986fec3e2
---

# Only entrypoint files re-export; never a barrel or a namespace object

Only entrypoint files — `src/index.ts` and any published subpath
entrypoints — may re-export. Every other module imports the values and
types it uses explicitly from their defining module: no intermediate
barrel files, no blanket `export * from` facades, and no re-exporting a
dependency's surface. Two failure modes justify the rule, both observed
in this kit's predecessor libraries: a blanket re-export facade creates a
phantom dependency nothing in `src/` actually uses, and entrypoint-based
static wiring couples module load order to the entrypoint, forcing
`sideEffects` declarations and deep imports on consumers.

## A namespace object is a barrel in different syntax, and a worse one

`export const Codecs = { json, jsonc, yaml, toml }` collects independent
implementations behind one binding exactly as `export *` collects
independent modules behind one module. It is worse because a bundler can
see through a re-export barrel — the named exports stay individually
reachable — but a namespace object is a **single live binding**:
reference it at all and every member is reachable, so every member's
whole module graph is retained. The failure is silent: no error, no
warning, just a bundle carrying engines the consumer never named.

## The worked example: config-file's four codecs

`@effected/config-file` holds every config codec, but the `jsonc`, `yaml`
and `toml` format packages stay independent, and the four codecs —
`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec` — are exported as
free-standing named exports, one per module, never collected into a
namespace object.[^config-file-index] `ConfigCodec` is the interface
only; there is no runtime value that groups the four
implementations.[^config-file-codec]

Collecting them into `export const Codecs = { JsonCodec, JsoncCodec,
YamlCodec, TomlCodec }` would drag every parsing engine — the JSONC, YAML
and TOML engines alike — into a JSON-only consumer's bundle, killing
tree-shaking silently: with the codecs as free-standing named exports, a
consumer importing only `JsonCodec` bundles a few hundred bytes; grouped
into one object, importing anything from that object would pull in all
three other engines too. Never collect the codecs into a namespace
object.

## `"sideEffects": false` does not answer this for an unbundled consumer

The entrypoint permission above is stated against bundlers, where a
barrel's named exports stay individually reachable and a tree-shaker
retains only what is named. An unbundled Node consumer has no
tree-shaker: importing one binding from `src/index.ts` evaluates that
module, which evaluates every module it re-exports, loading the whole
module graph regardless of `sideEffects: false`. The only mechanism that
answers "does a consumer that wants one class pay for the rest of the
package" is a published subpath entrypoint, reserved for a genuinely
heavy optional part of a package rather than reached for as a matter of
taste.

## When grouping is still allowed

Grouped statics are not banned outright. A set of variants of one
concept that live in one module and reach nothing heavier than each
other may be grouped — `MergeStrategy`'s `firstMatch`/`layeredMerge` pair
in `@effected/config-file` is exactly this shape. The hazard scales with
what sits behind each member: group siblings that share a module and a
dependency footprint; never group siblings that each drag in a distinct
engine. When in doubt, split — the cost of a separate module is one line
in `index.ts`, and the cost of getting it wrong is invisible until
someone measures the bundle.

### A sanctioned grouped-statics container is a class, not an `as const` object

Where grouping is warranted, the container is a `class` with a private
constructor and `static readonly` members, never
`export const X = { … } as const`. An `as const` object infers its member
types into the built `.d.ts`, and inference drops every member's doc
comment, so the documentation a package wrote for that surface becomes
invisible in a consumer's IDE. Call syntax is identical between the two
forms — this is a house-form rule about how the sanctioned group is
spelled, not a rule about whether grouping is allowed, and the two must
not be collapsed into one another: the namespace-object ban is about
*what* may be grouped and is load-bearing for bundle weight; this is
about *how* the sanctioned group is spelled and is load-bearing for docs.

[^config-file-index]: `packages/config-file/src/index.ts:33-38` —
    `JsonCodec`, `JsoncCodec`, `TomlCodec` and `YamlCodec` exported as
    separate named bindings, one import per line.
[^config-file-codec]: `packages/config-file/src/ConfigCodec.ts:55-56` —
    the four codecs "are free-standing named exports, one per module."
