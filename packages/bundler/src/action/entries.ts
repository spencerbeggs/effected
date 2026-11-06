/** The bundle names the action lifecycle owns, which a worker must not take. */
const RESERVED_ENTRY_NAMES: ReadonlySet<string> = new Set(["main", "pre", "post"]);

/**
 * Why a worker name cannot be used, if it cannot.
 *
 * A worker's name becomes the emitted filename, so it must not collide with a lifecycle bundle or escape `dist/`.
 */
export const invalidWorkerName = (name: string): string | undefined => {
	if (RESERVED_ENTRY_NAMES.has(name)) return `"${name}" is a reserved lifecycle bundle name (main/pre/post)`;
	return name.length === 0 || name.includes("/") || name.includes("\\") || name.includes("..")
		? "worker names must be non-empty and free of path separators"
		: undefined;
};

/** Where `pre` and `post` are looked for when the config names neither. */
export const DEFAULT_LIFECYCLE_ENTRIES = { pre: "src/pre.ts", post: "src/post.ts" } as const;
