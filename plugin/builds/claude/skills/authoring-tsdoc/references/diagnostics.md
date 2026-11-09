# Diagnostic fixes

How the build reports API Extractor: every extractor message (`ae-*`) and every TSDoc parser message (`tsdoc-*`) is a warning, `ae-internal-missing-underscore` is off, and compiler messages from API Extractor's own bundled TypeScript are off, because they report noise against third-party lib types. Under CI, `ae-forgotten-export` is raised to an error, which fails the meta pass and the build; a local build shows it as a warning with `ciFatal: true`. There is no `api-extractor.json` to edit: the bundler configures API Extractor itself, and `effected.toml` is the only knob.

Fix the cause in source. Adding a `suppressWarnings` rule is not a fix; see [custom-tags-and-suppression.md](custom-tags-and-suppression.md) for the few that are legitimate.

## `ae-missing-release-tag`

An exported declaration has no release tag. Add `@public` or `@internal` per [release-tags.md](release-tags.md), with a one-line summary in the same comment. Do not blanket-tag everything `@public`: a leaked helper is `@internal`. This is usually the bulk of a new package's backlog.

## `ae-forgotten-export`

*`The symbol "Foo" needs to be exported by the entry point index.d.ts`*: a declaration the entry exports names `Foo`, which the entry does not export. CI-fatal. Identify which of four cases it is before touching anything.

### 1. An `X_base` symbol

The anonymous heritage type of an Effect class factory (`Schema.Class`, `TaggedClass`, `TaggedError`, `Opaque`, `Context.Service`). The default `suppressWarnings` rule absorbs it, so it appears in `suppressed`, not `warnings`. If it shows as a warning, the package's own `suppressWarnings` list replaced the default without restating it. `effect-api-extractor-bases` owns this case.

### 2. A lowercase local, after a TypeScript upgrade

TypeScript 7.1's declaration emit types a public member whose initializer is a bare, non-exported module local as `typeof local`. Earlier emit inlined the signature. The source did not change, but the member's `.d.ts` line now reads `typeof isRange` and API Extractor sees a public declaration naming an unexported symbol; the API docs show no signature. The three shapes:

- a class static: `static readonly isRange = isRange`;
- an `Object.assign` statics object: `Object.assign(schema, { isRange })`;
- an object literal: `export const Facade = { firstMatch, layeredMerge } as const`.

Fix each site, in this order of preference:

1. **Inline the body into the member**, so the initializer is the function itself rather than a reference to it.
2. **Make the member a static method.**
3. **Annotate the member's type explicitly**, with a one-line comment saying why the local stays (it is reused, or recursive).

For an `Object.assign` statics object, declare an exported `*Statics` interface, join it to the schema type with `&`, and check the literal with `satisfies`. **Never export the local and never suppress the warning:** either leaves the docs without a signature. After the fix, the symbol is in neither `warnings` nor `suppressed`.

### 3. An internal type of this package on a public signature

Two fixes work, and only two:

- **Export the type and tag it `@public`**, when it is genuinely part of the API. A service's shape interface passed to `Context.Service<Self, Shape>` is always this case.
- **Inline the type structurally** on the signature, so no named symbol exists to forget. Prefer this for engine-internal records under `src/internal/`.

```ts
// before: RawDiagnostic is internal → ae-forgotten-export
static fromRaw(raw: RawDiagnostic, text: string): YamlDiagnostic

// after: structural, nothing named
static fromRaw(
  raw: { readonly code: YamlErrorCode; readonly message: string; readonly offset: number },
  text: string,
): YamlDiagnostic
```

Three escapes look like they should work and do not:

| Attempt | Result |
| --- | --- |
| Tag the method `@internal` on a `@public` class | still fails: the member is still rollup surface |
| Tag the referenced type `@internal` | unexported, it changes nothing and stays `ae-forgotten-export`; exported, it becomes `ae-incompatible-release-tags` |
| Move the shape into a named `type` alias | the alias forgotten-exports under its own name |

### 4. A dependency's type inlined into the declarations

A type from another package can be physically inlined into the bundled `.d.ts` (it shows up renamed, such as `FileSystem_2`), and then it is forgotten whatever the referencing member's release tag. A **declared dependency's** types resolve as externals instead: the emitted `.d.ts` imports them, and nothing is forgotten. So:

- make the package a `dependencies` or `peerDependencies` entry, not a `devDependency` or a transitive one, so the declarations can import it;
- if the JS bundles it but its types cannot be inlined safely, list it in `dtsExternals` (and still declare it);
- or reshape the signature so the type is not on the public surface.

Some of these appear only in the bundled rollup and carry no `file` or `line`: find them by the symbol in the message. A type reached through a second export entry (`./testing`, `./node`) must be exported from that entry too; `effect-api-extractor-bases` covers that rule.

## `ae-incompatible-release-tags`

A `@public` signature names a less visible symbol, such as an `@internal` type it returns or extends. Make the tags compatible: promote the referenced type to `@public` when consumers touch it through the signature, or lower the referencing declaration when it is not really public. Never silence it: the public API would leak a type it calls internal.

```ts
/** Raw parser state. @internal */
export interface RawState { /* ... */ }

/** Loads the state. @public */
export function load(): RawState { /* ... */ }   // a public signature exposing an @internal type

// after: reachable through public API, so public
/** Raw parser state, as `load` returns it. @public */
export interface RawState { /* ... */ }
```

