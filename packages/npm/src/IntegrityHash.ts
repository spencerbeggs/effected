// The `IntegrityHash` brand: one concept covering the three textual integrity
// forms the kit meets.
//
//   - SRI form   `<algo>-<base64>`  — lockfiles' `ResolvedPackage.integrity`
//                                     and npm `package-lock` entries.
//   - Corepack   `<algo>.<hex>`     — package-json's `packageManager` pin, the
//                                     `name@version+sha512.<hex>` tail.
//   - Yarn       `<cachekey>/<hex>` — yarn Berry `yarn.lock` `checksum` values
//                                     (e.g. `10c0/<hex>`); a cache-versioned
//                                     SHA-512 that does not name its algorithm.
//
// A branded string plus its taxonomy statics (`algorithmOf`, `isSri`,
// `isCorepack`, `isYarnChecksum`) and a typed `decode`, mirroring
// `DependencySpecifier`'s shape.

import type { Brand } from "effect";
import { Effect, Option, Schema } from "effect";

/**
 * A supported integrity hash algorithm.
 *
 * @public
 */
export type IntegrityAlgorithm = "sha1" | "sha256" | "sha384" | "sha512";

// SRI: `<algo>-<base64>` (optional `=` padding).
const SRI_RE = /^(sha1|sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;
// Corepack: `<algo>.<lowercase-hex>`.
const COREPACK_RE = /^(sha1|sha256|sha384|sha512)\.[0-9a-f]+$/;
// Yarn Berry: `<cachekey>/<lowercase-hex>`, e.g. `10c0/<hex>`. The cache key is
// a version marker (`<digits>c<digits>`), not an algorithm token.
const YARN_RE = /^[0-9]+(c[0-9]+)?\/[0-9a-f]+$/;

const isSri = (value: string): boolean => SRI_RE.test(value);
const isCorepack = (value: string): boolean => COREPACK_RE.test(value);
const isYarnChecksum = (value: string): boolean => YARN_RE.test(value);

/**
 * Whether a string is a valid integrity hash in the SRI (`<algo>-<base64>`),
 * corepack (`<algo>.<hex>`) or yarn (`<cachekey>/<hex>`) form.
 *
 * @public
 */
export const isValidIntegrityHash = (value: string): boolean =>
	isSri(value) || isCorepack(value) || isYarnChecksum(value);

// The algorithm is the prefix before the first `-` (SRI) or `.` (corepack). The
// yarn form does not name its algorithm, so it has none to read.
const algorithmOf = (value: string): Option.Option<IntegrityAlgorithm> => {
	if (isSri(value)) return Option.some(value.slice(0, value.indexOf("-")) as IntegrityAlgorithm);
	if (isCorepack(value)) return Option.some(value.slice(0, value.indexOf(".")) as IntegrityAlgorithm);
	return Option.none();
};

/**
 * Indicates that a string could not be parsed as a valid integrity hash.
 *
 * Raised by {@link IntegrityHash.decode}. The offending string is preserved on
 * `input`.
 *
 * @public
 */
export class InvalidIntegrityHashError extends Schema.TaggedErrorClass<InvalidIntegrityHashError>()(
	"InvalidIntegrityHashError",
	{
		/** The raw input string that failed validation. */
		input: Schema.String,
	},
) {
	override get message(): string {
		return `Invalid integrity hash "${this.input}": expected an SRI (<algo>-<base64>), corepack (<algo>.<hex>) or yarn (<cachekey>/<hex>) form`;
	}
}

/** Taxonomy statics attached to the `IntegrityHash` schema value. */
interface IntegrityHashStatics {
	/** Whether the hash is in SRI (`<algo>-<base64>`) form. */
	readonly isSri: (value: string) => boolean;
	/** Whether the hash is in corepack (`<algo>.<hex>`) form. */
	readonly isCorepack: (value: string) => boolean;
	/** Whether the hash is in yarn (`<cachekey>/<hex>`) form. */
	readonly isYarnChecksum: (value: string) => boolean;
	/** Whether the string is a valid integrity hash in any of the three forms. */
	readonly isValid: (value: string) => boolean;
	/**
	 * The algorithm prefix. `None` when the string is not a valid integrity
	 * hash, and also `None` for the yarn form, which does not name its algorithm.
	 */
	readonly algorithmOf: (value: string) => Option.Option<IntegrityAlgorithm>;
	/** Validate a string, failing with a typed {@link InvalidIntegrityHashError}. */
	readonly decode: (input: string) => Effect.Effect<IntegrityHashBrand, InvalidIntegrityHashError>;
}

/**
 * The branded integrity-hash type: any string {@link (IntegrityHash:variable)}
 * validates.
 *
 * @public
 */
export type IntegrityHashBrand = string & Brand.Brand<"IntegrityHash">;

const brandedIntegrity = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			isValidIntegrityHash(value) ? undefined : "Expected an SRI, corepack or yarn integrity hash",
		),
	),
	Schema.brand("IntegrityHash"),
);

const decode = (input: string): Effect.Effect<IntegrityHashBrand, InvalidIntegrityHashError> =>
	Schema.decodeUnknownEffect(brandedIntegrity)(input).pipe(
		Effect.mapError(() => new InvalidIntegrityHashError({ input })),
	);

/**
 * A subresource-integrity hash, covering the SRI (`sha512-<base64>`), corepack
 * (`sha512.<hex>`) and yarn (`10c0/<hex>`) textual forms, carrying taxonomy
 * statics (`IntegrityHash.algorithmOf` and friends). Use it as a schema for an
 * integrity field and reach for the statics to inspect a raw string.
 *
 * @public
 */
export const IntegrityHash = Object.assign(brandedIntegrity, {
	isSri,
	isCorepack,
	isYarnChecksum,
	isValid: isValidIntegrityHash,
	algorithmOf,
	decode,
} satisfies IntegrityHashStatics);
