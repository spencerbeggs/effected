---
"@effected/yaml": minor
---

## Breaking Changes

### Comments moved from `YamlPair` onto the key and value nodes

`YamlPair` no longer carries `commentBefore`, `comment` or `spaceBefore` — it is `key` and `value`, nothing else. Every other node class (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlAlias`) carries the full triple. Code that read `pair.comment` must now read it off `pair.key` or `pair.value`:

```ts
// before
const trailing = pair.comment;

// after
const trailing = pair.value?.comment ?? pair.key.comment;
```

`YamlAlias` gaining the triple is also a fix: alias comments were previously dropped entirely, both on capture and on emission, and now round-trip.

Attribution follows one rule: an own-line comment above an entry leads that entry's **key** node; a trailing comment belongs to the last node on its line — the value when the value ends the line (`a: 1 # t`), the key when the value renders below it (`push: # only main`).

### `YamlDocument` comment fields renamed

- `comment` (the leading header block) is now `commentBefore`
- `commentAfter` (the trailing block) is now `comment`

These now match the names the node classes use. Attribution is marker-aware: `commentBefore` is a header sitting ahead of a `---` marker; a header after the marker leads the root node; a header with no marker leads the first entry's key.

## Bug Fixes

* A document-root block scalar's header comment (`| # note`) had no emission path and was silently dropped on format — now emitted across the bare, `---`, and tag/anchor spellings (#349)
* The explicit-key branch of the block-mapping stringifier never emitted the value's own leading comment, losing it on a single format pass (#348)
* A mapping whose last pair had a null value swallowed the terminal comment while looking for a value that wasn't there, on ordinary YAML like `x:\n# c\n` (#348)
* A flow collection whose closing bracket sits at column 0 (`x: {\n  a: 1\n}`) was rejected; a closing bracket is not content and the spec sets no indentation floor on it (#340)
* A document header comment above a `---` marker was stored as the document's *trailing* comment, so every format pass relocated it below the marker. Headers on both sides of a marker were merged into one block and emitted above it; each now keeps its own side
* An entry carrying trailing comments on both its key and its value below (`a: # kc` / `  1 # vc`) emitted only the key's, hoisting the value onto the key's line and dropping its comment
* An inline flow collection carrying a trailing comment (`a: {b: 1} # t`) was expanded into a multi-line flow with the comment moved inside the brackets. A comment after the closing bracket cannot swallow it, so only a comment *inside* forces that layout now
* A header comment over a scalar document root was dropped unless the document had a `---` marker; the emission slot was gated on the marker
* An after-marker comment was discarded when the document had no content and a pre-marker header already existed (`# a\n---\n# b\n` kept only `# a`)
* A blank line below an after-marker comment was attributed to the pre-marker block, moving it across the marker and never reaching a fixed point
* Under a value's leading comment block, the value's own trailing comment was printed on the key's line instead of its own (`a:\n  # lead\n  1 # vc`)
* A trailing comment on an alias key (`*x : # c`) collapsed onto the value's line; an alias key emits in implicit form, so it owns its line like any scalar key

Both `push: # only main` and an own-line comment above a value now round-trip byte-intact through a format pass. Previously the two source shapes collapsed to the same AST, so formatting one always rewrote it into the other.
