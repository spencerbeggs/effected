---
"@effected/yaml": minor
---

## Features

### Tag and anchor spans

`YamlScalar`, `YamlMap` and `YamlSeq` gain optional `tagRange` and `anchorRange` fields (both `YamlRange`). They span the tag as written and the `&name` anchor, and are present on nodes read from source.

### Scalar source text

`YamlScalar.sourceText(text)` returns the scalar's text as written: quotes and a block scalar header are included, properties (tag and anchor) never are. Closes #1440.

## Bug Fixes

* An empty scalar that carries a tag or anchor (`a: !!null`, `- &x`, `c: !!str`) is now zero-length immediately after its last property token. Before, it sat at the start of the next line, or at offset 0 at the end of a block. Diagnostics and splices now land on the scalar's own line. The scalar's span changes, which is observable to anyone who relied on the old offset. Closes #1439.
* An empty tagged entry in the middle of a sequence (`- !!str` followed by `- b`) now resolves through its tag (to `""`), as a trailing one already did.
* A document whose root is a lone tagged or anchored empty node (`--- !!str`, `!!null`) now composes an empty scalar that keeps its tag and anchor, instead of `contents: null`.
