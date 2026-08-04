# SBOM emission and NTIA compliance

Load when: emitting a CycloneDX SBOM, deriving metadata from a package
manifest, checking the seven NTIA minimum elements, or debugging a license
or purl field in the emitted document.

## Emit — `Sbom.generate` / `Sbom.toJson` / `Sbom.write`

Both `generate` and `toJson` are **total, plain functions — no error
channel**. `write` is the package's only IO, over core `FileSystem`:

```ts
import { Sbom, SbomMetadataSource } from "@effected/sbom";

const root = SbomMetadataSource.rootComponent(pkg, { supplier, timestamp });
const metadata = SbomMetadataSource.fromPackage(pkg, { supplier, timestamp });
const document = Sbom.generate({ root, components, metadata });
const json = Sbom.toJson(document); // total — no yield*, no layer
yield* Sbom.write(document, sbomPath); // the one fallible member; FileSystem in R
```

`generate` sorts `components` by name so two runs over the same inputs
produce the same bytes — the document's digest becomes an attestation
subject later in the pipeline, and reordering it between runs would change
that digest for no reason.

`SbomMetadataSource` derives from a `Package` manifest. `supplier`,
`authors` and `timestamp` are **explicit-only** — a manifest says who wrote
the software, never who supplied it, who assembled the BOM, or when;
deriving any of them would fabricate three of the seven NTIA elements.
`Package` is imported into `SbomMetadataSource` as a **type only** — see
`references/bundler-notes.md` for why. The package entrypoint re-exports
`Package`, `Person` and `Repository` from `@effected/package-json`, so a
consumer constructing metadata inputs imports them from `@effected/sbom`
without adding the `package-json` edge itself.

## Check `NtiaReport` — the seven minimum elements

`NtiaReport.of(document)` is **total** — it returns a report for every
input, including one that satisfies nothing:

```ts
import { NtiaReport } from "@effected/sbom";
import { Effect } from "effect";

const report = NtiaReport.of(document);
if (!report.compliant) yield* Effect.logWarning(`SBOM missing: ${report.missing.join(", ")}`);
```

`compliant` and `missing` are derived getters, not a pass/fail assertion —
a caller wanting a hard gate writes its own `Effect.fail` at its own
boundary. `id` is a stable literal union (`supplierName`, `componentName`,
`componentVersion`, `uniqueIdentifier`, `dependencyRelationship`,
`sbomAuthor`, `timestamp`) — a consumer branches on `id`, never on a
rendered name; there is no `suggestion` field, because a library cannot
know a consumer's remediation config.

## The license-rendering traps

**A license is an expression field, and CycloneDX renders three shapes.**
`MIT`, `MIT OR Apache-2.0` and `UNLICENSED` are all legal `package.json`
`license` values. The schema constrains `license.id` to the SPDX identifier
enumeration, so emitting every value as `{ license: { id } }` produces a
document that looks right and fails validation. The emitter picks between
three shapes:

| Input | Emitted | Chosen by |
| --- | --- | --- |
| a catalog identifier (`MIT`) | `[{ license: { id } }]` | `License.isKnownId` |
| an expression (`MIT OR Apache-2.0`) | `[{ expression }]` — a one-element tuple | `isValidExpression` |
| anything else (`UNLICENSED`, `SEE LICENSE IN …`) | `[{ license: { name } }]` | neither |

The expression tuple is exclusive (`maxItems: 1`), so an expression among
several licenses degrades to a named license rather than an invalid
document. The id-versus-expression question is `@effected/spdx`'s
(`License.isKnownId`, `isValidExpression`) — **never** a local regex.

**The purl is `pkg:npm/%40scope/name@version`.** The scope is the purl
**namespace**, not part of the name: the `@` is percent-encoded, the
separating slash stays literal — the package-url spec's own npm roundtrip
vector. Encoding the whole name naively collapses that slash and parses
back as a namespace-less name — a real bug this emitter had to fix.
Versions pass through verbatim — every character semver permits is a legal
path character, so encoding them would only produce a longer string
meaning the same thing.

## Three error channels the port deleted, and why they could not fire

`Sbom.generate`/`toJson` used to have an error channel possible only
because a third-party CycloneDX library might throw — a possibility
introduced by that dependency, not by the model. A SLSA-building error
guarded string interpolation over claims that were already present and
validated. NTIA's "dependency relationship" check used to test for
`undefined` against a field this model declares **required** — a check
that cannot fail. Owned models built over validated schema classes cannot
fail this way, so all three became plain functions. Generalize the rule:
**audit every ported error channel for whether it can actually fire** —
three unreachable channels in one source package is a pattern, not a
coincidence.

**The oracle rule for ported cryptography and encodings**: when an
implementation and a remembered constant disagree, neither is the oracle —
climb to a **published** intermediate (the package-url spec's own roundtrip
vectors, in the purl case) and export the internal steps so the oracle
stays external. Never pin your own output as the fixture; derive
conformance expectations from a vendored, published schema rather than
hand-writing them.
