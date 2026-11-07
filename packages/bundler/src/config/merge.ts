import { ConfigMerge } from "@effected/config-file";

/**
 * Merges a package's raw `effected.toml` document over the workspace root's.
 *
 * @remarks
 * Two tables merge per key; an array or a scalar replaces whatever the root had, whole. It runs on the raw
 * documents, before any decoding, so a default can never outrank a value the root wrote. Neither input is
 * modified, and `__proto__`, `constructor` and `prototype` keys are dropped.
 *
 * @param root - The root tier's document.
 * @param pkg - The package tier's document, which wins every conflict.
 * @returns The merged document.
 *
 * @public
 */
export const merge = (root: unknown, pkg: unknown): unknown => ConfigMerge.deep(root, pkg);
