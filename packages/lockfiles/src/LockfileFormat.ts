import { Option, Schema } from "effect";

/**
 * The lockfile formats this package parses: bun's `bun.lock` (JSONC), npm's
 * `package-lock.json` (v2/v3 JSON), pnpm's `pnpm-lock.yaml` and yarn Berry's
 * `yarn.lock` (both YAML).
 *
 * @remarks
 * The literal names the *lockfile format*, not the package manager that
 * happens to write it — this package models lockfiles. Yarn support is
 * Berry only; classic (v1) `yarn.lock` is not YAML and fails
 * `Lockfile.parse` with a typed `LockfileParseError`.
 *
 * @public
 */
export const LockfileFormat = Schema.Literals(["bun", "npm", "pnpm", "yarn"]);

/**
 * The union of supported lockfile format names.
 *
 * @public
 */
export type LockfileFormat = typeof LockfileFormat.Type;

const FILENAMES: Readonly<Record<LockfileFormat, string>> = {
	bun: "bun.lock",
	npm: "package-lock.json",
	pnpm: "pnpm-lock.yaml",
	yarn: "yarn.lock",
};

/**
 * The conventional lockfile filename for a format: `"bun.lock"`,
 * `"package-lock.json"`, `"pnpm-lock.yaml"` or `"yarn.lock"`.
 *
 * @public
 */
export const filenameFor = (format: LockfileFormat): string => FILENAMES[format];

/**
 * The format a lockfile filename identifies, if any.
 *
 * @remarks
 * Matches exact conventional filenames only (`"bun.lock"`,
 * `"package-lock.json"`, `"pnpm-lock.yaml"`, `"yarn.lock"`) — paths and
 * other spellings return `Option.none()`.
 *
 * @public
 */
export const fromFilename = (name: string): Option.Option<LockfileFormat> => {
	for (const format of LockfileFormat.literals) {
		if (FILENAMES[format] === name) return Option.some(format);
	}
	return Option.none();
};
