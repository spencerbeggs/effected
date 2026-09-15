import { Option, Result, Schema } from "effect";
import type { SchemaLayout, SchemaVersion } from "./SchemaVersioning.js";
import { SchemaVersioning } from "./SchemaVersioning.js";

/** The host SchemaStore-hosted documents declare in `$id`. @public */
export const SCHEMASTORE_ID_BASE = "https://json.schemastore.org";
/** The host SchemaStore's `catalog.json` points `url` at. @public */
export const SCHEMASTORE_CATALOG_BASE = "https://www.schemastore.org";

const RAW_GITHUB_BASE = "https://raw.githubusercontent.com";

const trimSlashes = (url: string): string => {
	let end = url.length;
	while (end > 0 && url.charCodeAt(end - 1) === 47) {
		end -= 1;
	}
	return url.slice(0, end);
};

// Where a document is hosted decides both of its bases and its layout.
interface Hosting {
	readonly idBase: string;
	readonly catalogBase: string;
	readonly layout: SchemaLayout;
}

// Every label, deduplicated under Order (`1.2` / `1.2.0` are one label), plus
// which one is current: the explicit label, else the newest.
interface Versions {
	readonly versions: ReadonlyArray<SchemaVersion>;
	readonly current: SchemaVersion | undefined;
}

interface Resolved {
	readonly hosting: Hosting;
	readonly versions: Versions;
}

interface Fields {
	readonly name: string;
	readonly baseUrl: string;
	readonly versions?: ReadonlyArray<string>;
	readonly current?: string;
	readonly layout?: SchemaLayout;
}

// One walk over the raw fields answering either the resolved identity or the
// first reason it is invalid — the same walk backs the class check and every
// derived getter, so what the check admits is exactly what the getters read.
// Messages are predicates with no subject, so `defineConfig` can prefix them
// with `schema "<name>"` verbatim.
const resolve = (fields: Fields): Result.Result<Resolved, string> => {
	if (!SchemaVersioning.isSimpleName(fields.name)) {
		return Result.fail(`must be keyed by a simple file base name (no separators, no whitespace)`);
	}
	let hosting: Hosting;
	if (fields.baseUrl === "schemastore") {
		if (fields.layout !== undefined) {
			return Result.fail(
				`declares layout "${fields.layout}" under baseUrl "schemastore", which serves only the flat layout`,
			);
		}
		hosting = { idBase: SCHEMASTORE_ID_BASE, catalogBase: SCHEMASTORE_CATALOG_BASE, layout: "flat" };
	} else if (!fields.baseUrl.startsWith("https://") || fields.baseUrl.length === "https://".length) {
		return Result.fail(`has baseUrl "${fields.baseUrl}"; expected "schemastore" or an https:// URL`);
	} else {
		hosting = { idBase: fields.baseUrl, catalogBase: fields.baseUrl, layout: fields.layout ?? "versioned" };
	}
	if (fields.versions === undefined) {
		if (fields.current !== undefined) {
			return Result.fail(`declares current "${fields.current}" without versions`);
		}
		return Result.succeed({ hosting, versions: { versions: [], current: undefined } });
	}
	if (fields.versions.length === 0) {
		return Result.fail(`declares versions as an empty array; omit versions for an unversioned schema`);
	}
	const versions: Array<SchemaVersion> = [];
	for (const label of fields.versions) {
		const parsed = SchemaVersioning.parseResult(label);
		if (Result.isFailure(parsed)) {
			return Result.fail(`has an invalid version label "${label}": ${parsed.failure.message}`);
		}
		const duplicate = versions.find((v) => SchemaVersioning.Order(v, parsed.success) === 0);
		if (duplicate !== undefined) {
			return Result.fail(`declares the same version twice, as "${duplicate}" and "${parsed.success}"`);
		}
		versions.push(parsed.success);
	}
	if (fields.current === undefined) {
		// Non-empty by the guard above, so `latest` is always `some`.
		return Result.succeed({
			hosting,
			versions: { versions, current: Option.getOrThrow(SchemaVersioning.latest(versions)) },
		});
	}
	const current = SchemaVersioning.parseResult(fields.current);
	if (Result.isFailure(current)) {
		return Result.fail(`has an invalid version label "${fields.current}": ${current.failure.message}`);
	}
	const match = versions.find((v) => SchemaVersioning.Order(v, current.success) === 0);
	if (match === undefined) {
		return Result.fail(`declares current "${fields.current}" which is not one of its versions`);
	}
	return Result.succeed({ hosting, versions: { versions, current: match } });
};

