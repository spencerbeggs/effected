/**
 * Software-supply-chain artifacts as Effect schemas: a CycloneDX 1.6 SBOM, the
 * NTIA minimum-elements report, in-toto statements and SLSA provenance, and
 * Sigstore DSSE signing.
 *
 * The SBOM half is pure and reaches no external dependency; only
 * `SigstoreSigner` imports `@sigstore/*`, so a consumer that emits an SBOM
 * never pulls Fulcio's transport into its bundle. That confinement is asserted
 * structurally in `__test__/reachability.test.ts`.
 *
 * @packageDocumentation
 */

export { Sbom, type SbomInput, type SbomJsonOptions, SbomWriteError } from "./Sbom.js";
export {
	Component,
	ComponentType,
	Contact,
	ExternalReference,
	ExternalReferenceType,
	SbomDocument,
	SbomMetadata,
	Supplier,
} from "./SbomDocument.js";
export {
	type ComponentInput,
	type CopyrightYears,
	type SbomMetadataOptions,
	SbomMetadataSource,
} from "./SbomMetadataSource.js";
