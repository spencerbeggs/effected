/**
 * SPDX license validation: the `SpdxLicense` branded schema (accepting
 * real SPDX expressions plus the `UNLICENSED` and `SEE LICENSE IN` special
 * cases) and the {@link InvalidSpdxLicenseError} the concept raises.
 *
 * @packageDocumentation
 */

import type { Cause } from "effect";
import { Schema } from "effect";
import spdxParse from "spdx-expression-parse";

/**
 * Schema-generated base class backing {@link InvalidSpdxLicenseError}. Not
 * meant to be referenced directly — named and exported only so API Extractor
 * can resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const InvalidSpdxLicenseError_base: Schema.Class<
	InvalidSpdxLicenseError,
	Schema.TaggedStruct<"InvalidSpdxLicenseError", { readonly input: typeof Schema.String }>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<InvalidSpdxLicenseError>()("InvalidSpdxLicenseError", {
	/** The raw input string that failed validation. */
	input: Schema.String,
});

/**
 * Indicates that a string is not a valid SPDX license identifier or expression.
 *
 * Raised by {@link Package.setLicense} and the decode direction of
 * `SpdxLicense`. The offending string is preserved on `input`.
 *
 * @public
 */
export class InvalidSpdxLicenseError extends InvalidSpdxLicenseError_base {
	override get message(): string {
		return `Invalid SPDX license "${this.input}": not a recognized identifier or expression`;
	}
}

/**
 * Whether a string is a valid SPDX license identifier or expression, or one of
 * the npm special cases `UNLICENSED` / `SEE LICENSE IN <file>`.
 *
 * @public
 */
export const isValidSpdx = (value: string): boolean => {
	if (value === "UNLICENSED") return true;
	if (value.startsWith("SEE LICENSE IN ") && value.length > "SEE LICENSE IN ".length) return true;
	try {
		spdxParse(value);
		return true;
	} catch {
		return false;
	}
};

/**
 * A valid SPDX license identifier, expression, `UNLICENSED`, or
 * `SEE LICENSE IN <file>`.
 *
 * @public
 */
export const SpdxLicense = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => (isValidSpdx(value) ? undefined : "Expected a valid SPDX license expression")),
	),
	Schema.brand("SpdxLicense"),
);

/**
 * A branded SPDX license string.
 *
 * @public
 */
export type SpdxLicense = typeof SpdxLicense.Type;
