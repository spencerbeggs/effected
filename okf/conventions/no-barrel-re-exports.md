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
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: "2026-10-23T00:00:00Z"
  - id: merge-strategy
    resource: ../../packages/config-file/src/MergeStrategy.ts
  - id: config-migration
    resource: ../../packages/config-file/src/ConfigMigration.ts
  - id: encrypted-codec
    resource: ../../packages/config-file/src/EncryptedCodec.ts
  - id: jsonl-envelope
    resource: ../../packages/jsonl/src/Envelope.ts
  - id: jsonl-event
    resource: ../../packages/jsonl/src/JsonlEvent.ts
  - id: spdx-expression
    resource: ../../packages/spdx/src/SpdxExpression.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-25T14:27:30Z
integrity:
  generated:
    body: 5797bdc11519392b
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
namespace object.[^config-file-index] `JsonCodec` is re-exported by the
root `src/index.ts`; `JsoncCodec`, `YamlCodec` and `TomlCodec` each by
their own subpath entrypoint (`src/jsonc.ts`, `src/yaml.ts`,
`src/toml.ts`), so a consumer installs only the engine it names. `ConfigCodec` is the interface
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

### Six `as const` containers are sanctioned name-collision holdouts

Six containers share their name with a type, and stay `as const` objects
by ruling:[^owner-ruling]

| Container | Collides with | Module |
| --- | --- | --- |
| `MergeStrategy` | generic `interface MergeStrategy<A>` | `@effected/config-file`[^merge-strategy] |
| `VersionAccess` | `interface VersionAccess` | `@effected/config-file`[^config-migration] |
| `EncryptedCodecKey` | `type EncryptedCodecKey` | `@effected/config-file`[^encrypted-codec] |
| `Envelope` | generic `interface Envelope<Tag, Data>` | `@effected/jsonl`[^jsonl-envelope] |
| `JsonlEvent` | generic `interface JsonlEvent<...>` | `@effected/jsonl`[^jsonl-event] |
| `SpdxExpression` | `type SpdxExpression` | `@effected/spdx`[^spdx-expression] |

The collisions are not all equally hard:

- **A type alias blocks the class form outright.** A class cannot share
  its name with a `type` alias; the compiler reports a duplicate
  identifier. `EncryptedCodecKey` and `SpdxExpression` cannot become
  classes without renaming one side.
- **An interface does not block it, but converting means declaration
  merging.** A class can merge with a same-named interface, generic ones
  included, provided the class declares the same type parameters (same
  count and names, no conflicting defaults); repeating the variance
  annotations is optional but keeps the two declarations visibly in step. Biome flags that merge
  as `noUnsafeDeclarationMerging`, so it needs a `biome-ignore` with a
  reason, as `ResolvedTsconfig` in `@effected/tsconfig-json` carries.
  `MergeStrategy`, `VersionAccess`, `Envelope` and `JsonlEvent` could
  convert that way. They stay `as const` because the merge would put a
  behaviour interface's members on a statics-only class's instance type,
  and the kit has not chosen to take that on for them.

Do not put these six in a sweep that converts grouped statics to the class
form. Such a sweep covers the explicitly typed
`export const X: { ... } = { ... }` containers, which have no collision.
Adding a seventh holdout, or converting one of the four interface
collisions, is a change to this table first.

[^config-file-index]: `packages/config-file/src/index.ts` exports
    `JsonCodec`; `src/jsonc.ts`, `src/yaml.ts` and `src/toml.ts` each
    export one of the other three, a separate named binding per entry.
[^config-file-codec]: `packages/config-file/src/ConfigCodec.ts:55` —
    the four codecs "are free-standing named exports, one per module."
[^merge-strategy]: `packages/config-file/src/MergeStrategy.ts` —
    `export interface MergeStrategy<A>` and
    `export const MergeStrategy = { firstMatch, layeredMerge } as const`.
[^config-migration]: `packages/config-file/src/ConfigMigration.ts` —
    `export interface VersionAccess` and
    `export const VersionAccess = { default: defaultVersionAccess } as const`.
[^encrypted-codec]: `packages/config-file/src/EncryptedCodec.ts` —
    `export type EncryptedCodecKey` and the `as const` container of the
    same name.
[^jsonl-envelope]: `packages/jsonl/src/Envelope.ts` —
    `export interface Envelope<out Tag extends string, out Data>` and the
    `as const` container of the same name.
[^jsonl-event]: `packages/jsonl/src/JsonlEvent.ts` — the generic
    `export interface JsonlEvent` and the `as const` container of the
    same name.
[^spdx-expression]: `packages/spdx/src/SpdxExpression.ts` —
    `export type SpdxExpression` (the AST union) and the `as const`
    container of the same name.
[^owner-ruling]: conversation with the repository owner, 2026-10-23 —
    ruling 15 of the breaking kit wave: the six `as const` sites are
    sanctioned name-collision holdouts, and the grouped-statics sweep
    covers only the typed-const containers.
