import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import * as Main from "../src/index.js";
import * as Testing from "../src/testing.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every relative import specifier in a module, `import type` included, resolved to a source path. */
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

const TEST_TOOLING = /src\/(LspProbe|LspProcess|LspTestFailure|testing|internal\/messages)\.ts$/;

describe("entrypoint boundary", () => {
	it("nothing reachable from `.` imports the probe or the process client", () => {
		const offenders = [...reachableFrom(resolve(SRC, "index.ts"))].filter((file) => TEST_TOOLING.test(file));
		assert.deepStrictEqual(offenders, [], "test tooling belongs behind ./testing");
	});

	it("positive control: the walker resolves the main entry's modules", () => {
		const reachable = reachableFrom(resolve(SRC, "index.ts"));
		assert.isTrue([...reachable].some((file) => /src\/LspFrame\.ts$/.test(file)));
		assert.isTrue([...reachable].some((file) => /src\/LspStdio\.ts$/.test(file)));
	});

	it("positive control: ./testing DOES reach the probe, and the same pattern sees it", () => {
		const reachable = [...reachableFrom(resolve(SRC, "testing.ts"))];
		assert.isTrue(reachable.some((file) => /src\/LspProbe\.ts$/.test(file)));
		assert.isTrue(reachable.some((file) => /src\/LspProcess\.ts$/.test(file)));
		assert.isTrue(reachable.some((file) => TEST_TOOLING.test(file)));
	});

	it("each entrypoint exports exactly its runtime names", () => {
		assert.deepStrictEqual(Object.keys(Main).sort(), ["LspFrame", "LspFrameError", "LspFrameErrorCode", "LspStdio"]);
		assert.deepStrictEqual(Object.keys(Testing).sort(), ["LspProbe", "LspProcess", "LspTestFailure"]);
	});
});
