import { existsSync, readFileSync } from "node:fs";
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
			if (!specifier.startsWith(".")) continue;
			// Source imports name the emitted .js; read the .ts beside it when there is one (a built package has none).
			const target = resolve(dirname(file), specifier);
			const source = target.replace(/\.js$/, ".ts");
			queue.push(existsSync(source) ? source : target);
		}
	}
	return seen;
};

describe("root entrypoint", () => {
	it("exports the public surface and nothing from src/internal", async () => {
		const main = await import("../src/index.js");
		assert.deepStrictEqual(Object.keys(main).sort(), [
			"GitHub",
			"HmacHeader",
			"Sanity",
			"SharedSecret",
			"StandardWebhooks",
			"Stripe",
			"WebhookPreset",
			"WebhookVerificationError",
			"WebhookVerificationReason",
			"Webhooks",
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
		// positive control: the walker resolves through to the internal engines
		assert.isTrue(reachable.some((file) => file.endsWith("internal/verify.ts")));
		assert.isTrue(reachable.some((file) => file.endsWith("StandardWebhooks.ts")));
		assert.isTrue(reachable.some((file) => file.endsWith("SharedSecret.ts")));
		const nodeImports = reachable.flatMap((file) =>
			specifiersOf(file)
				.filter((specifier) => specifier.startsWith("node:"))
				.map((specifier) => `${file}: ${specifier}`),
		);
		assert.deepStrictEqual(nodeImports, []);
	});

	it("depends on a @effected/crypto build that imports nothing from node: either", () => {
		const entry = fileURLToPath(import.meta.resolve("@effected/crypto"));
		const reachable = [...reachableFrom(entry)];
		// positive control: the walk reached the built engines and read real imports
		assert.isTrue(reachable.some((file) => file.endsWith("internal/hmac.js")));
		assert.isTrue(specifiersOf(entry).some((specifier) => specifier.startsWith("./")));
		const nodeImports = reachable.flatMap((file) =>
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
