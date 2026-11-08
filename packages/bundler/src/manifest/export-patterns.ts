import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

const stripDotSlash = (path: string): string => (path.startsWith("./") ? path.slice(2) : path);

/**
 * An `exports` or `bin` entry of an emitted manifest whose target matches no file in the package: a `*` pattern no
 * file matches, or a literal path that is not a file there.
 *
 * @public
 */
export interface UnmatchedExportPattern {
	/** The manifest field the entry is in. */
	readonly field: "exports" | "bin";
	/** The `exports` key, such as `./schemas/*.json` or `./foo`, or the `bin` command (`bin` for a string-form bin). */
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

/** Options for {@link unmatchedExportPatterns}. */
export interface UnmatchedExportPatternsOptions {
	/** Targets never reported, such as a SEA binary the build may skip compiling. Compared with any leading `./` dropped. */
	readonly ignore?: ReadonlyArray<string> | undefined;
}

/**
 * The `exports` and `bin` entries of the manifest in `pkgDir` whose targets match no file there: a `*` pattern that
 * matches nothing, or a relative literal target (`./foo.js`, `bin/cli.js`) that is not a file. A package with no
 * readable manifest has none.
 *
 * @public
 */
export function unmatchedExportPatterns(
	pkgDir: string,
	options: UnmatchedExportPatternsOptions = {},
): ReadonlyArray<UnmatchedExportPattern> {
	let manifest: { exports?: unknown; bin?: unknown };
	try {
		manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as typeof manifest;
	} catch {
		return [];
	}
	const ignore = new Set((options.ignore ?? []).map(stripDotSlash));
	const exportsMap = manifest.exports;
	// A bare-string `exports` is the root target; only relative targets name a file in the package.
	const exportEntries =
		typeof exportsMap === "string"
			? [[".", exportsMap] as const]
			: typeof exportsMap === "object" && exportsMap !== null
				? Object.entries(exportsMap)
				: [];
	const exportTargets = exportEntries.flatMap(([key, value]) =>
		targetsOf(value)
			// A trailing-slash folder mapping names a directory, not a file.
			.filter((target) => target.startsWith("./") && !target.endsWith("/"))
			.map((target) => ({ field: "exports" as const, key, target })),
	);
	// A published bin is a package-relative path, its leading "./" already stripped by the manifest transform.
	const bin = manifest.bin;
	const binEntries =
		typeof bin === "string"
			? [["bin", bin] as const]
			: typeof bin === "object" && bin !== null
				? Object.entries(bin).filter((entry): entry is [string, string] => typeof entry[1] === "string")
				: [];
	const binTargets = binEntries
		.filter(([, target]) => !isAbsolute(target) && !target.startsWith("../"))
		.map(([key, target]) => ({ field: "bin" as const, key, target }));
	const targets = [...exportTargets, ...binTargets].filter(({ target }) => !ignore.has(stripDotSlash(target)));
	const literals = targets.filter(({ target }) => !target.includes("*"));
	const missingLiterals = literals.filter(
		({ target }) => statSync(join(pkgDir, target), { throwIfNoEntry: false })?.isFile() !== true,
	);
	const patterns = targets.filter(({ target }) => target.includes("*"));
	if (patterns.length === 0) return missingLiterals;
	// Stat rather than the entry's own type, which says "symlink" for a linked file. A dangling link answers undefined.
	const files = readdirSync(pkgDir, { recursive: true, encoding: "utf-8" })
		.filter((path) => statSync(join(pkgDir, path), { throwIfNoEntry: false })?.isFile() === true)
		.map((path) => path.split(sep).join("/"));
	return [...missingLiterals, ...patterns.filter(({ target }) => !matchesAny(target, files))];
}
