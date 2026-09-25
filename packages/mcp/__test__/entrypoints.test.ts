import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every relative import specifier in a module, resolved to a source path. */
const importsOf = (file: string): ReadonlyArray<string> => {
	const source = readFileSync(file, "utf8");
	const specifiers = [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) => match[1] ?? "");
	return specifiers.map((specifier) => resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
};

/** Every module reachable from an entrypoint, transitively. */
const reachableFrom = (entry: string): ReadonlySet<string> => {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const next of importsOf(file)) queue.push(next);
	}
	return seen;
};

/**
 * Every static RUNTIME import specifier in a module: `import type` and
 * `export type` declarations are erased at build time and skipped, a dynamic
 * `import()` is not a static import, and a bare package counts.
 */
const runtimeImportsOf = (file: string): ReadonlyArray<string> => {
	const source = readFileSync(file, "utf8");
	return [...source.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s+"([^"]+)"/gms)]
		.filter((match) => match[2] === undefined)
		.map((match) => match[3] ?? "");
};

/** Every module reachable from an entrypoint through static runtime imports, with the bare packages it loads. */
const runtimeGraphOf = (entry: string) => {
	const modules = new Set<string>();
	const packages = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || modules.has(file)) continue;
		modules.add(file);
		for (const specifier of runtimeImportsOf(file)) {
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
			else packages.add(specifier);
		}
	}
	return { modules, packages };
};

describe("./guard loads nothing before its guards listen", () => {
	it("./guard statically reaches only McpGuard, and no package at all", () => {
		const { modules, packages } = runtimeGraphOf(resolve(SRC, "guard.ts"));
		assert.deepStrictEqual([...modules].map((file) => file.slice(SRC.length + 1)).sort(), ["McpGuard.ts", "guard.ts"]);
		assert.deepStrictEqual([...packages], []);
	});

	it("the server half is behind a dynamic import", () => {
		assert.include(readFileSync(resolve(SRC, "McpGuard.ts"), "utf8"), 'await import("./internal/guardLaunch.js")');
	});

	it("positive control: the runtime walker does see static imports", () => {
		const { modules, packages } = runtimeGraphOf(resolve(SRC, "internal/guardLaunch.ts"));
		assert.isTrue([...modules].some((file) => file.endsWith("McpStdio.ts")));
		assert.include([...packages], "effect");
		// ...and skips a type-only import: guardLaunch imports McpGuard for a type alone.
		assert.isFalse([...modules].some((file) => file.endsWith("McpGuard.ts")));
	});
});

describe("entrypoint boundary", () => {
	it("nothing reachable from `.` imports the test clients", () => {
		const reachable = reachableFrom(resolve(SRC, "index.ts"));
		const offenders = [...reachable].filter((file) =>
			/src\/(McpHarness|McpProcess|McpProbe|McpToolAudit|McpTestFailure|McpWire|testing|internal\/wire)\.ts$/.test(
				file,
			),
		);
		assert.deepStrictEqual(offenders, [], "test clients belong behind ./testing");
	});

	it("positive control: ./testing DOES reach McpHarness", () => {
		const reachable = reachableFrom(resolve(SRC, "testing.ts"));
		assert.isAbove(reachable.size, 1, "the walker must actually resolve imports");
		assert.isTrue([...reachable].some((file) => /src\/McpHarness\.ts$/.test(file)));
	});

	it("the walker resolves the main entry's modules, or it proves nothing", () => {
		const reachable = reachableFrom(resolve(SRC, "index.ts"));
		assert.isTrue([...reachable].some((file) => /src\/McpStdio\.ts$/.test(file)));
	});
});
