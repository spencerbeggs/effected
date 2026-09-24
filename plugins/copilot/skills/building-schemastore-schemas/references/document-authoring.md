# Authoring the document

The emitted document is core's `Schema.toJsonSchemaDocument` output lowered
to Draft-07, assembled into the SchemaStore shape, gated, and written as
canonical JSON. What you control is the Effect Schema and its annotations.
These are the rules that decide whether an annotation ships, whether a
keyword survives the gate, and whether an edit costs a version.

## Annotate at the definition site

An annotation applied at a hoisted schema's *usage* site reaches nothing —
not the `$ref` node, not the `$defs` pool entry — even before the Draft-07
lowering. It silently carries nothing.

```ts
// Reaches nothing: Person is hoisted, so this node becomes a $ref.
const Team = Schema.Struct({
  lead: Person.annotate({ description: "The team lead." }),
});

// Ships: annotate where Person is defined.
const Person = Schema.Struct({ … }).annotate({ description: "A person." });
```

## A `Schema.Class` root is annotated on the `Struct` it wraps

Class-argument or class-level `.annotate()` keys sit on the class node, but
the `$defs` entry is generated from the encoded fields `Struct`. Title,
description and every declared family vanish unless they are on that inner
struct. This is by design in core, not a bug to wait out.

```ts
class ReleaseOutput extends Schema.Class<ReleaseOutput>("ReleaseOutput")(
  Schema.Struct({
    version: Schema.String.annotate({ description: "The released version." }),
  }).annotate({ title: "Release output", description: "…" }),
) {}
```

## The declared keyword families

SchemaStore documents lean on non-standard keywords the editors read, and
ajv strict mode rejects any keyword it does not know. `KeywordFamilies` is the
one owner of what is admitted, in two groups:

**Upstream language-server families** (mirrored from SchemaStore's own
contributing guide):

- **vscode-json-languageservice**, by exact name: `allowTrailingCommas`,
  `defaultSnippets`, `enumDescriptions`, `markdownDescription`,
  `markdownEnumDescriptions`.
- **taplo**: the `x-taplo` prefix (`x-taplo`, `x-taplo-info`, …).
- **tombi**: the `x-tombi-` prefix (`x-tombi-toml-version`,
  `x-tombi-array-values-order`, `x-tombi-table-keys-order`, …).
- **IntelliJ**: the `x-intellij-` prefix (`x-intellij-language-injection`,
  `x-intellij-html-description`, `x-intellij-enum-metadata`).

**The house machine-annotation family** — `x-ai-`, with the trailing dash
(bare `x-ai` and a look-alike like `x-aida-foo` are not declared). It is a
namespace, not a vocabulary: any `x-ai-*` key is declared, and the one
recommended, non-binding key is `x-ai-hint`, a string instruction to a machine
reader about the annotated value. No upstream tool sanctions it, so a
document carrying it is meant for self-hosted publication; submitting it to
schemastore.org needs that repository's own validation-config entry.

Effect Schema annotations accept arbitrary string keys, so
`Schema.String.annotate({ "x-taplo": { … } })` type-checks with no module
augmentation, and the lowering carries the key through in place:

```ts
const Config = Schema.Struct({
  name: Schema.String.annotate({
    description: "The display name.",
    markdownDescription: "The **display** name.",
    "x-taplo": { docs: { main: "The display name." } },
    "x-ai-hint": "Prefer the package name; never invent one.",
  }),
});
```

Rules the gate enforces on a declared-family value:

- The key must be one ajv can register: after the prefix, only
  `[A-Za-z0-9_$:-]`. A dot, space, slash, `@`, `+` or non-ASCII character
  makes the engine reject the whole document as a finding.
- The value must be JSON; anything else fails typed at serialization.
- The value must not contain an `$id` — or a repeated `$anchor` — at **any**
  depth. ajv's reference collection walks unknown keywords looking for them,
  and a collision fails the compile. An empty-string `$id` collides too (it
  resolves to the root id).
- Carried values are shared by reference, not cloned: mutating an `x-ai-hint`
  payload after annotating corrupts every later emission from that schema.
- The `#/definitions` → `#/$defs` rewrite does not descend into a declared
  value; a `$ref`-shaped string inside one means whatever the tool says it
  means.

## An undeclared key fails the build

The declared families are the whole non-standard surface, and the gate is the
package's own — it fails, it does not drop. A target's `jsonSchema` may carry
an `includeAnnotationKey` predicate, but one that admits a key outside the
families fails generation with `UndeclaredAnnotationKeyError`, naming the
document's `$id` and the sorted offending keys. The declared families are
admitted regardless of what that predicate answers, so the predicate's only
remaining role is admitting a key that fails the build. Do not rely on the
lowering to drop a stray key; it preserves custom keywords.

Ask `KeywordFamilies.isDeclared(key)` before annotating with an unfamiliar
key; it is the same predicate the lint and the gate consume.

## Contract versus annotation

`DocumentDiff` classifies the delta between the generated document and the
one on disk, and the drift policy acts on the class. The governing test: a
keyword is a **contract** change when it alters what a validator asserts or
what data a generic tool writes into an instance; a keyword that alters only
advice to a reader — human or machine — is an **annotation**.

| Keyword | Class | Why |
| --- | --- | --- |
| `type`, `required`, `enum`, `pattern`, `additionalProperties`, `$ref`, … | contract | a validator asserts it |
| `default`, `examples`, `readOnly`, `writeOnly` | **contract** | Draft-07 calls them annotations, but a generic tool acts on them (fills a default, generates an example) |
| `title`, `description`, `$comment`, and every declared family (`markdownDescription`, `enumDescriptions`, `defaultSnippets`, `x-taplo`, …) | annotation | advice to a human or an editor |
| `x-ai-*` | annotation | advice to a machine reader; asserts nothing |

Consequences:

- Adopting `x-ai-*` on an already-published, versioned document rewrites
  that file in place under `semantic` — correct, because an annotation is
  transparently replaceable. Under `strict` it is drift.
- Adding a `default` to a published document is a contract change: bump the
  version.
- The asymmetry is deliberate: misreporting a contract change as annotations
  ships a silent break; the reverse costs one unnecessary version bump.
- `x-ai-example` is deliberately not recommended: Draft-07's `examples`
  already exists and classifies as contract, so the two would be two example
  channels with opposite version semantics.

## Objects are closed by default; pin the exception on the target

`StoreDocument.fromSchema` generates under `onExcessProperty: "error"`, so
every object is emitted `additionalProperties: false` — a published document
is a contract, and the package does not follow core's open default.
`jsonSchema` on a `SchemaTarget` (or a `defineConfig`
entry) is forwarded to generation for that target: pin
`{ onExcessProperty: "ignore" }` on the one document that was published
open, because closing it is a contract change the drift policy refuses.
Keeping the option on the target makes the document self-describing. Your
decoders can keep tolerating excess keys — the published document is the
stricter of the two, and that is the contract consumers hold.

## Writes compare content, not bytes

The writer parses both sides and compares structure, so a formatter that
reflows the generated file (a lint-staged Biome pass, say) does not provoke
a rewrite on the next run, and `unchanged` is reachable. Generated files need
no formatter carve-out. An on-disk file that no longer parses is classified
as a contract change and repaired rather than failed, so a corrupted
generated file stays regenerable — under a published label that repair needs
`--force`.

Emitted JSON uses tab indentation, LF line endings, one trailing newline and
insertion-order keys; a non-JSON value in an annotation fails typed instead
of being silently dropped.
