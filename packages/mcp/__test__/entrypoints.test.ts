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
