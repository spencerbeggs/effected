// SPDX license validation: the `SpdxLicense` branded schema (accepting real
// SPDX expressions plus the `UNLICENSED` and `SEE LICENSE IN` special cases)
// and the `InvalidSpdxLicenseError` the concept raises.

import { isValidExpression } from "@effected/spdx";
import type { Brand } from "effect";
import { Schema } from "effect";

/**
 * Indicates that a string is not a valid SPDX license identifier or expression.
 *
 * Raised by {@link Package.setLicense} and the decode direction of
 * `SpdxLicense`. The offending string is preserved on `input`.
 *
 * @public
 */
export class InvalidSpdxLicenseError extends Schema.TaggedErrorClass<InvalidSpdxLicenseError>()(
	"InvalidSpdxLicenseError",
	{
		/** The raw input string that failed validation. */
		input: Schema.String,
	},
) {
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
	return isValidExpression(value);
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
export type SpdxLicense = string & Brand.Brand<"SpdxLicense">;
