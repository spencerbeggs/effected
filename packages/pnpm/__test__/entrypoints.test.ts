import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

type Read = (file: string) => string;
const readDisk: Read = (file) => readFileSync(file, "utf8");

/** Line comments first, then blocks: a `/*`-bearing word in a line comment must not open a phantom block. */
const stripComments = (text: string): string => text.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every specifier a module loads: imports, re-exports, side-effect imports and `import("<literal>")`. */
const specifiersOf = (text: string): ReadonlyArray<string> =>
	[...stripComments(text).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/g)].map(
		(match) => match[2] ?? "",
	);

interface Reach {
	/** Every module reached through relative specifiers. */
	readonly modules: ReadonlySet<string>;
	/** Every package specifier those modules load. */
	readonly packages: ReadonlySet<string>;
}

/**
 * Every module reachable from `entry` through relative specifiers, and the
 * package specifiers they load. Over source, a `.js` specifier maps to its
 * `.ts` file; over a build, it is the file.
 */
const reachedFrom = (entry: string, read: Read = readDisk, source = true): Reach => {
	const modules = new Set<string>();
	const packages = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || modules.has(file)) continue;
		modules.add(file);
		for (const specifier of specifiersOf(read(file))) {
			if (!specifier.startsWith(".")) packages.add(specifier);
			else {
				const target = resolve(dirname(file), specifier);
				queue.push(source ? target.replace(/\.js$/, ".ts") : target);
			}
		}
	}
	return { modules, packages };
};

/**
 * Whether a walk reaches the catalog: a module of the settings entry, or any
 * `@effected/pnpm/<subpath>` self-import, which resolves outside the walk.
 */
const reachesCatalog = ({ modules, packages }: Reach, root: string): boolean =>
	[...modules].some(
		(file) =>
			file === join(root, "settings.ts") ||
			file === join(root, "settings.js") ||
			file.startsWith(`${join(root, "settings")}/`),
	) || [...packages].some((name) => name.startsWith("@effected/pnpm/"));

const BUILT = fileURLToPath(new URL("../dist/prod/npm/pkg/", import.meta.url));

describe("@effected/pnpm root entry", () => {
	it("exports the pnpm-only modules moved in from npm, workspaces and lockfiles", async () => {
		assert.deepStrictEqual(Object.keys(await import("../src/index.js")).sort(), [
			"Epic",
			"OverrideKey",
			"OverrideKeyError",
			"PartialReleaseAgeGate",
			"PeerDependencyRules",
			"PnpmEnvDocument",
			"PnpmExtension",
			"PnpmLockDocument",
			"PnpmMatcher",
			"PnpmNpmConfig",
			"PnpmSettings",
			"PnpmSettingsError",
			"PnpmWorkspaceFile",
			"PnpmWorkspaceFileError",
			"ReleaseAgeGate",
			"VersioningConfig",
		]);
	});

	it("the root entry never reaches the settings catalog", () => {
		const reached = reachedFrom(join(SRC, "index.ts"));
		assert.isTrue(reached.modules.has(join(SRC, "PnpmSettings.ts")), "the control: the root graph was walked");
		assert.isFalse(reachesCatalog(reached, SRC), [...reached.modules, ...reached.packages].join(", "));
	});

	it("the built root entry never reaches the settings catalog", () => {
		const reached = reachedFrom(join(BUILT, "index.js"), readDisk, false);
		assert.isTrue(reached.modules.has(join(BUILT, "PnpmSettings.js")), "the control: the built graph was walked");
		assert.isFalse(reachesCatalog(reached, BUILT), [...reached.modules, ...reached.packages].join(", "));
	});

	it("the ./settings entry reaches the catalog, in source and built", () => {
		// The positive controls: the same walks find the catalog where it ships.
		assert.isTrue(reachesCatalog(reachedFrom(join(SRC, "settings.ts")), SRC));
		assert.isTrue(reachesCatalog(reachedFrom(join(BUILT, "settings.js"), readDisk, false), BUILT));
	});

	it("mutation control: a transitive import or a self-import is found, one in a comment is not", () => {
		const files: Record<string, string> = {
			"/pkg/src/index.ts": '// import "./settings/PnpmSettingsCatalog.js"\nexport { A } from "./a.js";',
			"/pkg/src/a.ts": 'export { B } from "./settings/PnpmSettingsCatalog.js";',
			"/pkg/src/settings/PnpmSettingsCatalog.ts": "export const B = 1;",
		};
		const read: Read = (file) => files[file] ?? "";
		assert.isTrue(reachesCatalog(reachedFrom("/pkg/src/index.ts", read), "/pkg/src"));
		files["/pkg/src/a.ts"] = 'export { B } from "@effected/pnpm/settings";';
		assert.isTrue(reachesCatalog(reachedFrom("/pkg/src/index.ts", read), "/pkg/src"));
		files["/pkg/src/a.ts"] = 'export { B } from "@effected/pnpm";';
		assert.isFalse(reachesCatalog(reachedFrom("/pkg/src/index.ts", read), "/pkg/src"));
	});
});
