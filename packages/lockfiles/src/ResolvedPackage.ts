import { Effect, Schema } from "effect";

const EMPTY_DEPENDENCIES: { readonly [name: string]: string } = {};

/**
 * A package resolved from a lockfile.
 *
 * @remarks
 * The common shape every format's entries normalize into:
 *
 * - `name` — the resolved package name. For pnpm *workspace* packages
 *   straight out of `Lockfile.parse` this is the importer path until
 *   `Lockfile#withImporterNames` rewrites it.
 * - `version` — the resolved version string (pnpm workspace packages carry
 *   `"0.0.0"`; the lockfile does not record their real versions).
 * - `integrity` — optional SRI integrity hash (npm/pnpm `sha512-...`, yarn
 *   Berry checksum).
 * - `isWorkspace` — `true` for workspace-local packages.
 * - `relativePath` — the workspace-relative directory for workspace
 *   packages, when the lockfile records one.
 * - `dependencies` — the package's own dependency map, defaulting to `{}`
 *   both at construction and when decoding serialized data.
 *
 * @public
 */
export class ResolvedPackage extends Schema.Class<ResolvedPackage>("ResolvedPackage")({
	name: Schema.NonEmptyString,
	version: Schema.String,
	integrity: Schema.optionalKey(Schema.String),
	isWorkspace: Schema.Boolean,
	relativePath: Schema.optionalKey(Schema.String),
	dependencies: Schema.Record(Schema.String, Schema.String).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(EMPTY_DEPENDENCIES)),
		Schema.withConstructorDefault(Effect.succeed(EMPTY_DEPENDENCIES)),
	),
}) {}
