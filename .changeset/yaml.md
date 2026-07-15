---
"@effected/yaml": minor
---

## Features

Zero-dependency YAML 1.2 parsing, editing and formatting expressed as Effect schemas and pure functions. Parse a single document or a multi-document stream into plain values or an offset-preserving AST, resolve anchors and aliases, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema. The lexer, CST parser, composer and stringifier are vendored into the package with attribution — `effect` is the only runtime dependency.

### Decode straight into a domain schema

`Yaml.schema` composes with your own `Schema`; `Yaml.stringify` goes the other way, failing typed on circular references rather than throwing.

```ts
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromYaml = Yaml.schema(Config);

const program = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(ConfigFromYaml)("port: 3000 # dev server");
});

Effect.runPromise(program).then(console.log);
// { port: 3000 }
```

### Hostile input fails typed

An alias bomb — nested anchors whose expansion multiplies at every level — is bounded by an expansion budget and surfaces as a `YamlParseError`, not an out-of-memory kill. Collection nesting past the depth cap yields a `NestingDepthExceeded` diagnostic instead of a stack overflow, and `Yaml.stringify` caps the mirror-image recursion when encoding back to text.

```ts
import { Yaml } from "@effected/yaml";
import { Effect } from "effect";

const bomb = ["a: &a [x,x,x,x,x,x,x,x,x]", "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]", "z: [*g,*g,*g,*g,*g,*g,*g,*g,*g]"].join("\n");

Effect.runPromise(Effect.result(Yaml.parse(bomb))).then(console.log);
// Failure with YamlParseError, whose `diagnostics` carry:
// { code: "AliasCountExceeded", message: "Alias expansion exceeded budget of ... nodes" }
```

`Yaml.parse` / `Yaml.parseAll` recover single documents or `---`-separated streams into plain values, aggregating every diagnostic into one `YamlParseError`. `YamlNode` is the offset-preserving AST (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`); `YamlDocument` adds the recovered `errors` and `warnings`; `YamlEdit` / `YamlFormat` compute comment-preserving edits; and `YamlVisitor` streams AST events. Every fallible entry point carries a real error channel — nothing reaches your process as a defect.
