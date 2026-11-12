// packages/bundler/src/entries/package-json-entries.ts
import type { ExtractOptions, PackageJsonLike } from "./extract.js";
import { extractEntries } from "./extract.js";

/** @public */
export interface PackageJsonEntriesOptions extends ExtractOptions {
	/** The package.json to derive entries from, already read. */
	readonly pkg: PackageJsonLike;
}

/**
 * Derive a tsdown `entry` record (name to source path) from a package.json.
 *
 * @public
 */
export function packageJsonEntries(options: PackageJsonEntriesOptions): Record<string, string> {
	return extractEntries(options.pkg, {
		exportsAsIndexes: options.exportsAsIndexes,
		excludeSources: options.excludeSources,
	}).entries;
}
