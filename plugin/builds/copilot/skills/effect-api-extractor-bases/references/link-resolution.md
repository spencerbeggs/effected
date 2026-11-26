# `{@link}` resolution and the TSDoc diagnostics around it

Every case below is an instance of one rule: `{@link}` resolves **only to
symbols the entry point exports, under the name it exports them by**.
Everything else is a backtick span.

## Six ways a name fails the rule

- **A schema-declared `Schema.Class` field** — the class owns it, but only
  through the factory, which API Extractor does not see through.
- **A module-local renamed at export** — `class Route` exported as
  `export { Route as RestRoute }` resolves as `{@link RestRoute}` and **never**
  as `{@link Route}`, no matter that `Route` is the name in the file you are
  writing the comment in.
- **A member of a const-only namespace object** — link through the exported
  const (`{@link Walker.ascend}`), never the bare member.
- **A module-private const** — never exported, so nothing resolves; backticks.
- **A re-exported cross-package `Schema.Class`, `{@link}`ed from a file that
  only `import type`s it** — even when the entry point re-exports the symbol
  (`export { Package } from "@effected/package-json"`), a `{@link Package}`
  written in a module that reaches it via `import type` fails with a
  **different message** than the other cases: *"This type of declaration is
  not supported yet by the resolver"*, and issues.json may attribute it to an
  unrelated line through the rollup. Backticks are the fix; the re-export
  itself is fine — only the `{@link}` form is rejected.
- **A symbol exported only from the root `.`, `{@link}`ed from a module that
  ships under a second entry point** (`./testing`, `./ui`, `./node`) — each
  entry point is its own API Extractor pass with its own export list, so the
  root's `{@link Foo}` is unresolved from `./testing`'s pass however public
  `Foo` is at `.`. This is the most common way a multi-entrypoint package
  breaks the rule. Backticks — or, when the symbol belongs to that surface,
  re-export it from the second entry point too, and the link resolves there.

## Merged value + type names: a member-reference selector

Any name carrying **both a value and a type declaration** — an `interface` plus
a `const` of the same name (`ConfigCodec`, `MergeStrategy`, `VersionAccess`), or
a branded scalar's `const` schema plus its exported `type` (`PackageName`,
`SpdxLicense`) — cannot be disambiguated by API Extractor from a bare link. Both
`{@link X}` and `{@link X.member}` resolve to `ae-unresolved-link`, and the
diagnostic says so literally: *"the reference is ambiguous… you need to add a
TSDoc member reference selector."*

The fix is the selector, and the link keeps working:

```ts
/** Wrap any {@link (ConfigCodec:interface)} with AES-GCM encryption. */
/** See {@link (ConfigResolver:variable).staticDir}. */
/** The decoded form of {@link (ConfigEventPayload:variable)}. */
/** A branded scalar: {@link (PackageName:type)}. */
```

Pick the selector that names the declaration you mean: `:interface`, `:variable`,
`:class`, `:type`. Getting it wrong still emits `ae-unresolved-link` — `:type` on
an interface does not resolve — so a zero-warning build is the proof you chose
correctly. `@effected/yaml` (`{@link (YamlSegment:type)}`) and
`@effected/config-file` (`{@link (ConfigCodec:interface)}`) both ship these
zero-warning.

**Do not "fix" these by deleting the link.** Replacing a resolvable
`{@link (X:interface)}` with an inert backtick span silently removes an API-doc
cross-reference; a selector form resolves for every merged name.

## Member of a const-only namespace object

Link through the exported name — no selector, and the bare member name never
resolves. The shape:

```ts
const ascend = (path: string): string => path; // module-local, NOT exported
export const Walker = { ascend } as const;     // the only export
```

Here `{@link ascend}` is `ae-unresolved-link` — not because the name is
ambiguous, but because **there is no export by that name**, so no selector can
fix it (`{@link (ascend:variable)}` stays red). Do not pattern-match "bare link
unresolved ⇒ reach for a selector"; that heuristic belongs to the merged-name
case above, where the diagnostic says "ambiguous". When the diagnostic says
*"does not have an export"*, the fix is a plain member reference through the
exported const — `{@link Walker.ascend}` — with no selector, because `Walker`
carries a value declaration only. `ConfigMigration.make` in
`@effected/config-file` and `@effected/walker`'s `Walker` both ship this form
warnings-clean. Expect the mistake to recur on every kit namespace object
(`Jsonc`, `ConfigResolver`, `ConfigMigration`, `ConfigCodec`, `MergeStrategy`,
`Walker`): the failure is invisible to tests and `types:check` and only
surfaces in the **prod** build's `issues.json`.

## Four cases where only a backtick span works

1. **Inherited members** — `{@link SemVer.make}` where `make` comes from the
   synthesized base. There is no selector for a member the declaration does not
   own. Write `` `SemVer.make` ``.
2. **Cross-package symbols you only `import type`.** A selector disambiguates
   *between local declarations*; it cannot reach a symbol API Extractor never
   rolled up into this package entry point. An adapter that does
   `import type { ConfigCodec } from "@effected/config-file"` and writes
   `{@link (ConfigCodec:interface)}` still gets `ae-unresolved-link`. Write
   `` `ConfigCodec` ``. Expect this on **every** adapter package that plugs
   into a seam it does not own.
3. **A `Schema.Class` FIELD** — `{@link ReleaseAgeGate.exclude}` or
   `{@link WorkspaceCatalogs.set}`, where the member is a schema-declared field
   rather than a hand-written class member. API Extractor does not see fields
   declared in the factory's field object as class members at all, so **no
   selector form fixes it** — `{@link (ReleaseAgeGate:class).exclude}` stays
   `ae-unresolved-link` too. Write `` `ReleaseAgeGate.exclude` ``. Note the
   asymmetry with the inherited-member case above — there the *declaration*
   does not own the member; here the class does own it, but only through the
   factory, which is the same dead end from API Extractor's side.
