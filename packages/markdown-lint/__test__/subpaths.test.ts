// The built subpaths reference the root rather than carrying a copy of it.
// `./rules`, `./rules/all` and `./config` name the root's types through the
// package's own name, kept external by `dtsExternals` in effected.toml, and API
// Extractor's resulting forgotten-export noise is suppressed for those three
// entries only.
// This file pins what that suppression could hide: an unexported declaration
// in either rolled-up `.d.ts`. It also pins the runtime half: the subpath
// modules import the root's modules, never inline a second copy of them.

import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import * as configExports from "../src/config/index.js";
import * as ruleExports from "../src/rules/index.js";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The npm group's package: the test pre-build refreshes it, and it is what ships. */
const BUILT = join(PACKAGE, "dist", "prod", "npm", "pkg");
const TSC = join(PACKAGE, "node_modules", ".bin", "tsc");

/** Each subpath, its built entry, and the names its declarations export (types included). */
const SUBPATHS = [
	{ subpath: "./rules", entry: "rules", exports: Object.keys(ruleExports) as ReadonlyArray<string> },
	{ subpath: "./rules/all", entry: "rules-all", exports: ["rules", "uncovered"] },
	{
		subpath: "./config",
		entry: "config",
		exports: [...Object.keys(configExports), "ResolvedLintConfig"] as ReadonlyArray<string>,
	},
] as const;

/** Where built JavaScript declares the LintRule class: the bundler writes `var LintRule = class …`. */
const DECLARES_LINT_RULE = /\b(?:class LintRule\b|LintRule = class\b)/;

/** Where built JavaScript declares the LintConfig class. */
const DECLARES_LINT_CONFIG = /\b(?:class LintConfig\b|LintConfig = class\b)/;

/** A trailing export list, `export { a, b };` or `export type { a, b };`: the bundler's form for interfaces and types. */
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\};?$/gm;

/** The names a rolled-up `.d.ts` exports through export lists. */
const listedExports = (dts: string): ReadonlySet<string> =>
	new Set(
		[...dts.matchAll(EXPORT_LIST)].flatMap((match) =>
			(match[1] ?? "")
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name !== ""),
		),
	);

/**
 * The Schema class bases a rolled-up `.d.ts` declares: a `*_base` const that an exported class
 * `extends`. Unexported by design, and suppressed by effected.toml's own `_base` pattern; any other
 * unexported declaration, a stray `*_base` included, still fails the gate.
 */
const schemaBases = (dts: string): ReadonlySet<string> =>
	new Set([...dts.matchAll(/\bextends\s+([A-Za-z_$][\w$]*_base)\b/g)].map((match) => match[1] ?? ""));