const HostedSchemaFields = Schema.Struct({
	name: Schema.String,
	baseUrl: Schema.String,
	versions: Schema.optionalKey(Schema.Array(Schema.String)),
	current: Schema.optionalKey(Schema.String),
	layout: Schema.optionalKey(Schema.Literals(["flat", "versioned"])),
}).check(
	Schema.makeFilter((fields) => {
		const resolved = resolve(fields);
		return Result.isFailure(resolved) ? `hosted schema "${fields.name}" ${resolved.failure}` : undefined;
	}),
);

/**
 * The identity every hosted document derives from: `versions` and `current`
 * as `defineConfig` accepts them, minus the host, which each constructor
 * supplies.
 *
 * @public
 */
export interface HostedSchemaVersionsInput {
	/** The schema's file base name — the key it takes in `defineConfig`'s `schemas`. */
	readonly name: string;
	/** Every version label the schema advertises; omit for an unversioned schema. */
	readonly versions?: ReadonlyArray<string>;
	/** Which of `versions` is current. Defaults to the newest under {@link SchemaVersioning.Order}. */
	readonly current?: string;
}

/** Input to {@link HostedSchema.github}. @public */
export interface GitHubHostedSchemaInput extends HostedSchemaVersionsInput {
	/** The repository, as `owner/repo`. */
	readonly repo: string;
	/** The branch (or tag) the files are served from. Defaults to `"main"`. */
	readonly branch?: string;
	/** The directory under the repository root the files live in, e.g. `"schemas"`. Defaults to the root. */
	readonly path?: string;
	/** How a versioned file nests under `path`. Defaults to `"versioned"`. */
	readonly layout?: SchemaLayout;
}

/** Input to {@link HostedSchema.custom}. @public */
export interface CustomHostedSchemaInput extends HostedSchemaVersionsInput {
	/** The `https://` directory URL the files are served under; a trailing slash is trimmed. */
	readonly baseUrl: string | URL;
	/** How a versioned file nests under `baseUrl`. Defaults to `"versioned"`. */
	readonly layout?: SchemaLayout;
}

/**
 * Where a JSON Schema document is hosted and which version of it is current
 * — the one value an application derives its `$schema` URL from and hands
 * to `defineConfig`, so the URL the code emits and the `$id` the CLI writes
 * cannot disagree.
 *
 * @remarks
 * Build one with {@link HostedSchema.github},
 * {@link HostedSchema.schemastore} or
 * {@link HostedSchema.custom}; each validates the identity and
 * throws a plain `Error` naming the reason. The derivation is
 * {@link SchemaVersioning.schemaUrl}'s: `<base>/<name>.json` unversioned,
 * `<base>/<name>-<version>.json` under the `"flat"` layout and
 * `<base>/<version>/<name>-<version>.json` under `"versioned"`. The raw
 * fields are what `defineConfig` accepts by hand (`baseUrl`, `versions`,
 * `current`, `layout`); the getters are the resolved identity.
 *
 * @example
 * ```ts
 * import { HostedSchema } from "@effected/schemastore";
 * import { Schema } from "effect";
 *
 * export const OutputSchema = HostedSchema.github({
 *   repo: "savvy-web/silk-release-action",
 *   path: "schemas",
 *   name: "silk-release-action.output",
 *   versions: ["5.2"],
 * });
 *
 * // In the application: every payload names the schema it was written against.
 * const Output = Schema.Struct({ $schema: Schema.Literal(OutputSchema.$id) });
 *
 * // In schemastore.config.ts: the same value, so nothing is re-derived.
 * // schemas: { [OutputSchema.name]: { schema: Output, hosted: OutputSchema } }
 * ```
 *
 * @public
 */
