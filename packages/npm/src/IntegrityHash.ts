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
//
// `CorepackIntegrityHash` is the one narrowing the kit needs: the pin tail
// `<name>@<version>+<integrity>` only ever carries the corepack form, and both
// schemas that model it (`PackageManagerPin` here, `@effected/package-json`'s
// `PackageManager`) consume that export rather than restricting the brand
// themselves.

import type { Brand } from "effect";
import { Effect, Option, Schema } from "effect";

/**
 * A supported integrity hash algorithm.
 *
 * @remarks
 * `sha224` appears only in the corepack form — corepack's own transparent
 * default pins emit it (e.g. `yarn@4.x+sha224.<hex>`) — and never in SRI,
 * whose specification names only `sha256`/`sha384`/`sha512` (plus legacy
 * `sha1`).
 *
 * @public
 */
export type IntegrityAlgorithm = "sha1" | "sha224" | "sha256" | "sha384" | "sha512";

// SRI: `<algo>-<base64>` (optional `=` padding). No sha224 — the SRI spec
// does not include it.
const SRI_RE = /^(sha1|sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/;
// Corepack: `<algo>.<lowercase-hex>`. sha224 is real and corepack-emitted:
// the transparent default pin for yarn Berry hashes with it.
const COREPACK_RE = /^(sha1|sha224|sha256|sha384|sha512)\.[0-9a-f]+$/;
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
export class InvalidIntegrityHashError extends Schema.TaggedError<InvalidIntegrityHashError>()(
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

/**
 * {@link (IntegrityHash:variable)} narrowed to the corepack `<algo>.<hex>` form
 * — `sha512.deadbeef`, and corepack's own sha224 default pins
 * (`sha224.877304e3…`). An SRI (`sha512-<base64>`) or yarn (`10c0/<hex>`)
 * hash, both valid `IntegrityHash` values, fails this schema.
 *
 * @remarks
 * The corepack pin tail (`<name>@<version>+<integrity>`) is the one place the
 * kit meets this form, and two schemas name it: `PackageManagerPin.integrity`
 * here and `@effected/package-json`'s `PackageManager.integrity`. Both consume
 * **this** schema — the restriction existed privately in each module until they
 * were consolidated, and a private copy is exactly how the two drift (the
 * widening that admitted sha224 had to be made twice).
 *
 * It decodes to the same {@link IntegrityHashBrand} the unrestricted schema
 * does, so a corepack-validated value assigns anywhere an `IntegrityHash` is
 * expected; there is no second brand. Reach for
 * `IntegrityHash.isCorepack(value)` to ask the same question about a raw
 * string without decoding.
 *
 * That single brand is also why sharing this schema is not type-enforced, and
 * the consequence is sharper than it looks: a `Schema.check` is **erased from
 * the built type**, so this schema and the unrestricted one are the same
 * declared type. A consumer that quietly reverts to a private copy compiles
 * clean, and — if the copy is faithful — passes every rejection test too.
 * Neither `tsc` nor behaviour can see the re-fork.
 *
 * What does see it is **object identity**, so each consumer's suite asserts
 * that its field schema IS this export:
 * `PackageManagerPin.fields.integrity.schema === CorepackIntegrityHash` (an
 * `optionalKey` field keeps the inner schema on `.schema`), and
 * `PackageManager.fields.integrity.value === CorepackIntegrityHash` on the
 * `@effected/package-json` side (a `Schema.Option` keeps it on `.value`). Both
 * assertions carry a control against the unrestricted brand, so they discriminate
 * rather than passing on any schema at all. That identity assertion is the only
 * thing standing between the two surfaces and a silent re-fork; do not replace
 * it with a behavioural test, which cannot fail.
 *
 * @example
 * ```ts
 * import { CorepackIntegrityHash } from "@effected/npm";
 * import { Schema } from "effect";
 *
 * const decode = Schema.decodeUnknownExit(CorepackIntegrityHash);
 *
 * decode("sha512.deadbeef"); // success
 * decode("sha512-3q2+7w=="); // failure — SRI form
 * ```
 *
 * @public
 */
export const CorepackIntegrityHash = brandedIntegrity.pipe(
	Schema.check(
		Schema.makeFilter((value) => (isCorepack(value) ? undefined : "Expected a corepack (<algo>.<hex>) integrity hash")),
	),
);
