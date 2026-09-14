import { SemVer } from "@effected/semver";
import { Effect, Option, Order, Result, Schema } from "effect";
// Type-only: erased at emit, so `SchemaVersioning` keeps its zero runtime edges
// and stays pure. The classification vocabulary belongs to `SchemaFile`.
import type { WriteChange } from "./SchemaFile.js";

// Version labels are 1–3 dot-separated SemVer-numeric components, optional
// prerelease, no build metadata — matching SchemaStore's own corpus
// (`agripparc-1.2.json` and its like) rather than a fixed three-component
// SemVer. The label round-trips verbatim into file names, schema URLs and
// catalog `versions` keys; only the ORDERING key (see `orderingKey` below)
// pads the missing components, and only for comparison — never for what is
// written anywhere.
//
// The file-name CONVENTION stays SchemaStore's (`<name>-<version>.json`,
// per its CONTRIBUTING guide); only the label grammar is validated here.
//
// Build metadata (`+build`) is rejected: it is hostile in a URL, and SemVer
// precedence IGNORES it, so two labels differing only in build would compare
// equal and both claim to be the latest version.

// The label grammar: 1–3 dot-separated non-negative integers (no leading
// zeros, no leading `v`, no whitespace), an optional SemVer prerelease, no
// build metadata. The label itself is preserved verbatim — it is the file
// name and the URL — and only the ORDERING key is padded to full SemVer.
const LABEL = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){0,2}(-[0-9A-Za-z.-]+)?$/;

interface SplitLabel {
	readonly core: ReadonlyArray<string>;
	readonly prerelease: string;
}

const split = (input: string): SplitLabel | undefined => {
	if (!LABEL.test(input)) {
		return undefined;
	}
	const dash = input.indexOf("-");
	const core = dash === -1 ? input : input.slice(0, dash);
	const prerelease = dash === -1 ? "" : input.slice(dash);
	return { core: core.split("."), prerelease };
};

/** Pad a 1–3 component core to `major.minor.patch` so SemVer can order it. */
const padded = (parts: SplitLabel): string => `${[...parts.core, "0", "0"].slice(0, 3).join(".")}${parts.prerelease}`;

const isVersionLabel = (input: string): boolean => {
	const parts = split(input);
	if (parts === undefined) {
		return false;
	}
	const parsed = SemVer.parseResult(padded(parts));
	return Result.isSuccess(parsed) && parsed.success.build.length === 0;
};

/**
 * Indicates that a string is not a valid SchemaStore version label.
 *
 * Raised by {@link SchemaVersioning.parse}.
 *
 * @public
 */
