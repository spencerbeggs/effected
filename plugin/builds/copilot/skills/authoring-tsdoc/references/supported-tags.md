# Supported tags

The build writes a `tsdoc.json` beside the package that enables the whole `@microsoft/tsdoc` standard tag set, marks every one of those tags supported, reports unsupported HTML elements, and adds any tags registered under `[package.build.meta.tsdoc] tagDefinitions`. Those are the only tags that do not raise `tsdoc-undefined-tag`. The file is generated: edit `effected.toml`, never `tsdoc.json`.

The authority is `StandardTags.allDefinitions` in the installed `@microsoft/tsdoc`. The list below is that set; links go to the tsdoc.org reference.

## Release tags (modifier)

`@public`, `@internal`, `@beta`, `@alpha`, `@experimental`. The policy is in [release-tags.md](release-tags.md); API Extractor reads `@experimental` as `@beta`, so write `@beta`.

## Block tags

| Tag | Use |
| --- | --- |
| [`@remarks`](https://tsdoc.org/pages/tags/remarks/) | the detail after the one-line summary |
| [`@param`](https://tsdoc.org/pages/tags/param/) | `@param name - description` |
| [`@typeParam`](https://tsdoc.org/pages/tags/typeparam/) | `@typeParam T - description` |
| [`@returns`](https://tsdoc.org/pages/tags/returns/) | the return value, with no `{Type}` |
| [`@throws`](https://tsdoc.org/pages/tags/throws/) | a condition under which the member throws |
| [`@example`](https://tsdoc.org/pages/tags/example/) | one worked example per tag |
| [`@defaultValue`](https://tsdoc.org/pages/tags/defaultvalue/) | the default of an optional property |
| [`@deprecated`](https://tsdoc.org/pages/tags/deprecated/) | deprecation, with the replacement to use |
| [`@privateRemarks`](https://tsdoc.org/pages/tags/privateremarks/) | maintainer notes, stripped from published docs |
| [`@see`](https://tsdoc.org/pages/tags/see/) | a cross-reference |
| [`@decorator`](https://tsdoc.org/pages/tags/decorator/) | a decorator the declaration carries |
| `@jsx`, `@jsxRuntime`, `@jsxFrag`, `@jsxImportSource` | JSX pragmas; `/** @jsxRuntime automatic */` heads a `.tsx` file run from source |

## Inline tags

| Tag | Use |
| --- | --- |
| [`@link`](https://tsdoc.org/pages/tags/link/) | `{@link Target}`; resolution rules are in `effect-api-extractor-bases` |
| [`@inheritDoc`](https://tsdoc.org/pages/tags/inheritdoc/) | `{@inheritDoc Target}`, copying another declaration's docs |
| [`@label`](https://tsdoc.org/pages/tags/label/) | names a declaration for a `{@link}` selector |

## Modifier tags

| Tag | Use |
| --- | --- |
| [`@packageDocumentation`](https://tsdoc.org/pages/tags/packagedocumentation/) | the entry's own doc comment: first in each export entry's file, and nowhere else |
| [`@readonly`](https://tsdoc.org/pages/tags/readonly/) | read-only to consumers, though the type does not say so |
| [`@sealed`](https://tsdoc.org/pages/tags/sealed/) | must not be extended or overridden |
| [`@virtual`](https://tsdoc.org/pages/tags/virtual/) | may be overridden |
| [`@override`](https://tsdoc.org/pages/tags/override/) | overrides an inherited member |
| [`@eventProperty`](https://tsdoc.org/pages/tags/eventproperty/) | a property that is an event |

## Not supported

Every JSDoc-only tag raises `tsdoc-undefined-tag`: `@class`, `@function`, `@module`, `@memberof`, `@augments`, `@extends`, `@type`, `@typedef`, `@property`, `@callback`, `@since`, `@category`, `@author`, `@version`. Omit what the declaration already says; register a project tag that carries real information ([custom-tags-and-suppression.md](custom-tags-and-suppression.md)).
