import { SemVer } from "@effected/semver";
import { Effect, Option, Order, Result, Schema } from "effect";

/**
 * SchemaStore version labels are dotted numerics with one to three
 * components and an optional prerelease — `1`, `1.2`, `1.2.3`,
 * `1.2-beta.1` — per the catalog's versioned-schema convention
 * (`agripparc-1.2.json`). They are deliberately NOT strict SemVer: most
 * real catalog labels are two-part. Leading zeros are rejected so no two
 * distinct labels can collide under numeric ordering.
 */
const VERSION_PATTERN = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,2}(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/**
 * Indicates that a string is not a valid SchemaStore version label.
 *
 * Raised by {@link SchemaVersioning.parse}.
 *
 * @public
 */
export class InvalidSchemaVersionError extends Schema.TaggedErrorClass<InvalidSchemaVersionError>()(
	"InvalidSchemaVersionError",
	{
		/** The raw input string that failed to parse. */
		input: Schema.String,
	},
) {
	override get message(): string {
		return `Invalid schema version label: "${this.input}"`;
	}
}

/**
 * A SchemaStore version label: a branded string validated against the
 * catalog's version grammar (`major[.minor[.patch]][-prerelease]`). The
 * label round-trips verbatim into file names and catalog `versions` keys;
 * ordering pads it to a full SemVer internally (see
 * {@link SchemaVersioning.Order}).
 *
 * @public
 */
export const SchemaVersion = Schema.String.check(Schema.isPattern(VERSION_PATTERN)).pipe(Schema.brand("SchemaVersion"));

/**
 * The type of a validated SchemaStore version label.
 *
 * @public
 */
export type SchemaVersion = typeof SchemaVersion.Type;

// Pads a validated label to a full three-component SemVer string so
// `@effected/semver` can order it: "1.2" -> "1.2.0", "2-beta" -> "2.0.0-beta".
const orderingKey = (label: SchemaVersion): SemVer => {
	const hyphen = label.indexOf("-");
	const core = hyphen === -1 ? label : label.slice(0, hyphen);
	const prerelease = hyphen === -1 ? "" : label.slice(hyphen);
	const parts = core.split(".");
	while (parts.length < 3) {
		parts.push("0");
	}
	const result = SemVer.parseResult(`${parts.join(".")}${prerelease}`);
	if (Result.isFailure(result)) {
		// Unreachable for a validated label: the grammar above pads to a
		// strict SemVer by construction. A failure here is a programmer error.
		throw new Error(`SchemaVersion ordering invariant violated for label "${label}"`);
	}
	return result.success;
};

const assertSimpleName = (name: string): void => {
	if (name.length === 0 || /[/\\\s]/.test(name)) {
		throw new Error(`Schema name must be a non-empty simple file base name, got "${name}"`);
	}
};

const joinUrl = (baseUrl: string, file: string): string => `${baseUrl.replace(/\/+$/, "")}/${file}`;

/**
 * The `url`/`versions` half of a catalog entry, as assembled by
 * {@link SchemaVersioning.catalogUrls}.
 *
 * @public
 */
export interface CatalogUrls {
	/** The catalog `url` — the unversioned file, or the latest versioned file. */
	readonly url: string;
	/** The versioned catalog's `versions` map (label → url), ascending. */
	readonly versions?: Readonly<Record<string, string>>;
}

/**
 * Both SchemaStore catalog modes as pure derivations: unversioned (a plain
 * `name.json` file, `url` only) and versioned (`name-<version>.json` files,
 * a `versions` map, and `url` pointing at the latest version).
 *
 * Version ordering follows SemVer precedence over labels padded to three
 * components, so `1.10` sorts above `1.9` and `2-beta` below `2`.
 *
 * @public
 */
export class SchemaVersioning {
	private constructor() {}

	/**
	 * Parses a version label. Pure and synchronous — the primitive form;
	 * {@link SchemaVersioning.parse} is the same check behind a span.
	 */
	static parseResult(input: string): Result.Result<SchemaVersion, InvalidSchemaVersionError> {
		return VERSION_PATTERN.test(input)
			? Result.succeed(input as SchemaVersion)
			: Result.fail(InvalidSchemaVersionError.make({ input }));
	}

	/**
	 * Effect form of {@link SchemaVersioning.parseResult}, adding only the
	 * `SchemaVersioning.parse` span. Defined in terms of the `Result`
	 * primitive — synchronous callers can use that variant directly.
	 */
	static readonly parse = Effect.fn("SchemaVersioning.parse")(
		(input: string): Effect.Effect<SchemaVersion, InvalidSchemaVersionError> =>
			Effect.fromResult(SchemaVersioning.parseResult(input)),
	);

	/**
	 * `Order` instance over version labels: SemVer precedence after padding
	 * missing components with zeros. `1.10` sorts above `1.9` (numeric, not
	 * lexical) and `2-beta` below `2` (prerelease precedence).
	 */
	static readonly Order: Order.Order<SchemaVersion> = Order.make((a, b) =>
		SemVer.Order(orderingKey(a), orderingKey(b)),
	);

	/**
	 * The highest version label by {@link SchemaVersioning.Order}, or
	 * `Option.none()` for an empty collection.
	 */
	static latest(versions: ReadonlyArray<SchemaVersion>): Option.Option<SchemaVersion> {
		return versions.length === 0
			? Option.none()
			: Option.some(versions.reduce((max, v) => (SchemaVersioning.Order(v, max) > 0 ? v : max)));
	}

	/**
	 * Derives the schema file name for a catalog name: `name.json`
	 * unversioned, `name-<version>.json` versioned.
	 *
	 * The name must be a simple file base name (no separators, no
	 * whitespace); anything else is a wiring mistake and throws.
	 */
	static fileName(name: string, version?: SchemaVersion): string {
		assertSimpleName(name);
		return version === undefined ? `${name}.json` : `${name}-${version}.json`;
	}

	/**
	 * The canonical URL a schema file is hosted at: `baseUrl` joined with
	 * {@link SchemaVersioning.fileName}.
	 */
	static schemaUrl(baseUrl: string, name: string, version?: SchemaVersion): string {
		return joinUrl(baseUrl, SchemaVersioning.fileName(name, version));
	}

	/**
	 * Assembles the `url`/`versions` half of a catalog entry.
	 *
	 * Omitting `versions` selects the unversioned mode (`url` only,
	 * pointing at the plain `name.json`). Providing them selects the
	 * versioned mode: the `versions` map carries every label ascending, and
	 * `url` points at the latest version's file. An **empty** `versions`
	 * array is a contradiction (versioned mode with no versions) and
	 * throws — pass `undefined` for the unversioned mode.
	 */
	static catalogUrls(options: {
		readonly baseUrl: string;
		readonly name: string;
		readonly versions?: ReadonlyArray<SchemaVersion>;
	}): CatalogUrls {
		const { baseUrl, name, versions } = options;
		if (versions === undefined) {
			return { url: SchemaVersioning.schemaUrl(baseUrl, name) };
		}
		if (versions.length === 0) {
			throw new Error(
				`catalogUrls received an empty versions array for "${name}": pass undefined for the unversioned mode`,
			);
		}
		const ascending = [...versions].sort(SchemaVersioning.Order);
		const map: Record<string, string> = {};
		for (const version of ascending) {
			map[version] = SchemaVersioning.schemaUrl(baseUrl, name, version);
		}
		const newest = ascending[ascending.length - 1] as SchemaVersion;
		return { url: SchemaVersioning.schemaUrl(baseUrl, name, newest), versions: map };
	}
}
