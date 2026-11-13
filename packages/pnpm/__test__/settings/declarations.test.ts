// The ./settings entry's built declarations. `effected.toml` suppresses
// `ae-forgotten-export` for `entry point settings.d.ts` because the second API
// Extractor pass reports every root type the catalog reaches through the
// self-referencing `@effected/pnpm` import. That suppression would also hide a
// type local to the settings entry left unexported; this test is what makes it
// safe, by reading the built declarations the root vitest setup refreshes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const BUILT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "prod", "npm", "pkg");

/** A top-level declaration in a rolled-up `.d.ts`: whether the line exports it, and its name. */
const TOP_LEVEL_DECLARATION =
	/^(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;

/** Names exported through `export { … }` / `export type { … }` blocks with no `from`. */
const exportBlockNames = (dts: string): ReadonlyArray<string> =>
	[...dts.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*;?\s*$/gm)].flatMap((match) =>
		(match[1] ?? "")
			.split(",")
			.map((name) => name.trim().replace(/^type\s+/, ""))
			.filter((name) => name.length > 0),
	);

/** The entry's declarations: each name and whether it is exported, sorted by name. */
const declarationsOf = (dts: string): ReadonlyArray<readonly [string, boolean]> => {
	const blockExports = new Set(exportBlockNames(dts));
	return [...dts.matchAll(TOP_LEVEL_DECLARATION)]
		.map((match): readonly [string, boolean] => {
			const name = match[2] ?? "";
			return [name, match[1] !== undefined || blockExports.has(name)];
		})
		.sort(([a], [b]) => a.localeCompare(b));
};

describe("the built ./settings declarations", () => {
	const dts = readFileSync(join(BUILT, "settings.d.ts"), "utf8");

	it("declare only the exported settings surface", () => {
		assert.deepStrictEqual(declarationsOf(dts), [
			["PnpmSetting", true],
			["PnpmSettingKind", true],
			["PnpmSettingLocation", true],
			["PnpmSettingName", true],
			["PnpmSettingsCatalog", true],
			["PnpmSettingType", true],
			["readSetting", true],
		]);
	});

	it("name the root's types through the root rather than carrying copies", () => {
		assert.match(dts, /^import \{[^}]*\bPeerDependencyRules\b[^}]*\} from "@effected\/pnpm";$/m);
		assert.match(dts, /^import \{[^}]*\bVersioningConfig\b[^}]*\} from "@effected\/pnpm";$/m);
		assert.match(dts, /^import \{[^}]*\bPnpmSettings\b[^}]*\} from "@effected\/pnpm";$/m);
		assert.notMatch(dts, /^(?:export\s+)?declare\s+class\s+(?:PnpmSettings|PeerDependencyRules|VersioningConfig)\b/m);
	});

	it("mutation control: an unexported local declaration is reported", () => {
		const mutated = `${dts}\ninterface Leaked {\n}\n`;
		assert.deepInclude(declarationsOf(mutated), ["Leaked", false]);
	});
});
