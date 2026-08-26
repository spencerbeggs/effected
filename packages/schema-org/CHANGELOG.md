# @effected/schema-org

## 0.1.0

### Features

- Initial release. schema.org vocabulary as Effect Schema classes, with a&#10;`JsonLdDocument` graph assembler, a script-safe serializer, and offline
  conformance validation against a vendored schema.org v30.0 vocabulary.

```ts
import { JsonLdDocument, NodeRef, SoftwareSourceCode, TechArticle } from "@effected/schema-org";
import { Result } from "effect";

const built = JsonLdDocument.buildResult([
  SoftwareSourceCode.make({ "@id": "https://example.com/pkg#source", name: "example", version: "1.2.3" }),
  TechArticle.make({
    "@id": "https://example.com/pkg/docs#intro",
    headline: "Getting started </script>",
    isPartOf: [NodeRef.to("https://example.com/pkg#source")],
  }),
]);

console.log(Result.getOrThrow(built).toScriptBody());
```

- `toScriptBody()` is the only text serializer, and it escapes `<`, `>` and `&`&#10;after stringify — `JSON.stringify` does not escape `<`, so a description
  containing a literal `</script>` would otherwise close the JSON-LD block early
  and inject markup into the page.

- Six node classes ship from the root entrypoint: `SoftwareSourceCode`,&#10;`TechArticle`, `APIReference`, `Person`, `Organization`, `CreativeWork`, plus&#10;`NodeRef`/`NodeId`/`JsonLdDocument`.

#### Offline conformance validation

- Offline conformance checking against the vendored vocabulary lives behind a
  separate `./validate` subpath, so a consumer that only builds and serializes
  graphs never pays for the \~75 KB vocabulary table:

```ts
import { Conformance, Vocabulary } from "@effected/schema-org/validate";

console.log(Vocabulary.version); // "30.0"
for (const issue of Conformance.check(doc)) console.error(issue._tag, issue.message);
```

- `Conformance.check` reports `UnknownTerm`, `PropertyNotOnType`,&#10;`DeprecatedType`, `DeprecatedProperty` and `DanglingReference` issues;&#10;`Conformance.validate`/`validateResult` gate on the structural kinds by
  default and raise `NonConformantGraphError`. [#539][#539]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#539]: https://github.com/spencerbeggs/effected/pull/539
