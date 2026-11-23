// The built rule subpaths reference the root rather than carrying a copy of it.
// `./rules` and `./rules/all` name the root's types through the package's own
// name, kept external by `dtsExternals` in effected.toml, and API Extractor's
// resulting forgotten-export noise is suppressed for those two entries only.
// This file pins what that suppression could hide: an unexported declaration
// in either rolled-up `.d.ts`. It also pins the runtime half: the subpath
// modules import the root's modules, never inline a second copy of them.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The npm group's package: the test pre-build refreshes it, and it is what ships. */
const BUILT = join(PACKAGE, "dist", "prod", "npm", "pkg");
const TSC = join(PACKAGE, "node_modules", ".bin", "tsc");

/** Each rule subpath, its built entry, and the names its declarations export. */
const SUBPATHS = [
	{ subpath: "./rules", entry: "rules", exports: [] as ReadonlyArray<string> },
	{ subpath: "./rules/all", entry: "rules-all", exports: ["rules", "uncovered"] },
] as const;

/** A top-level declaration in a rolled-up `.d.ts`: whether the line exports it, and its name. */
const TOP_LEVEL_DECLARATION =
	/^(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;

describe("the built rule subpaths", () => {
	const manifest = JSON.parse(readFileSync(join(BUILT, "package.json"), "utf8")) as {
		readonly exports?: Record<string, unknown>;
	};

	it("are exported by the published manifest", () => {
		for (const { subpath } of SUBPATHS) assert.property(manifest.exports, subpath, subpath);
	});

	it("declare only exported names, typed through the root rather than a copy", () => {
		for (const { entry, exports } of SUBPATHS) {
			const dts = readFileSync(join(BUILT, `${entry}.d.ts`), "utf8");
			// Every top-level declaration is exported: an unexported one is what the scoped
			// ae-forgotten-export suppression in effected.toml would otherwise hide.
			assert.deepStrictEqual(
				[...dts.matchAll(TOP_LEVEL_DECLARATION)].map((match) => [match[1] !== undefined, match[2]]),
				exports.map((name) => [true, name]),
				entry,
			);
			// No root declaration was rolled in: the root's types are only ever imported.
			assert.notMatch(dts, /declare class LintRule\b/, entry);
		}
		const all = readFileSync(join(BUILT, "rules-all.d.ts"), "utf8");
		assert.include(all, 'import { LintRule } from "@effected/markdown-lint";');
	});

	it("import the root's modules at runtime rather than inlining them", () => {
		for (const { entry } of SUBPATHS) {
			const js = readFileSync(join(BUILT, `${entry}.js`), "utf8");
			assert.notMatch(js, /class LintRule\b/, entry);
		}
	});

	it("type-check in a consumer, with rules a real LintRule array rather than an unresolved any", () => {
		const consumer = `import type { LintRule } from "@effected/markdown-lint";
import { MarkdownLint } from "@effected/markdown-lint";
import { rules, uncovered } from "@effected/markdown-lint/rules/all";

export const typed: ReadonlyArray<LintRule> = rules;
export const names: ReadonlyArray<string> = uncovered;
export const findings = MarkdownLint.lint("# H\\n", rules);
`;
		// The live control: if the subpath's LintRule import failed to resolve, rules would be any and assign.
		const control = `import { rules } from "@effected/markdown-lint/rules/all";
export const wrong: number = rules;
`;
		const fixture = mkdtempSync(join(tmpdir(), "markdown-lint-subpaths-"));
		try {
			mkdirSync(join(fixture, "node_modules", "@effected"), { recursive: true });
			symlinkSync(BUILT, join(fixture, "node_modules", "@effected", "markdown-lint"), "dir");
			for (const dependency of ["effect", "@effected/markdown"]) {
				symlinkSync(
					realpathSync(join(PACKAGE, "node_modules", dependency)),
					join(fixture, "node_modules", dependency),
					"dir",
				);
			}
			writeFileSync(join(fixture, "consumer.ts"), consumer);
			writeFileSync(join(fixture, "control.ts"), control);
			writeFileSync(
				join(fixture, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						exactOptionalPropertyTypes: true,
						module: "nodenext",
						moduleResolution: "nodenext",
						target: "es2022",
						noEmit: true,
						skipLibCheck: true,
						types: [],
					},
					files: ["consumer.ts", "control.ts"],
				}),
			);
			const result = spawnSync(TSC, ["-p", "."], { cwd: fixture, encoding: "utf8" });
			const lines = `${result.stdout}${result.stderr}`
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "");
			assert.deepStrictEqual(
				lines.filter((line) => line.startsWith("consumer.ts")),
				[],
			);
			const controlLines = lines.filter((line) => line.startsWith("control.ts"));
			assert.isNotEmpty(controlLines, "live control: rules assigned to number is reported, so the gate can fail");
			assert.isTrue(
				controlLines.some((line) => line.includes("LintRule")),
				`the control fails for the rules' type: ${controlLines.join(" | ")}`,
			);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 60_000);
});
