import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * Every import specifier in a source text: `import ... from "x"` and
 * `export ... from "x"`, a bare side-effect `import "x"`, and a dynamic
 * `import("x")`.
 */
const specifiersIn = (source: string): ReadonlyArray<string> =>
	[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");

/** Every import specifier in a module. */
const specifiersOf = (file: string): ReadonlyArray<string> => specifiersIn(readFileSync(file, "utf8"));

/** Every module reachable from an entrypoint through relative imports, transitively. */
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
			"JoseHeader",
			"Jwk",
			"Jwks",
			"JwksResolver",
			"JwksStore",
			"Jws",
			"Jwt",
			"JwtError",
			"JwtErrorReason",
			"JwtKey",
			"RegisteredClaims",
			"SigningKey",
			"VerificationKey",
		]);
		const reexported = specifiersOf(resolve(SRC, "index.ts"));
		assert.isTrue(reexported.length > 0);
		assert.deepStrictEqual(
			reexported.filter((specifier) => specifier.includes("internal")),
			[],
		);
	});

	it("reaches every module and no node: import, so it runs on workerd", () => {
		const reachable = new Set([
			...reachableFrom(resolve(SRC, "index.ts")),
			...reachableFrom(resolve(SRC, "testing.ts")),
		]);
		assert.isTrue([...reachable].some((file) => file.endsWith("testing.ts")));
		// positive control: the walker resolves through to the internal engines
		assert.isTrue([...reachable].some((file) => file.endsWith("internal/der.ts")));
		assert.isTrue([...reachable].some((file) => file.endsWith("JwksResolver.ts")));
		const nodeImports = [...reachable].flatMap((file) =>
			specifiersOf(file)
				.filter((specifier) => specifier.startsWith("node:"))
				.map((specifier) => `${file}: ${specifier}`),
		);
		assert.deepStrictEqual(nodeImports, []);
	});

	it("the walker sees a node: import in every import form", () => {
		assert.include(specifiersOf(fileURLToPath(import.meta.url)), "node:fs");
		const fixture = [
			'import "node:side-effect";',
			"import 'node:single-quoted';",
			'const lazy = await import("node:dynamic");',
			'export { thing } from "node:reexport";',
			'import type { T } from "node:type-only";',
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
