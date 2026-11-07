import { Effect, Schema } from "effect";

/**
 * The registry protocol families this reader knows how to do more than link
 * to. `"npm"` means an npm-compatible registry — install commands and tarball
 * fetching work against any instance of it — and `"jsr"` the jsr protocol.
 *
 * @remarks
 * The manifest's `type` field is deliberately NOT constrained to these
 * values: unknown future types must degrade to link-only rendering, not
 * reject the manifest. Use {@link isKnownRegistryType} to branch.
 *
 * @public
 */
export const KNOWN_REGISTRY_TYPES = ["npm", "jsr"] as const;

/**
 * A registry protocol family this reader recognizes.
 *
 * @public
 */
export type KnownRegistryType = (typeof KNOWN_REGISTRY_TYPES)[number];

/**
 * Whether a registry `type` value is a protocol family this reader
 * recognizes. `false` means the registry entry should degrade to link-only
 * rendering — it is never a validation failure.
 *
 * @public
 */
export function isKnownRegistryType(type: string): type is KnownRegistryType {
	return (KNOWN_REGISTRY_TYPES as ReadonlyArray<string>).includes(type);
}

/**
 * One registry the documented package is published to.
 *
 * @remarks
 * `type` is the PROTOCOL FAMILY (`"npm"` covers every npm-compatible
 * registry), `name` the human instance label, `url` the package's page on
 * that instance. Unknown `type` values decode successfully and degrade to
 * link-only rendering (see {@link isKnownRegistryType}).
 *
 * @public
 */
export const RegistryRef = Schema.Struct({
	/** The protocol family, e.g. `"npm"` or `"jsr"`. Unknown values are accepted. */
	type: Schema.String,
	/** The human instance label, e.g. `"npm"` or `"Savvy Web Registry"`. */
	name: Schema.String,
	/** The package's URL on that registry instance. */
	url: Schema.String,
});

/**
 * The decoded type of {@link (RegistryRef:variable)}.
 *
 * @public
 */
export type RegistryRef = typeof RegistryRef.Type;

/**
 * One Open Graph image declared by the manifest.
 *
 * @remarks
 * Exactly ONE of `path` (a bundle-relative asset the consuming platform
 * publishes and resolves to a URL) or `url` (an absolute external URL used
 * verbatim) must be present — the schema enforces the XOR. `type` is a MIME
 * type, inferred from the file extension by the resolver when omitted; `alt`
 * has a documented inference chain (tagline → description →
 * `"<name> API documentation"`).
 *
 * @public
 */
export const OpenGraphImage = Schema.Struct({
	/** Bundle-relative asset path. Mutually exclusive with `url`. */
	path: Schema.optionalKey(Schema.String),
	/** Absolute external URL, used verbatim. Mutually exclusive with `path`. */
	url: Schema.optionalKey(Schema.String),
	/** MIME type; inferred from the extension when omitted. */
	type: Schema.optionalKey(Schema.String),
	/** Pixel width; 1200×630 (1.91:1) is the cross-platform safe default. */
	width: Schema.optionalKey(Schema.Int),
	/** Pixel height. */
	height: Schema.optionalKey(Schema.Int),
	/** Alt text; inferred (tagline → description → fallback) when omitted. */
	alt: Schema.optionalKey(Schema.String),
}).check(
	Schema.makeFilter(
		(image) =>
			(image.path === undefined) !== (image.url === undefined)
				? undefined
				: 'exactly one of "path" or "url" must be present',
		{ title: "openGraph image source" },
	),
);

/**
 * The decoded type of {@link (OpenGraphImage:variable)}.
 *
 * @public
 */
export type OpenGraphImage = typeof OpenGraphImage.Type;

/**
 * The manifest's Open Graph block: the asset-ish pieces only — most OG tags
 * are page-level and derive at render time in the consuming platform.
 *
 * @remarks
 * Multiple images follow OG array semantics: the first declared wins, extras
 * are alternates (e.g. a portrait 1000×1500 variant).
 *
 * @public
 */
export const OpenGraphConfig = Schema.Struct({
	/** Declared images, first-wins per OG array semantics. */
	images: Schema.optionalKey(Schema.Array(OpenGraphImage)),
	/** Embed accent color (e.g. Discord), a CSS color string. */
	themeColor: Schema.optionalKey(Schema.String),
});

/**
 * The decoded type of {@link (OpenGraphConfig:variable)}.
 *
 * @public
 */
export type OpenGraphConfig = typeof OpenGraphConfig.Type;

/**
 * A pointer to the bundle's SBOM, computed by the bundler at publish and
 * served as a downloadable static asset.
 *
 * @public
 */
export const SbomRef = Schema.Struct({
	/** Bundle-relative path to the SBOM file. */
	path: Schema.String,
	/** SBOM format label, e.g. `"spdx-json"`. Unknown values are accepted. */
	format: Schema.optionalKey(Schema.String),
});

