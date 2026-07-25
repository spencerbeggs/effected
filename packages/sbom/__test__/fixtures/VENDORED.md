# Vendored: CycloneDX 1.6 JSON schema

| | |
| --- | --- |
| File | `bom-1.6.SNAPSHOT.schema.json` |
| Schema `$id` | `http://cyclonedx.org/schema/bom-1.6.schema.json` |
| Source | `@cyclonedx/cyclonedx-library@10.1.0`, `res/schema/bom-1.6.SNAPSHOT.schema.json` |
| Upstream | <https://github.com/CycloneDX/cyclonedx-javascript-library> |
| License | Apache-2.0 |
| Pinned | 2026-07-25 |

## Why this is here

`@effected/sbom` [declines the CycloneDX library as a runtime dependency](../../../../.claude/design/effected/packages/sbom.md#tier-and-the-dependency-decision) — 6.6 MB with seven optional peers, for an object model and a JSON normalizer we can emit directly. Declining the *library* is not the same as declining the *specification*, so the published schema is vendored here as a **test-only conformance oracle**.

The filename says `SNAPSHOT` because that is what the library ships; the `$id` inside is the released `bom-1.6.schema.json`.

## How it is used

`__test__/conformance.test.ts` reads this file and derives its expectations from it — `required` arrays, `enum` members, property names — rather than hand-writing them. That is what makes it an oracle: a wrong `externalReference.type`, a missing `required` field or a renamed property fails against the specification itself, not against a copy of our own assumptions.

It is **targeted conformance over the subset we emit**, not full JSON-schema validation. Full validation would need a validator (`ajv`), and taking one as a devDependency to check output we fully control is the weight this package exists to avoid. The subset is the whole of what the emitter produces, so nothing we write is unchecked.

## Updating

Re-pin when targeting a new CycloneDX version. Per the settled ruling the emitter is **1.6-only** — there is no 1.5 path and no version option — so a new spec version is a deliberate migration, not an added branch.
