import type { DeepContract } from "@fixture/a/deep/thing";

export type { SiblingContract } from "@fixture/a";
export type { DeepContract };

/**
 * Reads a type from the sibling's nested subpath.
 *
 * @public
 */
export const depthOf = (contract: DeepContract): number => contract.depth;
