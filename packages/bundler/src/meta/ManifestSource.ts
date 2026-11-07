import { Effect, Schema } from "effect";
import { BundleManifest, BundleManifestError } from "./BundleManifest.js";

/**
 * The shape an author checks in as a `tsdoctor.json` SOURCE file, at a
 * package root (the leaf tier) or a workspace root (the project tier).
 *
 * @remarks
 * `BundleManifest` minus `spec` and `project`: a source file never declares
 * its own spec version, and it never declares its inherited tier — the
 * bundler supplies both when it flattens the hierarchy at emit time. Decoded
 * only by writers; readers never see this shape.
 *
 * @public
 */
export const ManifestSource = Schema.Struct({
	name: BundleManifest.fields.name,
	tagline: BundleManifest.fields.tagline,
	description: BundleManifest.fields.description,
	openGraph: BundleManifest.fields.openGraph,
	sbom: BundleManifest.fields.sbom,
	registries: BundleManifest.fields.registries,
});

/**
 * The decoded type of {@link (ManifestSource:variable)}.
 *
 * @public
 */
export type ManifestSource = typeof ManifestSource.Type;

/**
 * Decode an unknown value into a {@link (ManifestSource:type)}.
 *
 * @public
 */
export function decodeManifestSource(
	input: unknown,
	path?: string,
): Effect.Effect<ManifestSource, BundleManifestError> {
	return Schema.decodeUnknownEffect(ManifestSource)(input).pipe(
		Effect.mapError((cause) => new BundleManifestError({ ...(path !== undefined ? { path } : {}), cause })),
	);
}
