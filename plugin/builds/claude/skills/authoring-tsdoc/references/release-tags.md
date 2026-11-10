# Release tags

API Extractor emits `ae-missing-release-tag` for every exported declaration of an entry that carries no release tag. The kit's policy is **binary**, and applying it is mechanical:

| Situation | Tag |
| --- | --- |
| Reachable from an export entry and meant for consumers to call, construct, extend or name | `@public` |
| Exported but not for consumers, and named by no `@public` signature: a test seam, a helper another entry imports | `@internal` |

A type that a `@public` signature names is `@public`, never `@internal`: tagging it `@internal` raises `ae-incompatible-release-tags`.

`@beta` and `@alpha` mark a surface as unstable, and that is a human signal. An agent never infers a maturity tier: default to `@public` for real API and `@internal` for test seams and cross-entry helpers, and ask when a symbol looks deliberately unstable. API Extractor reads `@experimental` as `@beta`; write `@beta`.

## Where the tag goes

In the doc comment of the **exported declaration**, conventionally last, after a one-line summary:

```ts
/**
 * Resolves the publish target for a package.
 *
 * @param manifest - the parsed package manifest
 * @returns the resolved target, or `undefined` when the package is private
 * @public
 */
export function resolveTarget(manifest: PackageJson): Target | undefined {
  // ...
}
```

- For a re-export, tag the original declaration in the module that declares it, never the `export { … }` line.
- A class's members inherit the class's tag; tag a member only to make it less visible, and see [diagnostics.md](diagnostics.md) for why that does not hide a type its signature names.
- A namespace-object const (`export const Walker = { ascend } as const`) is one declaration with one tag.

## Decision tree

1. **Is the symbol reachable from a path in the package's `exports`?** No → it is not surface, needs no tag, and should not be raising the warning; check it is not exported from an entry by accident.
2. **Is it meant for consumers?** Yes → `@public`.
3. **Does a `@public` signature name it** (a parameter, a return, a type argument such as a service's shape)? → `@public`.
4. **Is it exported only for a test or for another entry?** → `@internal`.
5. **Does a human want it shipped as unstable?** → `@beta`, or `@alpha` earlier still. An agent stops at steps 2 to 4.

## Release tags and the forgotten-export gate

`ae-forgotten-export` is not a release-tag problem. It means a declaration the entry exports names a symbol the entry does not export, and a release tag on either side never resolves it: [diagnostics.md](diagnostics.md) has the two fixes that do. The build does not use the underscore-prefix convention for `@internal` names: `ae-internal-missing-underscore` is turned off, so never rename an internal export with a leading `_`.
