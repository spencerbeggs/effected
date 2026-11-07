// packages/bundler/src/entries/package-json-entries.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtractOptions, PackageJsonLike } from "./extract.js";
import { extractEntries } from "./extract.js";

/** @public */
export interface PackageJsonEntriesOptions extends ExtractOptions {
	/** In-memory package.json. If omitted, reads `<cwd>/package.json`. */
	readonly pkg?: PackageJsonLike;
	/** Working directory for reading package.json. Defaults to process.cwd(). */
	readonly cwd?: string;
}

/**
 * Derive a tsdown `entry` record (name to source path) from a package.json.
 *
 * @public
 */
export function packageJsonEntries(options: PackageJsonEntriesOptions = {}): Record<string, string> {
	const pkg =
		options.pkg ??
		(JSON.parse(readFileSync(resolve(options.cwd ?? process.cwd(), "package.json"), "utf-8")) as PackageJsonLike);
	return extractEntries(pkg, { exportsAsIndexes: options.exportsAsIndexes, excludeSources: options.excludeSources })
		.entries;
}
