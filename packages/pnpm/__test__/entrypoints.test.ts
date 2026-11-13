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

/** Every source module reachable from `entry` through relative specifiers, `.js` mapped to `.ts`. */
const modulesReachedFrom = (entry: string, read: Read = readDisk): ReadonlySet<string> => {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of specifiersOf(read(file)))
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier).replace(/\.js$/, ".ts"));
	}
	return seen;
};

const SETTINGS = join(SRC, "settings");
const reachesCatalog = (modules: ReadonlySet<string>): boolean =>
	[...modules].some((file) => file === join(SRC, "settings.ts") || file.startsWith(`${SETTINGS}/`));

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
			"PnpmSettings",
			"PnpmSettingsError",
			"ReleaseAgeGate",
			"VersioningConfig",
		]);
	});

	it("the root entry never reaches the settings catalog", () => {
		const reached = modulesReachedFrom(join(SRC, "index.ts"));
		assert.isTrue(reached.has(join(SRC, "PnpmSettings.ts")), "the control: the root graph was walked");
		assert.isFalse(reachesCatalog(reached), [...reached].join(", "));
	});

	it("the ./settings entry reaches the catalog", () => {
		// The positive control: the same walk finds the catalog where it ships.
		assert.isTrue(reachesCatalog(modulesReachedFrom(join(SRC, "settings.ts"))));
	});

	it("mutation control: a transitive import is found, one in a comment is not", () => {
		const files: Record<string, string> = {
			"/pkg/src/index.ts": '// import "./settings/PnpmSettingsCatalog.js"\nexport { A } from "./a.js";',
			"/pkg/src/a.ts": 'export { B } from "./settings/PnpmSettingsCatalog.js";',
			"/pkg/src/settings/PnpmSettingsCatalog.ts": "export const B = 1;",
		};
		const read: Read = (file) => files[file] ?? "";
		assert.isTrue(modulesReachedFrom("/pkg/src/index.ts", read).has("/pkg/src/settings/PnpmSettingsCatalog.ts"));
		files["/pkg/src/a.ts"] = "export const B = 1;";
		assert.isFalse(modulesReachedFrom("/pkg/src/index.ts", read).has("/pkg/src/settings/PnpmSettingsCatalog.ts"));
	});
});
