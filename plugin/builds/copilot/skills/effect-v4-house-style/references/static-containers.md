# Static containers: the class form and its holdouts

Same-module variants of one concept ship as a statics-only class:

```ts
export class X {
  private constructor() {}
  static readonly a = a
  static readonly b = b
}
```

never as an `as const` object, whose member types are inferred in the built
`.d.ts` and silently drop every member's TSDoc. The line is *same module, one
concept* — never cross-module, never one-per-engine. The same form serves
schema/parse facades and layer-factory facades alike.

## A same-named interface never blocks the class form

Generic or not, the class merges with a same-named interface when it declares
the same type parameters (same count and names, no conflicting defaults;
variance annotations are optional — a mismatch is TS2428), under a
`biome-ignore` for `noUnsafeDeclarationMerging`. `ResolvedTsconfig` and
`GitHubFixtures` (a statics-only class merged with the fixture-map interface)
are the precedents; `ActionsOidc` is the plain case with no same-named type at
all.

## The holdout rule

- **A same-named `type` alias forces a holdout.** A class cannot share its name
  with a `type` (TS2300, duplicate identifier) and a `type` cannot merge, so the
  value stays a `const` — `as const`, or explicitly typed when its members need
  declared signatures — with the rationale and every member's TSDoc on the
  const. Forced: `SpdxExpression` (`@effected/spdx`), `EncryptedCodecKey`
  (`@effected/config-file`) and `UiKey` (`@effected/cli-kit`, whose same-named
  union is the key model itself).
- **A by-choice holdout is a same-named interface that describes the *values*
  the container builds** — a strategy's `name`/`resolve`, a version accessor's
  `get`/`set`, an event descriptor, an envelope. Merging it onto a statics-only
  class would hang those members on the class's instance type, which nothing
  ever constructs, so the `as const` object is allowed for exactly that reason
  and no other. By choice: `MergeStrategy` and `VersionAccess`
  (`@effected/config-file`), `Envelope` and `JsonlEvent` (`@effected/jsonl`).
- Everything else is the static class. A module-private `as const` lookup table
  that is never exported is not a container and needs no exemption.

Do not invent a third shape.
