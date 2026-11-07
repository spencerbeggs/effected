import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * Every import specifier in a source text: `import ... from "x"`,
 * `export ... from "x"`, a bare `import "x"` and a dynamic `import("x")`.
 * Comments are stripped first (line before block), so a comment naming a
 * module is never read as an import.
 */
const specifiersIn = (source: string): ReadonlyArray<string> => {
	const code = source.replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
	return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");
};

const specifiersOf = (file: string): ReadonlyArray<string> => specifiersIn(readFileSync(file, "utf8"));

/** Every module reachable from an entrypoint through relative imports. */
const reachableFrom = (entry: string): ReadonlySet<string> => {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of specifiersOf(file)) {
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
		}
	}
	return seen;
};

describe("root entrypoint", () => {
	it("exports the public surface and nothing from src/internal", async () => {
		const main = await import("../src/index.js");
		assert.deepStrictEqual(Object.keys(main).sort(), [
			"S3Client",
			"S3InvalidRequest",
			"S3InvalidRequestReason",
			"S3ListPage",
			"S3MalformedResponse",
			"S3NotFound",
			"S3NotModified",
			"S3Object",
			"S3ObjectHead",
			"S3ObjectSummary",
			"S3Operation",
			"S3PreconditionFailed",
			"S3PutResult",
			"S3RequestFailed",
			"S3TransportError",
		]);
		const reexported = specifiersOf(resolve(SRC, "index.ts"));
		assert.isTrue(reexported.length > 0);
		assert.deepStrictEqual(
			reexported.filter((specifier) => specifier.includes("internal")),
			[],
		);
	});

	it("reaches every module and no node: import, so it runs on workerd", () => {
		const reachable = [...reachableFrom(resolve(SRC, "index.ts"))];
		// Positive control: the walk resolves through to the internal engines.
		for (const file of [
			"S3Client.ts",
			"internal/address.ts",
			"internal/xml.ts",
			"internal/documents.ts",
			"internal/headers.ts",
		]) {
			assert.isTrue(
				reachable.some((path) => path.endsWith(file)),
				file,
			);
		}
		const imports = reachable.flatMap((file) => specifiersOf(file).map((specifier) => ({ file, specifier })));
		assert.deepStrictEqual(
			imports.filter(({ specifier }) => specifier.startsWith("node:")),
			[],
		);
		// Only effect and the one sibling: the boundary tier's whole dependency surface.
		const bare = new Set(imports.map(({ specifier }) => specifier).filter((specifier) => !specifier.startsWith(".")));
		assert.deepStrictEqual(
			[...bare].filter(
				(specifier) => specifier !== "@effected/crypto" && specifier !== "effect" && !specifier.startsWith("effect/"),
			),
			[],
		);
		assert.isTrue(bare.has("@effected/crypto"));
	});

	it("the walker sees a node: import in every import form, and not in a comment", () => {
		assert.include(specifiersOf(fileURLToPath(import.meta.url)), "node:fs");
		const fixture = [
			'import "node:side-effect";',
			"import 'node:single-quoted';",
			'const lazy = await import("node:dynamic");',
			'export { thing } from "node:reexport";',
			'import type { T } from "node:type-only";',
			'// import "node:line-comment";',
			'/* import "node:block-comment"; */',
		].join("\n");
		assert.deepStrictEqual([...specifiersIn(fixture)].sort(), [
			"node:dynamic",
			"node:reexport",
			"node:side-effect",
			"node:single-quoted",
			"node:type-only",
		]);
	});
});