/** A top-level declaration in a rolled-up `.d.ts`: whether the line exports it, and its name. */
const TOP_LEVEL_DECLARATION =
	/^(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;

describe("the built subpaths", () => {
	const manifest = JSON.parse(readFileSync(join(BUILT, "package.json"), "utf8")) as {
		readonly exports?: Record<string, unknown>;
	};

	it("are exported by the published manifest", () => {
		for (const { subpath } of SUBPATHS) assert.property(manifest.exports, subpath, subpath);
	});

	it("declare only exported names, typed through the root rather than a copy", () => {
		for (const { entry, exports } of SUBPATHS) {
			const dts = readFileSync(join(BUILT, `${entry}.d.ts`), "utf8");
			const listed = listedExports(dts);
			const bases = schemaBases(dts);
			// Every top-level declaration is exported: an unexported one is what the scoped
			// ae-forgotten-export suppression in effected.toml would otherwise hide.
			assert.deepStrictEqual(
				[...dts.matchAll(TOP_LEVEL_DECLARATION)]
					.filter((match) => !bases.has(match[2] ?? ""))
					.map((match) => [match[1] !== undefined || listed.has(match[2] ?? ""), match[2]])
					.sort(),
				exports.map((name) => [true, name]).sort(),
				entry,
			);
			// No root declaration was rolled in: the root's types are only ever imported.
			assert.notMatch(dts, /declare class LintRule\b/, entry);
			assert.notMatch(dts, /declare class LintConfig\b/, entry);
		}
		const all = readFileSync(join(BUILT, "rules-all.d.ts"), "utf8");
		assert.include(all, 'import { LintRule } from "@effected/markdown-lint";');
		const config = readFileSync(join(BUILT, "config.d.ts"), "utf8");
		assert.include(config, 'import * as Lint from "@effected/markdown-lint";');
		assert.include(config, "readonly config: Lint.LintConfigRecord;");
	});

	it("import the root's modules at runtime rather than inlining them", () => {
		for (const { entry } of SUBPATHS) {
			const js = readFileSync(join(BUILT, `${entry}.js`), "utf8");
			assert.notMatch(js, DECLARES_LINT_RULE, entry);
			assert.notMatch(js, DECLARES_LINT_CONFIG, entry);
		}
		const configModule = readFileSync(join(BUILT, "config", "MarkdownlintConfigFile.js"), "utf8");
		assert.notMatch(configModule, DECLARES_LINT_CONFIG);
		assert.include(configModule, 'import { LintConfig } from "../LintConfig.js";');
	});

	it("build rules that are instances of the built root's LintRule", async () => {
		const root = await import(join(BUILT, "index.js"));
		const subpath = await import(join(BUILT, "rules.js"));
		const all = await import(join(BUILT, "rules-all.js"));
		assert.isTrue(subpath.MD009 instanceof root.LintRule);
		assert.isTrue(all.rules.includes(subpath.MD009));
		const findings = root.MarkdownLint.lint("text  \nmore   \n", [subpath.MD009]);
		assert.deepStrictEqual(
			findings.map((finding: { readonly lineNumber: number }) => finding.lineNumber),
			[2],
		);
	});

	it("declare LintRule and LintConfig in the root's modules alone", () => {
		const declaring = (pattern: RegExp) =>
			readdirSync(BUILT, { recursive: true, encoding: "utf8" })
				.filter((file) => file.endsWith(".js"))
				.filter((file) => pattern.test(readFileSync(join(BUILT, file), "utf8")));
		assert.deepStrictEqual(declaring(DECLARES_LINT_RULE), ["LintRule.js"]);
		assert.deepStrictEqual(declaring(DECLARES_LINT_CONFIG), ["LintConfig.js"]);
	});

	it("type-check in a consumer, with rules a real LintRule array rather than an unresolved any", () => {
		const consumer = `import type { LintRule } from "@effected/markdown-lint";
import { MarkdownLint } from "@effected/markdown-lint";
import { rules, uncovered } from "@effected/markdown-lint/rules/all";
import type { LintConfigRecord } from "@effected/markdown-lint";
import type { ResolvedLintConfig } from "@effected/markdown-lint/config";
import { MarkdownlintConfigError, MarkdownlintConfigFile } from "@effected/markdown-lint/config";

export const record = (resolved: ResolvedLintConfig): LintConfigRecord => resolved.config;
export const read = MarkdownlintConfigFile.read("/repo/.markdownlint.json");
export const reason = (error: MarkdownlintConfigError): string => error.reason;
export const typed: ReadonlyArray<LintRule> = rules;
export const names: ReadonlyArray<string> = uncovered;
export const findings = MarkdownLint.lint("# H\\n", rules);
`;
		// The live control: if the subpath's LintRule import failed to resolve, rules would be any and assign.
		const control = `import { rules } from "@effected/markdown-lint/rules/all";
export const wrong: number = rules;
`;
		// The same for ./config: an unresolved root import would make the config any.
		const configControl = `import type { ResolvedLintConfig } from "@effected/markdown-lint/config";
export const wrong = (resolved: ResolvedLintConfig): number => resolved.config;
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
			writeFileSync(join(fixture, "config-control.ts"), configControl);
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
					files: ["consumer.ts", "control.ts", "config-control.ts"],
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
			assert.isNotEmpty(
				lines.filter((line) => line.startsWith("config-control.ts")),
				"live control: a resolved config assigned to number is reported",
			);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 60_000);
});
