import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");

/**
 * A module's code with its comments removed, line comments before block
 * comments, so a TSDoc example that imports the package is not read as an
 * import. `src/` holds no `//` inside a string literal, which is what makes
 * this naive stripper safe here.
 */
const codeOf = (source: string): string => source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every import specifier in a source text, in every import and re-export form. */
const specifiersIn = (source: string): ReadonlyArray<string> =>
	[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");

describe("@effected/source entrypoint", () => {
	it("exports LineIndex and no other runtime value", async () => {
		const main = await import("../src/index.js");
		assert.deepStrictEqual(Object.keys(main).sort(), ["LineIndex"]);
	});

	it("imports nothing but its own modules, so it stays dependency-free", () => {
		const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
		// positive control: the walk found the modules
		assert.includeMembers(files, ["index.ts", "LineIndex.ts", "SourceDiagnostic.ts"]);
		const foreign = files.flatMap((file) =>
			specifiersIn(codeOf(readFileSync(resolve(SRC, file), "utf8")))
				.filter((specifier) => !specifier.startsWith("./"))
				.map((specifier) => `${file}: ${specifier}`),
		);
		assert.deepStrictEqual(foreign, []);
	});

	it("the comment stripper keeps code and drops both comment forms", () => {
		const fixture = [
			'import { a } from "./kept.js";',
			'// import { b } from "line-comment";',
			'/** import { c } from "block-comment"; */',
			'export { d } from "./also-kept.js"; // trailing',
		].join("\n");
		assert.deepStrictEqual([...specifiersIn(codeOf(fixture))], ["./kept.js", "./also-kept.js"]);
	});

	it("the specifier scan sees a bare import in every form", () => {
		assert.include(specifiersIn(readFileSync(fileURLToPath(import.meta.url), "utf8")), "node:fs");
		const fixture = [
			'import "side-effect";',
			"import 'single-quoted';",
			'const lazy = await import("dynamic");',
			'export { thing } from "reexport";',
			'import type { T } from "type-only";',
		].join("\n");
		assert.deepStrictEqual([...specifiersIn(fixture)].sort(), [
			"dynamic",
			"reexport",
			"side-effect",
			"single-quoted",
			"type-only",
		]);
	});

	it("declares no dependency or peer of any kind", () => {
		const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
		for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
			assert.notProperty(manifest, field);
		}
		// positive control: the manifest read is live
		assert.property(manifest, "devDependencies");
		assert.strictEqual(manifest.sideEffects, false);
	});
});
