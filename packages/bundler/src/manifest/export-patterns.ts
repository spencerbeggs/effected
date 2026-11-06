import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * A pattern export of an emitted manifest whose target matches no file in the package.
 *
 * @public
 */
export interface UnmatchedExportPattern {
	/** The `exports` key, such as `./schemas/*.json`. */
	readonly key: string;
	/** The target that matched nothing. */
	readonly target: string;
}

/** Every string target under an export's value, conditions included; a `null` exclusion has none. */
const targetsOf = (value: unknown): ReadonlyArray<string> => {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(targetsOf);
	if (typeof value === "object" && value !== null) return Object.values(value).flatMap(targetsOf);
	return [];
};

/** Node's pattern rule: the one `*` stands for a non-empty run of characters, `/` included. */
const matchesAny = (target: string, files: ReadonlyArray<string>): boolean => {
	const star = target.indexOf("*");
	const prefix = target.slice(0, star).replace(/^\.\//, "");
	const suffix = target.slice(star + 1);
	return files.some(
		(file) => file.length > prefix.length + suffix.length && file.startsWith(prefix) && file.endsWith(suffix),
	);
};

/**
 * The pattern exports of the manifest in `pkgDir` that match no file there. A package with no readable manifest, or
 * none with a pattern export, has none.
 *
 * @public
 */
export function unmatchedExportPatterns(pkgDir: string): ReadonlyArray<UnmatchedExportPattern> {
	let exportsMap: unknown;
	try {
		exportsMap = (JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as { exports?: unknown }).exports;
	} catch {
		return [];
	}
	if (typeof exportsMap !== "object" || exportsMap === null) return [];
	const patterns = Object.entries(exportsMap).flatMap(([key, value]) =>
		targetsOf(value)
			.filter((target) => target.includes("*"))
			.map((target) => ({ key, target })),
	);
	if (patterns.length === 0) return [];
	const files = (readdirSync(pkgDir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
		.filter((entry) => entry.isFile())
		.map((entry) =>
			join(entry.parentPath, entry.name)
				.slice(pkgDir.length + 1)
				.split(sep)
				.join("/"),
		);
	return patterns.filter(({ target }) => !matchesAny(target, files));
}