## `ae-unresolved-link`

An `{@link Target}` that does not resolve. The rule is that `{@link}` resolves only to a symbol the entry exports, under the name it exports it by; everything else is a backtick span. Selectors for merged value-and-type names (`{@link (Name:interface)}`), overload indexes (`{@link (fn:1)}`), namespace-object members, inherited and schema-declared members, cross-package symbols and second entry points are all in `effect-api-extractor-bases`. Never fix one by deleting a link that a selector would resolve.

## `ae-wrong-input-file-type`

The declaration program reached a `.ts` source file. When the file is outside the package, or under its `node_modules`, it is a sibling reached through a workspace link and the build already counts it as suppressed. A warning means **the package's own** declarations reached its own source: typically a hand-written `src/*.d.ts` that imports the package by its own name, or a tsconfig `paths` alias that resolves into `src/`. Fix the import or the alias; the build names every own source it found.

## The other `ae-*` codes

| Code | Cause | Fix |
| --- | --- | --- |
| `ae-extra-release-tag` | two release tags on one declaration | keep one |
| `ae-different-release-tags` | overloads or merged declarations with different tags | give every declaration of the name the same tag |
| `ae-internal-mixed-release-tag` | an `@internal` declaration merged with a non-internal one | tag all of them `@internal`, or none |
| `ae-misplaced-package-tag` | `@packageDocumentation` not in the entry file's first doc comment | move it to the top of the entry file |
| `ae-unresolved-inheritdoc-reference`, `ae-unresolved-inheritdoc-base`, `ae-cyclic-inherit-doc` | an `{@inheritDoc}` target that does not resolve, or loops | point it at an exported declaration that has its own comment, or write the comment |
| `ae-setter-with-docs`, `ae-missing-getter` | docs on a setter, or a setter with no getter | document the getter only |
| `ae-unresolved-import-path` | an `import()` type path API Extractor cannot follow | import the type by name |

The build never reports a missing doc comment. API Extractor raises `ae-undocumented` only while it writes an API report, and the bundler turns the report off, so an export with a release tag and no summary builds clean. Write the summary anyway ([doc-quality.md](doc-quality.md)): a clean `issues.json` does not mean the surface is documented.

## `tsdoc-*`: parser syntax

| Code | Cause | Fix |
| --- | --- | --- |
| `tsdoc-param-tag-missing-hyphen` | `@param name description` | `@param name - description` |
| `tsdoc-undefined-tag` | a tag outside the supported set: a JSDoc-ism (`@memberof`, `@augments`, `@class`, `@function`, `@module`, `@type`) or an unregistered project tag | delete or replace it, or register it ([custom-tags-and-suppression.md](custom-tags-and-suppression.md)) |
| `tsdoc-at-sign-in-word`, `tsdoc-characters-after-block-tag` | a bare `@` in prose, usually a scoped package name | wrap it in backticks: `` `@effected/config-file` `` |
| `tsdoc-code-span-missing-delimiter` | a backtick span split across two comment lines | rejoin the span on one line; rewrap the prose instead |
| `tsdoc-escape-right-brace`, `tsdoc-escape-greater-than`, `tsdoc-malformed-inline-tag`, `tsdoc-malformed-html-name` | raw `{`, `}`, `<` or `>` in prose | put code in a backtick span, or a fenced block for anything longer |
| `tsdoc-inline-tag-missing-braces` | `@link Foo` written bare | `{@link Foo}` |
| `tsdoc-unnecessary-backslash` | an escape the parser did not need | drop the backslash |
| `tsdoc-unsupported-html-name`, `tsdoc-missing-html-end-tag` | an HTML element in prose; the build reports unsupported elements | backtick it, or use a fenced block |

Three of these misdirect:

- **A markdown link hides a second copy of a package name.** `[@effected/x](https://npmjs.com/package/@effected/x)`: the `@effected` inside the URL is bare text to the parser. Never markdown-link a scoped package name; put the bare URL beside a backtick span.
- **A wrapped code span cascades.** Once a span is unterminated, the braces inside it go raw, so one wrapped `` `PATCH /repos/{owner}/{repo}` `` fans out into brace and inline-tag warnings on the lines below. Find the one wrapped span and rejoin it; do not escape braces. A closed one-line span protects `{` and `}` as it is.
- **Verbatim code needs a fenced block, not escapes.** A type, a config object or a generic signature pasted as prose hands the parser bare braces and angle brackets. TSDoc does not parse a fenced ```` ```ts ```` block's contents.

```ts
// before: JSDoc habits → tsdoc-param-tag-missing-hyphen, and a {Type} the parser reads as an inline tag
/**
 * @param count the number of retries
 * @returns {number} the next delay
 */

// after
/**
 * Computes the next retry delay.
 *
 * @param count - the number of retries so far
 * @returns the next delay, in milliseconds
 * @public
 */
```

## Two mistakes no diagnostic reports

A clean `issues.json` does not prove these are absent, so sweep for them:

- **A stray `@packageDocumentation`** in a file that is not an export entry. It belongs once in each entry's file and nowhere else. `grep -rn "@packageDocumentation" src` and compare against `exports`.
- **A `/** */` module-header block on a non-entry file**, especially under `internal/`. API Extractor parses it as a doc comment, attaches it to the next declaration, and any bare `@` or `{@link}` in it can raise a `tsdoc-*` warning there. Narrate a module with `//` comments.