export class HostedSchema extends Schema.Class<HostedSchema>("HostedSchema")(HostedSchemaFields) {
	/** A schema served raw from a GitHub repository. */
	static github(input: GitHubHostedSchemaInput): HostedSchema {
		const { repo, branch, path, ...rest } = input;
		const segments = [RAW_GITHUB_BASE, repo, branch ?? "main", ...(path === undefined ? [] : [path])];
		return construct({ ...rest, baseUrl: trimSlashes(segments.join("/")) });
	}

	/** A schema published to SchemaStore: `$id` on {@link SCHEMASTORE_ID_BASE}, catalog URL on {@link SCHEMASTORE_CATALOG_BASE}, flat layout. */
	static schemastore(input: HostedSchemaVersionsInput): HostedSchema {
		return construct({ ...input, baseUrl: "schemastore" });
	}

	/** A schema served from any `https://` directory. */
	static custom(input: CustomHostedSchemaInput): HostedSchema {
		const { baseUrl, ...rest } = input;
		return construct({ ...rest, baseUrl: trimSlashes(typeof baseUrl === "string" ? baseUrl : baseUrl.href) });
	}

	private get resolved(): Resolved {
		// Admitted by the class check, so the walk cannot fail here.
		return Result.getOrThrow(resolve(this));
	}

	/** The base `$id` is derived from: {@link SCHEMASTORE_ID_BASE} under SchemaStore, else `baseUrl`. */
	get idBase(): string {
		return this.resolved.hosting.idBase;
	}

	/** The base the catalog URL is derived from: {@link SCHEMASTORE_CATALOG_BASE} under SchemaStore, else `baseUrl`. */
	get catalogBase(): string {
		return this.resolved.hosting.catalogBase;
	}

	/** The effective layout: `"flat"` under SchemaStore, else `layout` defaulting to `"versioned"`. */
	get resolvedLayout(): SchemaLayout {
		return this.resolved.hosting.layout;
	}

	/** Every advertised version, parsed; empty for an unversioned schema. */
	get resolvedVersions(): ReadonlyArray<SchemaVersion> {
		return this.resolved.versions.versions;
	}

	/** The current version — `current`, else the newest of `versions`; `undefined` for an unversioned schema. */
	get resolvedCurrent(): SchemaVersion | undefined {
		return this.resolved.versions.current;
	}

	/** The `$id` of the current document — what an application writes as `$schema`. */
	get $id(): string {
		return this.idFor(this.resolvedCurrent);
	}

	/** The catalog URL of the current document; equals {@link HostedSchema.$id} except under SchemaStore. */
	get url(): string {
		return this.urlFor(this.resolvedCurrent);
	}

	/** The current document's file name relative to the output directory. */
	get fileName(): string {
		return this.fileNameFor(this.resolvedCurrent);
	}

	/** The `$id` of the document at `version` (or the unversioned document). */
	idFor(version?: string): string {
		return SchemaVersioning.schemaUrl(this.idBase, this.name, this.parseLabel(version), this.resolvedLayout);
	}

	/** The catalog URL of the document at `version` (or the unversioned document). */
	urlFor(version?: string): string {
		return SchemaVersioning.schemaUrl(this.catalogBase, this.name, this.parseLabel(version), this.resolvedLayout);
	}

	/** The file name of the document at `version` (or the unversioned document), relative to the output directory. */
	fileNameFor(version?: string): string {
		return SchemaVersioning.fileName(this.name, this.parseLabel(version), this.resolvedLayout);
	}

	private parseLabel(version: string | undefined): SchemaVersion | undefined {
		if (version === undefined) {
			return undefined;
		}
		return Result.getOrThrowWith(
			SchemaVersioning.parseResult(version),
			(error) => new Error(`HostedSchema "${this.name}": invalid version label "${version}": ${error.message}`),
		);
	}
}

// The one validating path every named constructor takes: a decode, so the
// class check's message reaches the thrown Error (`make` buries it in `cause`).
const construct = (fields: Fields): HostedSchema =>
	Result.getOrThrowWith(Schema.decodeUnknownResult(HostedSchema)(fields), (error) => new Error(error.message));