4. **A class with a same-named `static` and instance member** — a
   `Fn.dual` static `Range.filter` beside an instance `filter(versions)`.
   `{@link Range.filter}` reports *"ambiguous because "filter" has more than
   one declaration; you need to add a TSDoc member reference selector"*, and
   then rejects every selector you can write: `{@link Range.(filter:static)}`
   and `{@link Range.(filter:instance)}` are both *Unsupported system
   selector*. The advice in the diagnostic is a dead end. The house answer is
   to **not create the collision**: keep the instance method canonical and
   drop the static (derive a data-last form from an `Order` or a lambda), or
   give the static a distinct name, as `@effected/semver` does. Where a
   collision cannot be avoided, write the name in backticks.

## Overloaded exported functions: the index selector, parenthesized

Adding a second overload to an exported function is an ordinary additive
change, and it breaks every existing `{@link fn}` at once with the same
*"ambiguous… add a TSDoc member reference selector"* diagnostic the merged-name
case emits. The selector that fixes it is **not** `:function` — it is the
**overload index**, 1-based in `.d.ts` declaration order, and the whole
reference must be parenthesized:

```ts
/** The recipe form of {@link (descend:1)}; under `"record"` see {@link (descend:2)}. */
```

For a `descend` with two overload signatures plus an implementation signature:

| Form | Result |
| --- | --- |
| `{@link (descend:1)}`, `{@link (descend:2)}` | resolve, no warning |
| `{@link descend}` | *ambiguous… add a TSDoc member reference selector* |
| `{@link (descend:function)}` | *More than one declaration "descend" matches the TSDoc selector "function"* |
| `{@link descend:1}` | *Syntax error… the member selector must be enclosed in parentheses* |
| `{@link (descend:3)}` | *An overload for "descend" was not found that matches the TSDoc selector ":3"* |

Three consequences worth holding onto:

- **The system selector cannot disambiguate overloads.** Every overload is a
  `FunctionDeclaration`, so `:function` matches all of them and fails on the
  count — reach for the number, not the kind.
- **The implementation signature does not count.** `:3` fails on a function
  with two overloads and an implementation, because the index walks the
  rolled-up `.d.ts`, where only the overload signatures survive
  (`AstReferenceResolver.#selectUsingIndexSelector` →
  `Collector.getOverloadIndex`, which numbers same-kind declarations of the
  symbol in order, from 1).
- **Reordering overloads renumbers links.** `:1` names *position*, not
  signature, so a refactor that swaps two overloads silently repoints every
  link without a warning — the build stays green either way. Prefer citing the
  overload whose position is stable, and re-read the links when you reorder.

Backticks still work here. Where the link would carry the reader to the right
overload, use the selector; where any overload will do and the position is
likely to move, a backtick is the honest form.

## A member name that IS a TSDoc selector keyword

A member whose name collides with a TSDoc **system selector** (`variable`,
`function`, `class`, `interface`, `namespace`, `enum`, `constructor`,
`static`, `instance`, …) makes `{@link ActionInput.variable}` ambiguous to
the parser, and the bundler warns *"identifier must be quoted"*. The fix is the
same as every other unresolvable-link case: **backticks**
(`` `ActionInput.variable` ``) — do not try quoted-selector syntax, and do
not rename the API to appease the doc engine.

## `tsdoc-at-sign-in-word`: never markdown-link a scoped package

A scoped package name in TSDoc must be backticked. The trap is that **a
markdown link hides a second, unbackticked copy inside its URL**, and that copy
is the one that trips:

```ts
/** See [@effected/config-file](https://npmjs.com/package/@effected/config-file). */
//     ^ backticked? no — but even fixing the label leaves the URL's copy
```

The label being wrapped in `[...]` is not backticking, and the `@effected` inside
the parenthesized URL is bare text as far as the TSDoc parser is concerned.
Worse, the diagnostic **reports at the NEXT declaration's line**, so the reported
position points at an innocent symbol below the comment.

**The rule: backticks only. Never markdown-link a scoped package name in TSDoc**
— not in the label, not in the URL. If the URL genuinely matters, put the bare
URL on its own (`{@link https://…}` or plain text) and name the package in a
backtick span beside it.

## `tsdoc-code-span-missing-delimiter`: a code span must not wrap

A backtick code span must open and close on the **same comment line**. Prose
reflow is how this breaks: a span like
`` `Unsupported package manager specification` `` wrapped across two comment
lines reads perfectly balanced in source — each line's fragment looks fine —
but the parser sees two half-spans and emits **two**
`tsdoc-code-span-missing-delimiter` warnings in the prod gate. When wrapping
would split a span, rewrap the sentence, not the span: move the whole span to
the next line, or shorten the prose around it.

The warning **cascades and misdirects**: once a span is unterminated, the
braces inside it go raw, so a single wrapped span like
`` `PATCH /repos/{owner}/{repo}` `` fans out into `tsdoc-escape-right-brace`
and `tsdoc-malformed-inline-tag` warnings whose reported lines sit BELOW the
comment (declaration-relative reporting), a dozen or more from one wrapped
argv or route literal. Do not chase those by escaping braces — a properly
closed one-line span protects `{`/`}` fine, and brace-bearing spans like
`` `{ status: "enabled" }` `` are legal as-is. Find the one wrapped span and
rejoin it; the whole fan collapses.