export class InvalidSchemaVersionError extends Schema.TaggedError<InvalidSchemaVersionError>()(
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
 * A schema version label: a branded string holding one, two or three
 * dot-separated numeric components — `major`, `major.minor` or
 * `major.minor.patch` — with an optional SemVer prerelease. Build metadata
 * is rejected (see below).
 *
 * This matches SchemaStore's own corpus, which commonly uses partial labels
 * like `agripparc-1.2.json`. The label is preserved VERBATIM — it is the
 * file name and the URL — and a missing component is read as zero only for
 * ordering (see {@link SchemaVersioning.Order}), never rewritten into the
 * label itself.
 *
 * @public
 */
export const SchemaVersion = Schema.String.check(
	Schema.makeFilter((value) =>
		isVersionLabel(value) ? undefined : "must be a major, major.minor or major.minor.patch version label",
	),
).pipe(Schema.brand("SchemaVersion"));

/**
 * The type of a validated SchemaStore version label.
 *
 * @public
 */
export type SchemaVersion = typeof SchemaVersion.Type;

// A validated label may have fewer than three components; ordering pads the
// missing ones to zero so `1`, `1.0` and `1.0.0` compare equal.
const orderingKey = (label: SchemaVersion): SemVer => {
	const parts = split(label);
	const result = parts === undefined ? undefined : SemVer.parseResult(padded(parts));
	if (result === undefined || Result.isFailure(result)) {
		// Unreachable for a validated label: the brand's filter IS this parse.
		throw new Error(`SchemaVersion ordering invariant violated for label "${label}"`);
	}
	return result.success;
};

// A contract change suggests the NEXT label a reader would expect: a MINOR
// bump, preserving the component count the author chose. `DocumentDiff`
// cannot tell an added optional property from a removed required one, so
// the suggestion's job is to be strictly greater and conspicuous, not to
// encode SemVer compatibility — the author bumps MAJOR by hand when they
// know the change is breaking. On a one-component label the only axis IS
// major (`1` → `2`).
//
// `SemVer.make` bounds every component at `Number.MAX_SAFE_INTEGER`, so a bump
// past the ceiling fails its schema with a bare "Schema validation failed" that
// names neither the label nor the limit. Re-throw the module's own invariant
// instead, so the label that ran out of room is visible in the message.
const bumpNext = (current: SchemaVersion, parsed: SemVer, components: 1 | 2 | 3): string => {
	try {
		const bumped = components === 1 ? parsed.bump.major() : parsed.bump.minor();
		const full = [bumped.major, bumped.minor, bumped.patch];
		return full.slice(0, components).join(".");
	} catch (cause) {
		throw new Error(
			`SchemaVersion bump invariant violated: "${current}" cannot be bumped past Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER})`,
			{ cause },
		);
	}
};

const assertSimpleName = (name: string): void => {
	if (name.length === 0 || /[/\\\s]/.test(name)) {
		throw new Error(`Schema name must be a non-empty simple file base name, got "${name}"`);
	}
};

// A manual trailing-slash trim rather than `/\/+$/`: the regex form
// backtracks polynomially on adversarial all-slash inputs (CodeQL
// js/polynomial-redos), and baseUrl is library input.
const joinUrl = (baseUrl: string, file: string): string => {
	let end = baseUrl.length;
	while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) {
		end -= 1;
	}
	return `${baseUrl.slice(0, end)}/${file}`;
};

/**
 * The `url`/`versions` half of a catalog entry, as assembled by
 * {@link SchemaVersioning.catalogUrls}.
 *
 * @public
 */
export interface CatalogUrls {
	/** The catalog `url` — the unversioned file, or the latest versioned file. */
	readonly url: string;
	/**
	 * The versioned catalog's `versions` map (label → url), inserted in
	 * ascending version order.
	 *
	 * A bare-major label (`"2"`) is array-index-like, so JavaScript
	 * enumerates it FIRST regardless of insertion order — the serialized
	 * order of such a key is therefore not meaningful. A two- or
	 * three-component label is never integer-like and keeps insertion order
	 * through serialization.
	 */
	readonly versions?: Readonly<Record<string, string>>;
}

