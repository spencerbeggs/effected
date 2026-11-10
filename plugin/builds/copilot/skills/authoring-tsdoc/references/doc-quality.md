# Documenting the public surface

The API model the build writes to `dist/prod/<group>/meta/<unscoped>.api.json` feeds API reference sites, where every `@public` symbol becomes a page and every member its own row. Passing the build is the floor. Aim for docs a stranger could build against.

## Cover every declaration and every member

- **Every exported declaration gets a summary and a release tag**: functions, classes, interfaces, type aliases, enums and constants. A tag alone is not documentation, for `@internal` as much as `@public`.
- **Every member of an exported type gets its own summary**: each interface property, method, enum member and parameter. An undocumented member renders as a blank row. A `Schema.Class` field's comment goes on the field inside the factory's field object.
- **Say what the value is for**, not what type it has: the purpose, what a non-obvious default implies, the invariant it holds.

## Summary, `@remarks`, `@privateRemarks`

- **Summary**, the first paragraph: one sentence, shown inline in references and hovers.
- **`@remarks`**: edge cases, interactions and when-to-use, so the summary stays short.
- **`@privateRemarks`**: notes for maintainers and agents, stripped from published docs: why something is shaped oddly, what must change together.

```ts
/**
 * Resolved configuration handed to the reporter factory.
 *
 * @remarks
 * `dbPath` is optional so stdout-only renderers can ignore persistence; the plugin always sets it.
 *
 * @privateRemarks
 * Kept structurally identical to the factory's input so no adapter is needed. A field added here must be added there.
 *
 * @public
 */
export interface ResolvedReporterConfig {
  /** Console rendering mode selected for the active executor. */
  readonly consoleMode: ConsoleMode
  /** Absolute path to the persistence database; omitted by stdout-only renderers. */
  readonly dbPath?: string
}
```

## `@example` blocks are complete programs

Reference sites type-check example code, and a reader copies it, so:

- **Import everything the block uses**, values with `import` and types with a separate `import type`.
- **Show a real task** a consumer performs, not a value being logged.
- **Show results in a trailing `// =>` comment.**

```ts
import { Effect } from "effect"
import { SemVer } from "@effected/semver"

const program = Effect.gen(function* () {
  const version = yield* SemVer.parse("1.2.3")
  return version.minor
})
// => Effect<number, InvalidVersionError>; runs to 2
```

## Export from the declaring module

A barrel that re-exports from other modules (`export { X } from "./x.js"`, `export * from "./x.js"`) anywhere but an export entry detaches symbols from their declarations and makes the model harder to resolve. Import and export each symbol explicitly from the module that declares it; only entry files re-export. Reshaping exports is a source refactor, outside a diagnostics fix: flag a barrel and ask before changing it, and meanwhile put the tag and summary on the original declaration.
