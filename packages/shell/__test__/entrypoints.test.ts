// The tier, pinned: `effect` is the only import outside the package, the
// manifest declares no runtime dependency, and the entrypoint exports exactly
// the public surface.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import * as Shell from "../src/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const sources = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
	);

// Comments are stripped first, line comments before block comments, so a
// TSDoc `@example` import is not read as a real one.
const code = (text: string): string => text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// Module specifiers of static and dynamic imports and re-exports.
const SPECIFIER = /(?:(?<=[\s}*])from\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

describe("@effected/shell tier", () => {
	it("imports nothing but effect and its own modules", () => {
		const files = sources(join(root, "src"));
		assert.isAbove(files.length, 10, "the walk found the sources");
		const foreign = files.flatMap((file) =>
			[...code(readFileSync(file, "utf8")).matchAll(SPECIFIER)]
				.map((match) => match[1] as string)
				.filter((specifier) => !specifier.startsWith("./") && !specifier.startsWith("../") && specifier !== "effect")
				.map((specifier) => `${file}: ${specifier}`),
		);
		assert.deepStrictEqual(foreign, []);
	});

	it("the comment stripper keeps code and drops example imports", () => {
		const stripped = code(
			'// import a from "x";\n/**\n * import b from "y";\n */\nimport c from "effect";\nconst o = ["close-from", "x"];',
		);
		assert.deepStrictEqual(
			[...stripped.matchAll(SPECIFIER)].map((m) => m[1]),
			["effect"],
		);
	});

	it("declares no runtime dependency and peers on effect alone", () => {
		const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
		assert.isUndefined(manifest.dependencies);
		assert.deepStrictEqual(Object.keys(manifest.peerDependencies as object), ["effect"]);
		assert.strictEqual(manifest.sideEffects, false);
	});

	it("exports exactly the public runtime surface", () => {
		assert.deepStrictEqual(Object.keys(Shell).sort(), [
			"ShellAnsiCPart",
			"ShellArithmeticPart",
			"ShellAssignment",
			"ShellBarePart",
			"ShellBracePart",
			"ShellCommand",
			"ShellCommandSubstitutionPart",
			"ShellCommandWalk",
			"ShellComment",
			"ShellDiagnostic",
			"ShellDiagnosticCode",
			"ShellDoubleQuotedPart",
			"ShellExpansionPart",
			"ShellGlobPart",
			"ShellHeredoc",
			"ShellNestedScript",
			"ShellOpaquePart",
			"ShellOperator",
			"ShellProcessSubstitutionPart",
			"ShellRedirection",
			"ShellRedirectionOperator",
			"ShellScript",
			"ShellSegment",
			"ShellSingleQuotedPart",
			"ShellSubstitutionPart",
			"ShellSyntax",
			"ShellTildePart",
			"ShellTruncation",
			"ShellVariablePart",
			"ShellWord",
			"ShellWordPart",
		]);
	});
});
