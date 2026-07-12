/**
 * The package's currency type: a virtual file system mapping
 * `node_modules/`-prefixed paths to file contents.
 */

/**
 * A virtual file system: file paths (prefixed `node_modules/<package>/`)
 * mapped to their string contents.
 *
 * @remarks
 * This is the value every loading operation produces and every TypeScript
 * integration consumes. Maps from multiple packages merge with {@link mergeVfs};
 * `@typescript/vfs` consumes the merged map directly (see `TsEnvironment`).
 *
 * @public
 */
export type Vfs = Map<string, string>;

/**
 * The v3 name for {@link Vfs}, kept as an alias for the consumer migration.
 *
 * @public
 */
export type VirtualFileSystem = Vfs;

/**
 * Merge VFS maps left to right into a new map; later entries win on path
 * collisions.
 *
 * @example
 * ```ts
 * import { mergeVfs } from "@effected/ts-vfs";
 *
 * const combined = mergeVfs(vfsA, vfsB);
 * ```
 *
 * @public
 */
export const mergeVfs = (...maps: ReadonlyArray<ReadonlyMap<string, string>>): Vfs => {
	const out: Vfs = new Map();
	for (const map of maps) {
		for (const [path, content] of map) {
			out.set(path, content);
		}
	}
	return out;
};

/**
 * Prefix every path in `entries` with `node_modules/<name>/`, normalizing
 * away leading slashes.
 *
 * @public
 */
export const prefixVfs = (name: string, entries: ReadonlyMap<string, string>): Vfs => {
	const out: Vfs = new Map();
	for (const [path, content] of entries) {
		out.set(`node_modules/${name}/${path.replace(/^\/+/, "")}`, content);
	}
	return out;
};
