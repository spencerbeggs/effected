# Confinement, dependency choices, and the reachability walker

Load when: auditing why a dependency is (or isn't) declared in
`@effected/sbom`, or debugging a reachability-suite false result.

## Never introduce a namespace object

An `Sbom = { generate, sign }` convenience object would make every
SBOM-only consumer reachable to Fulcio's HTTP stack, silently — the same
config-codec barrel hazard with sharper teeth, because here the extra
weight is a live network client, not just bundle size. A reachability test
measures the confinement with a control (the signer *does* reach the
Sigstore libraries) so the suite can fail meaningfully rather than passing
vacuously.

- **`@sigstore/*` is confined to the signer module only.** The bundle
  module that defines the wire shape imports **nothing** from
  `@sigstore/*` — its media-type constant is written out as a literal and
  checked against the Sigstore library's own constant in the signer's test
  file, the one place allowed to import it.
- **`SbomMetadataSource` imports `Package` as a type only.** A value import
  would put `@effected/package-json` — and its `FileSystem` IO module — on
  the runtime graph of an otherwise-pure half of the package; the
  reachability suite asserts the exact edge set.

## The reachability walker strips LINE comments before BLOCK comments, deliberately

This package's own prose contains the literal token for the Sigstore
package pattern, whose `/*`-shaped substring opens a block comment as far
as a naive regex is concerned. Stripping blocks first would delete
everything from that word to the next doc comment's close — imports
included — and report a module that imports `effect` as importing nothing
at all. That failure mode is the *safe* direction for most checks, but the
*worst* one for a confinement test, which exists to catch exactly this
kind of silent broadening. Order the stripping line-comments-first, and
give the stripper its own discriminating test.

## Why `@cyclonedx/cyclonedx-library` is absent, and when that reverses

An off-the-shelf CycloneDX library is several megabytes with multiple
optional peers, for perhaps ten symbols this package actually uses — an
object model and a JSON normalizer. The parts that earn that weight (XML
output, schema validation via a bundled validator, SPDX expression
parsing) are exactly the parts an emitter never calls, and its SPDX-parsing
peer would install a second SPDX engine beside `@effected/spdx`. Recorded
reversal triggers: CycloneDX **XML** output, or *consuming and validating*
third-party BOMs — neither is anyone's need today. Revisit the decision
explicitly if either becomes true; don't quietly add the dependency back
for a narrower need it wasn't chosen to serve.

## `@sigstore/sign` + `@sigstore/bundle` are taken outright

Real cryptography and a wire protocol against Fulcio and Rekor —
re-implementing either is a security defect, not a bug worth avoiding a
dependency over. The lesson from the CycloneDX decision is confinement, not
avoidance: keep the heavy, correct dependency, and keep it reachable from
exactly one module.