/**
 * Both SchemaStore catalog modes as pure derivations: unversioned (a plain
 * `name.json` file, `url` only) and versioned (`name-<version>.json` files
 * — SchemaStore's own suffix convention — a `versions` map, and `url`
 * pointing at the latest version).
 *
 * Version labels are 1–3 dot-separated numeric components with an optional
 * prerelease; ordering reads a missing component as zero and otherwise
 * follows plain SemVer precedence: `1.10` above `1.9`, `2.0.0-beta` below
 * `2.0.0`.
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
		return isVersionLabel(input)
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
	 * `Order` instance over version labels: plain SemVer precedence.
	 * `1.10.0` sorts above `1.9.0` (numeric, not lexical) and `2.0.0-beta`
	 * below `2.0.0` (prerelease precedence).
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
	 * Whether a label names a pinned, published document — i.e. it is NOT a
	 * prerelease. SemVer §9 makes a prerelease's own instability explicit, so
	 * a contract change inside one is not a break for anyone.
	 *
	 * ONE predicate consumed by two policies so they cannot drift:
	 * `SchemaPipeline`'s `"block-versioned"` guard (a pinned versioned target
	 * refuses an in-place contract change) and {@link SchemaVersioning.next}
	 * (a non-pinned label is not bumped). If the two used different tests, a
	 * caller could be refused a write AND told to keep the same label — a
	 * deadlock.
	 */
	static isPinned(version: SchemaVersion): boolean {
		return orderingKey(version).prerelease.length === 0;
	}

	/**
	 * The number of dot-separated numeric components in a label's core:
	 * `1` for `"1"` (or `"1-beta"`), `2` for `"1.2"`, `3` for `"1.2.3"`.
	 */
	static components(version: SchemaVersion): 1 | 2 | 3 {
		const parts = split(version);
		if (parts === undefined) {
			// Unreachable for a validated label: the brand's filter IS this parse.
			throw new Error(`SchemaVersion components invariant violated for label "${version}"`);
		}
		return parts.core.length as 1 | 2 | 3;
	}

	/**
	 * The version label a change classification calls for. Pure and
	 * synchronous; total over validated labels — a non-label input is a wiring
	 * bug and dies as a defect, the same as {@link SchemaVersioning.Order}.
	 *
	 * - `change !== "contract"` (`"none"`, `"annotations"`, `"created"`) →
	 *   `current`. A created file has no predecessor to break; an annotation
	 *   change is transparently replaceable (`DocumentDiff`).
	 * - `current` is not pinned (a prerelease) → `current`. A prerelease
	 *   declares its own instability; the pipeline's `"block-versioned"`
	 *   policy uses the same {@link SchemaVersioning.isPinned}, so the gate
	 *   and the bump agree.
	 * - otherwise → a MINOR bump, preserving the component count
	 *   ({@link SchemaVersioning.components}): `1.2.3` → `1.3.0`, `1.2` →
	 *   `1.3`, `0.4` → `0.5`. On a one-component label the only axis IS
	 *   major: `1` → `2`.
	 *
	 * The bump's job is to be strictly greater and conspicuous, NOT to encode
	 * SemVer compatibility: `DocumentDiff` cannot tell an added optional
	 * property from a removed required one, so every contract change reads as
	 * breaking — the author bumps MAJOR by hand when they know the change is
	 * breaking. Each label is its own file and URL, so an over-bump costs a
	 * file; an under-bump would overwrite a pinned document. `next` never
	 * introduces a prerelease from a stable input.
	 *
	 * A component that would be bumped past `Number.MAX_SAFE_INTEGER` cannot be
	 * represented, and throws this module's explicit invariant `Error` naming
	 * the label and the ceiling rather than `SemVer.make`'s bare schema failure.
	 */
	static next(current: SchemaVersion, change: WriteChange): SchemaVersion {
		if (change !== "contract" || !SchemaVersioning.isPinned(current)) {
			return current;
		}
		const label = bumpNext(current, orderingKey(current), SchemaVersioning.components(current));
		const reparsed = SchemaVersioning.parseResult(label);
		if (Result.isFailure(reparsed)) {
			// Unreachable: a bump of a validated label resets prerelease and
			// build, so the result re-parses under the same grammar.
			throw new Error(`SchemaVersion bump invariant violated: "${current}" bumped to "${label}"`);
		}
		return reparsed.success;
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
	 * versioned mode: the `versions` map carries every label, and `url`
	 * points at the latest version's file. An **empty** `versions` array is
	 * a contradiction (versioned mode with no versions) and throws — pass
	 * `undefined` for the unversioned mode.
	 *
	 * Labels are inserted in ascending {@link SchemaVersioning.Order}, but a
	 * bare-major label (`"2"`) is array-index-like, so JavaScript enumerates
	 * it FIRST regardless of insertion order — the serialized order of the
	 * `versions` map is not meaningful when such a label is present. A two-
	 * or three-component label is never integer-like and keeps insertion
	 * order through serialization. Deriving ordering from the labels
	 * themselves (as {@link SchemaVersioning.latest} does) is still the
	 * robust read.
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
