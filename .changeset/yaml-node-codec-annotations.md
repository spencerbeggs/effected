---
"@effected/yaml": minor
---

## Breaking Changes

### `YamlNode`'s recursive references are typed as codecs

The recursive references in the node model were annotated as type-only schemas, which discarded the encoded side of the codec and made `YamlNode` the odd one out against the `@effected/toml` and `@effected/markdown` node models.

They are now codecs carrying both sides. The exported `YamlNode` value's type changes accordingly, so an explicit annotation naming the old form no longer matches:

```ts
// before
const node: Schema.Schema<YamlScalar | YamlMap | YamlSeq | YamlAlias> = YamlNode;

// after
const node: typeof YamlNode = YamlNode;
```

Code that consumes `Yaml.parse`, `YamlFormat` or the node classes without annotating the schema value itself is unaffected.

## Features

* `YamlScalarEncoded`, `YamlMapEncoded`, `YamlSeqEncoded` and `YamlAliasEncoded` are exported — the encoded companions of the four node classes, usable wherever the encoded side needs naming
