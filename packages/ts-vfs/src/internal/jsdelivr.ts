import { Schema } from "effect";
import type { PackageSpec } from "../PackageSpec.js";

/** Base URL for the jsDelivr data/metadata API. */
export const DATA_API = "https://data.jsdelivr.com/v1";

/** Base URL for the jsDelivr file-serving CDN. */
export const CDN = "https://cdn.jsdelivr.net";

/** Matches TypeScript declaration file names (`.d.ts`, `.d.mts`, `.d.cts`, …). */
export const TYPE_FILE_PATTERN = /\.d\.([^.]+\.)?[cm]?ts$/i;

/** The package metadata endpoint: versions and dist-tags. */
export const versionsUrl = (name: string): string => `${DATA_API}/package/npm/${name}`;

/** The flat file-tree endpoint for a pinned package version. */
export const fileTreeUrl = (pkg: PackageSpec): string => `${DATA_API}/package/npm/${pkg.name}@${pkg.version}/flat`;

/** The CDN URL for one file of a pinned package version. */
export const fileUrl = (pkg: PackageSpec, filePath: string): string =>
	`${CDN}/npm/${pkg.name}@${pkg.version}/${filePath.replace(/^\/+/, "")}`;

/** The CDN URL for a pinned package version's `package.json`. */
export const packageJsonUrl = (pkg: PackageSpec): string => fileUrl(pkg, "package.json");

/**
 * The `/package/npm/:name` response: published versions plus dist-tags.
 * Lenient — only the two fields the resolver reads.
 */
export const VersionsResponse = Schema.Struct({
	versions: Schema.Array(Schema.String),
	tags: Schema.Record(Schema.String, Schema.String),
});

/**
 * The `/package/npm/:pkg@:version/flat` response. `default` is metadata only
 * (`null` for packages that declare none, e.g. `ink`); the loader consumes
 * `files`, never `default`.
 */
export const FileTreeResponse = Schema.Struct({
	default: Schema.NullOr(Schema.String),
	files: Schema.Array(Schema.Struct({ name: Schema.String })),
});
