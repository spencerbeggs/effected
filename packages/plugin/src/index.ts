/**
 * The effected carrier. Installing it provides the `effected` command and the
 * `effected-mcp` server, each reporting that it came through this package, and
 * the authoring surface of a `schemastore.config.ts`.
 *
 * @remarks
 * The published package carries its own copy of `@effected/schemastore`, inside
 * the same files the bins run. Every value a config builds from here, the
 * `defineSchemastore` result and each `HostedSchema`, `SchemaTarget` or version
 * it holds, is stamped with the version the tool was built against, so the
 * tool's version check always passes for it. A value built from a separately
 * installed `@effected/schemastore` passes only when that copy is at the same
 * version.
 *
 * A config file imports this entry, so it stays cheap: it reaches neither front
 * end, nor the engine, nor the bundler, nor `ajv`, nor Ink.
 *
 * @packageDocumentation
 */

export {
	CatalogEntry,
	type CatalogInput,
	CatalogLintFinding,
	type CatalogUrls,
	type CustomHostedSchemaInput,
	type DriftOptions,
	DriftPolicy,
	type DriftTolerance,
	type DriftVerdict,
	type FrozenVersion,
	type GitHubHostedSchemaInput,
	HostedSchema,
	type HostedSchemaVersionsInput,
	InvalidSchemaVersionError,
	KeywordFamilies,
	type OnDrift,
	type ResolvedSchema,
	SCHEMASTORE_CATALOG_BASE,
	SCHEMASTORE_ID_BASE,
	type SchemaChange,
	type SchemaEntryInput,
	type SchemaLayout,
	SchemaTarget,
	SchemaVersion,
	SchemaVersioning,
	type SchemastoreConfig,
	type SchemastoreConfigInput,
	SchemastoreVersion,
	type WriteChange,
	defineConfig as defineSchemastore,
} from "@effected/schemastore";
export { PLUGIN_VERSION } from "./version.js";