/**
 * The decoded type of {@link (SbomRef:variable)}.
 *
 * @public
 */
export type SbomRef = typeof SbomRef.Type;

/**
 * The inherited project tier, flattened into the emitted manifest by the
 * bundler (a fetched bundle has no parent directory to walk). Kept nested —
 * structurally distinguishable from the leaf fields — because provenance is
 * load-bearing for override detection.
 *
 * @public
 */
export const ProjectIdentity = Schema.Struct({
	/** The project display name, e.g. `"Effected"` over leaf `@effected/store`. */
	name: Schema.optionalKey(Schema.String),
	/** The project tagline. */
	tagline: Schema.optionalKey(Schema.String),
});

/**
 * The decoded type of {@link (ProjectIdentity:variable)}.
 *
 * @public
 */
export type ProjectIdentity = typeof ProjectIdentity.Type;

/**
 * The versioned `tsdoctor.json` sidecar manifest — bundle layer 3.
 *
 * @remarks
 * `spec` is the only required field; every other field enriches. Unknown
 * top-level fields are ignored on decode (additive fields are minor spec
 * revisions) and unknown enum-ish values (registry `type`, sbom `format`)
 * degrade gracefully instead of rejecting — an old reader must be able to
 * consume a new bundle.
 *
 * @public
 */
export const BundleManifest = Schema.Struct({
	/** The integer spec version. This reader understands spec 1. */
	spec: Schema.Literal(1),
	/** Human display name (the npm name is dry; this one is SEO-friendly). */
	name: Schema.optionalKey(Schema.String),
	/** Short tagline. */
	tagline: Schema.optionalKey(Schema.String),
	/** Long description; overrides the package.json description when present. */
	description: Schema.optionalKey(Schema.String),
	/** The inherited project tier, flattened in at emit time. */
	project: Schema.optionalKey(ProjectIdentity),
	/** Open Graph assets. */
	openGraph: Schema.optionalKey(OpenGraphConfig),
	/** SBOM pointer. */
	sbom: Schema.optionalKey(SbomRef),
	/** Registries the package is published to. */
	registries: Schema.optionalKey(Schema.Array(RegistryRef)),
});

/**
 * The decoded type of {@link (BundleManifest:variable)}.
 *
 * @public
 */
export type BundleManifest = typeof BundleManifest.Type;

/**
 * Raised when a present `tsdoctor.json` cannot be parsed or does not satisfy
 * the {@link (BundleManifest:variable)} schema.
 *
 * @remarks
 * Absence of the manifest is NEVER this error — layers enrich, never gate,
 * so a missing sidecar is the normal case and reads as `Option.none()`.
 *
 * @public
 */
export class BundleManifestError extends Schema.TaggedError<BundleManifestError>()("BundleManifestError", {
	/** The manifest file path, when the failure is tied to a file on disk. */
	path: Schema.optionalKey(Schema.String),
	/** The underlying failure (JSON syntax or schema decode), preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const where = this.path !== undefined ? ` at ${this.path}` : "";
		return `Invalid tsdoctor.json manifest${where}`;
	}
}

/**
 * Decode an unknown value into a {@link (BundleManifest:type)}.
 *
 * @remarks
 * The typed boundary for manifest input that has already been parsed from
 * JSON (plugin options, fetched payloads). File-based reading lives in
 * `readBundle`, which routes through this after parsing.
 *
 * @public
 */
export function decodeBundleManifest(
	input: unknown,
	path?: string,
): Effect.Effect<BundleManifest, BundleManifestError> {
	return Schema.decodeUnknownEffect(BundleManifest)(input).pipe(
		Effect.mapError((cause) => new BundleManifestError({ ...(path !== undefined ? { path } : {}), cause })),
	);
}

/**
 * The manifest spec version this package reads and writes.
 *
 * @public
 */
export const MANIFEST_SPEC = 1 as const;

/**
 * The sidecar manifest's file name inside a bundle folder.
 *
 * @public
 */
export const TSDOCTOR_MANIFEST_FILENAME = "tsdoctor.json";

/**
 * Encode a {@link (BundleManifest:type)} into the JSON-ready value a writer
 * serializes as `tsdoctor.json`.
 *
 * @remarks
 * The writer's boundary. Going through the schema rather than
 * `JSON.stringify` means an emitted file is by construction what
 * {@link decodeBundleManifest} accepts.
 *
 * @public
 */
export function encodeBundleManifest(manifest: BundleManifest): Effect.Effect<unknown, BundleManifestError> {
	return Schema.encodeEffect(BundleManifest)(manifest).pipe(
		Effect.mapError((cause) => new BundleManifestError({ cause })),
	);
}
