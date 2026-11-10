---
name: authoring-tsdoc
description: Use when writing or fixing TSDoc on a package built with `effected package build`, whose API Extractor pass reports ae-* and tsdoc-* codes in dist/prod/issues.json. Covers the binary release-tag policy (@public or @internal, never a guessed @beta), fixing ae-missing-release-tag, ae-forgotten-export (including TypeScript's `typeof local` declarations and inlined dependency types), ae-incompatible-release-tags and tsdoc-* syntax, the supported-tag allow-list, registering custom tags with [package.build.meta.tsdoc] tagDefinitions, and when a suppressWarnings rule is legitimate. JSDoc habits fail this toolchain; this corrects them.
when_to_use: write a TSDoc comment, document this export, JSDoc vs TSDoc, what release tag, @public or @internal, @beta, ae-missing-release-tag, ae-forgotten-export, needs to be exported by the entry point, ae-incompatible-release-tags, ae-internal-missing-underscore, ae-wrong-input-file-type, tsdoc-undefined-tag, tsdoc-param-tag-missing-hyphen, tsdoc-at-sign-in-word, tsdoc-escape-right-brace, tsdoc-malformed-inline-tag, custom TSDoc tag, @since, tagDefinitions, suppressWarnings, suppress an api-extractor warning, ciFatal, forgotten export after a TypeScript upgrade, typeof local, @packageDocumentation, @example, @remarks, @privateRemarks, fix the api extractor warnings
---

# Authoring TSDoc for the kit build

`effected package build` runs Microsoft API Extractor over each export entry's declarations and reports what it finds in `dist/prod/issues.json`. Every extractor message is a warning, every TSDoc parser message is a warning, and `ae-forgotten-export` is an error under CI: locally it is a warning marked `ciFatal: true`. Write **TSDoc**, not JSDoc: the parser enforces a specific tag set and syntax, and API Extractor enforces surface rules on top.

This skill owns the general policy. Two neighbours own the rest, and the three are meant to be read together:

| Concern | Owner |
| --- | --- |
| Release tags, the tag allow-list, custom tags, suppression policy, every `ae-*`/`tsdoc-*` fix not listed below | this skill |
| The `X_base` forgotten-export of Effect class factories, `{@link}` selector rules, the second-entrypoint surface rule | `effect-api-extractor-bases` |
| `effected.toml` keys, reading `issues.json`, the build itself | `building-a-package` |
| Fixing a package's diagnostics end to end | the `tsdoc-fixer` agent |

| Construct | Reach for it when |
| --- | --- |
| `@public` | an export a consumer is meant to call, construct, extend or name |
| `@internal` | an export not meant for consumers and named by no `@public` signature: a test seam, a helper another entry imports |
| `@beta`, `@alpha` | only when a human chose to mark a surface unstable |
| `[package.build.meta.tsdoc] tagDefinitions` | a project tag (`@since`, `@category`) that should parse instead of raising `tsdoc-undefined-tag` |
| `[package.build.meta.tsdoc] suppressWarnings` | a human-approved false positive, scoped by `messageId` and a narrow `pattern` |

## Standards

- **Give every exported declaration exactly one release tag and a one-line summary.** A bare `@public` with no sentence is half a fix, for `@internal` as much as `@public`.
- **Apply the binary policy:** consumer-facing API, and every type a `@public` signature names, is `@public`; a test seam or a helper another entry imports is `@internal`. Stop there; `@beta` and `@alpha` are a human's call.
- **Tag the declaration, not the export statement.** For `export { X } from "./x.js"`, the tag goes on `X` in `x.ts`.
- **Fix the cause, then rebuild to prove it.** A fix is done when a fresh build has `buildOk: true` and no `ae-*`/`tsdoc-*` warning or error left.
- **Write types in TypeScript, never in tags:** `@param name - description`, `@returns description`, no `{Type}`.
- **Put `@packageDocumentation` only in an export entry's file,** once per entry: `src/index.ts`, and `src/testing.ts` when `./testing` is an export too.
- **Narrate a non-entry module with `//` comments,** not a `/** */` block, which the parser reads as a doc comment.
- **Leave `suppressWarnings` to a human.** The default `_base` rule is the one sanctioned suppression an agent keeps; a new rule is a reviewed decision with its reason in a comment beside it.

## Fix-it map

| `issues.json` code | Fix | Detail |
| --- | --- | --- |
| `ae-missing-release-tag` | add `@public` or `@internal`, plus a summary | [release-tags.md](references/release-tags.md) |
| `ae-forgotten-export` on `X_base` | already suppressed by default; inline the factory | `effect-api-extractor-bases` |
| `ae-forgotten-export` on a lowercase local after a TypeScript upgrade | inline, make it a static method, or annotate the member | [diagnostics.md](references/diagnostics.md) |
| `ae-forgotten-export` on any other symbol | export it `@public`, or inline its shape structurally | [diagnostics.md](references/diagnostics.md) |
| `ae-incompatible-release-tags` | make the referenced type as visible as the signature | [diagnostics.md](references/diagnostics.md) |
| `ae-unresolved-link` | a selector, a link through the exported name, or backticks | `effect-api-extractor-bases` |
| `ae-wrong-input-file-type` | the package's own declarations reached its source; fix the import or tsconfig | [diagnostics.md](references/diagnostics.md) |
| `tsdoc-undefined-tag` | fix the tag, or register it | [custom-tags-and-suppression.md](references/custom-tags-and-suppression.md) |
| other `tsdoc-*` | fix the syntax | [diagnostics.md](references/diagnostics.md) |
| "what tags may I use?" | the standard TSDoc set, all enabled | [supported-tags.md](references/supported-tags.md) |

## Footguns

- `@internal` never clears an `ae-forgotten-export`: on an unexported type it changes nothing, and on an exported one it becomes `ae-incompatible-release-tags` → [diagnostics.md](references/diagnostics.md).
- A named type alias for an internal shape forgotten-exports under its own name → [diagnostics.md](references/diagnostics.md).
- `static readonly x = x` declares as `typeof x` and forgotten-exports the local; never export the local to silence it → [diagnostics.md](references/diagnostics.md).
- A `suppressWarnings` list you write replaces the default `_base` rule; restate it → [custom-tags-and-suppression.md](references/custom-tags-and-suppression.md).
- A `pattern` is a regular expression first, so `.` and `(` match more than they say → [custom-tags-and-suppression.md](references/custom-tags-and-suppression.md).
- A scoped package name in prose (`@effected/x`) parses as a tag; backtick it, even inside a markdown link's URL → [diagnostics.md](references/diagnostics.md).
- A backtick span wrapped across two comment lines fans out into brace and inline-tag warnings below it → [diagnostics.md](references/diagnostics.md).
- `@decorator` is a block tag, not a modifier → [supported-tags.md](references/supported-tags.md).

## Additional resources

- [references/release-tags.md](references/release-tags.md) — the binary policy, its decision tree, where the tag goes, and how release tags interact with the forgotten-export gate. Load when: choosing a release tag, or clearing `ae-missing-release-tag`.
- [references/diagnostics.md](references/diagnostics.md) — the fix for every `ae-*` and `tsdoc-*` code the build reports, including the `typeof local` rule and inlined dependency types. Load when: `issues.json` has an `ae-*` or `tsdoc-*` entry this table does not settle.
- [references/supported-tags.md](references/supported-tags.md) — every tag the build's TSDoc config enables, with its syntax kind. Load when: reaching for a tag, or reading `tsdoc-undefined-tag`.
- [references/custom-tags-and-suppression.md](references/custom-tags-and-suppression.md) — `tagDefinitions` and `suppressWarnings` in `effected.toml`, the exact matching semantics, and the suppressions that are legitimate. Load when: registering a project tag, reviewing a suppression, or a package overrides the default list.
- [references/doc-quality.md](references/doc-quality.md) — documenting the whole public surface: summaries on every member, `@remarks`, `@privateRemarks`, compilable `@example` blocks, barrels. Load when: documenting a `@public` export beyond what the build demands.
- `effect-api-extractor-bases` — the class-factory `_base` policy, every `{@link}` resolution rule, overload selectors, and a second entry point's own surface. Load when: the code is `ae-unresolved-link`, or `ae-forgotten-export` names an `X_base` or a type reached through a class factory or a second entry point.
- `building-a-package` — `effected.toml`, the build commands and the `issues.json` read order. Load when: building, or deciding whether a build passed.
