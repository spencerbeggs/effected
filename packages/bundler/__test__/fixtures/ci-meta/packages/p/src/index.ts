import type { Hidden } from "./hidden.js";

/**
 * Returns a shape the entry point does not export.
 *
 * @public
 */
export function reveal(): Hidden {
	return { value: 1 };
}

/**
 * A documented constant with no release tag.
 */
export const untagged = 1;
