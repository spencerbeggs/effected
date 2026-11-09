# Custom tags and suppressions

Both live under `[package.build.meta.tsdoc]` in the package's `effected.toml`, and the authority for their shape is `TsdocConfig`, `TsdocTagDefinition` and `WarningSuppressionRule` in `@effected/bundler`'s installed `index.d.ts`. `building-a-package` covers where the file goes and how tiers merge: a list in the package tier replaces the root's list whole.

## Registering a tag: `tagDefinitions`

```toml
[package.build.meta.tsdoc]
tagDefinitions = [
  { tagName = "@since", syntaxKind = "block" },
  { tagName = "@category", syntaxKind = "block", allowMultiple = true },
  { tagName = "@schema", syntaxKind = "modifier" },
]
```

| Key | Meaning |
| --- | --- |
| `tagName` | the tag with its leading `@` |
| `syntaxKind` | `"block"` owns the text after it, as `@remarks` does; `"inline"` is brace-wrapped, as `{@link}` is; `"modifier"` stands alone with no content, as `@public` does |
| `allowMultiple` | whether one comment may carry it more than once |

The build adds each definition to the generated `tsdoc.json` and marks it supported, so it parses and no longer raises `tsdoc-undefined-tag`. Any other `syntaxKind` fails the decode, as `EffectedConfigError` at `package.build.meta.tsdoc.tagDefinitions.<n>.syntaxKind`, and an explicit `meta` table in a package with no `exports` fails `ConfigValidationError` at `meta`. Register a tag only when it carries information a reader needs; delete a JSDoc habit instead of registering it.

## Suppressing a message: `suppressWarnings`

**The default list is one rule:**

```toml
suppressWarnings = [{ messageId = "ae-forgotten-export", pattern = "_base" }]
```

It absorbs the synthesized `X_base` heritage types of Effect's class factories, which no consumer can name or needs. `effect-api-extractor-bases` explains why that one is principled.

**A list you write replaces the default.** An empty list suppresses nothing, and a list without the `_base` rule turns every class factory into a CI-fatal warning. Restate it first.

### How a rule matches

| Rule | Matches |
| --- | --- |
| `{ messageId, pattern }` | messages with exactly that id whose text matches `pattern` |
| `{ messageId }` | **every** message with that id |
| `{ pattern }` | any message whose text matches, across every id |
| `{}` | nothing |

`pattern` is compiled as a JavaScript regular expression and tested against the message text, and it falls back to a plain substring only when it is not a valid one. So `.`, `(` and `?` are metacharacters: escape them (`'index\.d\.ts$'`) and use TOML's single-quoted literal strings so backslashes survive. A matched message is moved to `issues.json`'s `suppressed` bucket, counted in the build log, and can no longer fail CI.

### What is legitimate

A suppression is a reviewed, human decision, with its reason in a comment beside the rule. An agent never adds one to make a build green. The cases that have earned one:

- **The default `_base` rule.**
- **A second entry point naming the root's types through the package's own name.** A subpath such as `./testing` imports `import type * as Root from "@scope/pkg"`, the package lists itself in `dtsExternals` so the subpath refers to the root's types instead of carrying copies, and API Extractor still reports the root types it reaches as forgotten from that entry. The rule is scoped to that entry and, where it can be, to the exact symbols, and a test over the built declarations pins what it would otherwise hide:

  ```toml
  [package.build]
  dtsExternals = ["@scope/pkg"]

  [package.build.meta.tsdoc]
  suppressWarnings = [
    { messageId = "ae-forgotten-export", pattern = "_base" },
    # ./node names root types through "@scope/pkg"; every one is exported by the root entry. Scoped to node.d.ts only;
    # __test__/declarations.test.ts pins that node.ts names nothing of its own unexported.
    { messageId = "ae-forgotten-export", pattern = 'entry point node\.d\.ts$' },
  ]
  ```

Never legitimate: a `messageId`-only rule, a pattern broad enough to match a symbol not yet written, an `ae-missing-release-tag` you could tag, a `typeof local` forgotten export, or an `ae-incompatible-release-tags`. Each hides a real surface defect.
