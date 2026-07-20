---
"@effected/yaml": minor
---

## Features

### `quoteStyle`: choose the fallback quote character for plain scalars

`YamlStringifyOptions` gains a `quoteStyle` field selecting the quote style used when a `plain`-styled scalar turns out to require quoting. It answers the one question the existing options could not: consumers migrating off the `yaml` npm package ran it with `singleQuote: false` and got double-quoted fallbacks, so every quoted scalar in their files was reformatted on the first write.

```ts
import { Yaml } from "@effected/yaml";

const value = { allowBuilds: { "@parcel/watcher": true } };

yield* Yaml.stringify(value);
// allowBuilds:
//   '@parcel/watcher': true

yield* Yaml.stringify(value, { quoteStyle: "double" });
// allowBuilds:
//   "@parcel/watcher": true
```

The default is `"single"`, so output is byte-identical for every caller that does not opt in. `quoteStyle` governs the plain fallback only: scalars needing no quoting stay plain, and an explicit `defaultScalarStyle` of `"single-quoted"` or `"double-quoted"` still wins. On that plain fallback path, values carrying a tab, a carriage return or any other C0 control character are always emitted double-quoted whichever `quoteStyle` is set, since only double quotes can escape them into a form that round-trips exactly. Mapping keys take the same fallback as values, which is where the reformatting was most visible.

`YamlFormattingOptions` derives the field along with the rest of the stringify options. On the document path it applies to scalars with no style of their own — a value `YamlFormat.modify` just inserted — since composed nodes keep the style they were parsed with.

The new `QuoteStyle` schema (`"single" | "double"`) is exported alongside `ScalarStyle` and `CollectionStyle`.

### `parseSync` and `stringifySync` are now `parseResult` and `stringifyResult`

The two synchronous `Result`-returning entry points take the kit-wide spelling:

```ts
Yaml.parseSync(text, options?)      // -> Yaml.parseResult(text, options?)
Yaml.stringifySync(value, options?) // -> Yaml.stringifyResult(value, options?)
```

Signatures, semantics, return types and error types are unchanged; only the names move. `@effected/jsonc` and `@effected/markdown` already spelled this capability `parseResult` / `stringifyResult`, and `Sync` named a distinction that does not exist — the `Effect` form is synchronous too, so the return type is the only thing that actually differs. The `Sync` suffix is also spoken for elsewhere in the kit, where `@effected/workspaces` uses it for genuinely IO-performing functions that return nullables rather than a `Result`.

### `Yaml.parse` is now defined in terms of `Yaml.parseResult`

`Yaml.parse` previously drove the composer, the failure-record collection and the alias-expansion budget inline, duplicating the engine call that `parseResult` already made — two live copies of one parse path, which is exactly how a fidelity fix lands in one copy and not the other. `Yaml.parse` is now `Effect.fromResult(Yaml.parseResult(...))` behind its existing `Yaml.parse` tracing span, matching `Jsonc.parse`, so `parseResult` is the package's single parse path and the two forms cannot diverge.

This is an internal restructuring: the `Yaml.parse` signature, its error channel and its span are unchanged. The equivalence was verified by differentially comparing the new and previous implementations across all 402 yaml-test-suite fixtures under both `uniqueKeys` settings, plus the alias-expansion bomb, bounded `maxAliasCount`, duplicate-key promotion and C0-control-character inputs. The conformance harness stays at 1226/1226.

## Bug Fixes

### Carriage returns and interior tabs are no longer emitted as plain scalars

`Yaml.stringify` emitted a string containing a carriage return or an interior tab as an unquoted plain scalar. The carriage-return case was silent data corruption: `stringify` produced `cr: has<CR>carriage`, and parsing that back returned `has carriage` — the carriage return normalised to a space, with no error raised on either leg. The tab case round-tripped through this package but produced text other YAML parsers reject outright, `yaml` (via Prettier) reporting `MULTILINE_IMPLICIT_KEY — Implicit keys need to be on a single line`.

The quoting gate tested only `isControlChar`, which deliberately excludes tab (`0x09`) and carriage return (`0x0D`) because the block-scalar and single-quoted-multiline paths can represent both. A leading or trailing tab was already caught by a separate whitespace check, leaving the interior tab and every carriage return unquoted. Both are now tested explicitly at that gate, so such values take the double-quoted fallback and round-trip exactly. Only single-line values reach the gate, so multi-line strings containing tabs still use block scalars as before.

Values containing NUL, bell, escape and the other C0 control characters were already quoted correctly and are unchanged; they now have regression coverage alongside the two fixed cases. The yaml-test-suite conformance harness stays at 1226/1226.

### The merge key is no longer quoted on re-emission

`YamlFormat.format` / `.formatToString` and `YamlDocument#stringify` rewrote a plain `<<` mapping key as `'<<'`. A plain `<<` resolves to `tag:yaml.org,2002:merge` and splices the aliased mapping into its parent; `'<<'` is an ordinary string key that merges nothing. Formatting a document therefore changed what it meant, with no error raised — the output still parsed and still round-tripped, which is why nothing caught it. Merge keys are common in Docker Compose, GitLab CI and Kubernetes manifests, so a format-on-save over a repository of such files silently broke every one of them.

`<<` was reaching the "leading indicator character" branch of the plain-scalar quoting gate. The fix is a carve-out at the mapping-key boundary rather than a relaxation of that gate: a key that is a plain-styled scalar with no tag and no anchor, whose value is exactly `<<`, is emitted plain. Both the block and the flow mapping branches route through one helper, so the two cannot disagree.

The carve-out is deliberately narrow, and reads the key's source style:

- An explicitly quoted `'<<'` or `"<<"` key keeps its quotes — the author wrote a literal string key, and that is preserved.
- `<<` in **value** position is untouched. Plain and quoted resolve to the same string there, so no semantics ride on it.
- The **value path** (`Yaml.stringify` over a plain JS object) still quotes a `"<<"` key. That direction is the mirror image: a JS key `"<<"` carries no merge intent, so emitting it plain would *create* merge semantics the input never had.

This was pre-existing on the `0.4.0` line, not a consequence of the `quoteStyle` work above — verified by running the repro through the pre-change sources, which produce byte-identical output. The yaml-test-suite corpus contains no merge-key fixtures at all (merge is a YAML 1.1 type-repository feature, outside YAML 1.2 core), so conformance was structurally incapable of catching this; coverage is added directly instead. Conformance stays at 1226/1226.
