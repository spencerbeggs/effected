// The main entry imports nothing platform-shaped: `FileSystem` and `Path`
// arrive through `R`, the sync forms take their port from the caller, and the
// Node binding lives behind `./node-sync`. This suite walks the main entry's
// relative imports and pins both halves, with a positive control.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

const specifiersOf = (file: string): ReadonlyArray<string> =>
	[...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

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

describe("entrypoint boundary", () => {
	const main = [...reachableFrom(resolve(SRC, "index.ts"))];

	it("nothing reachable from `.` is ./node-sync, and nothing imports a node: built-in", () => {
		assert.deepStrictEqual(
			main.filter((file) => file.endsWith("src/node-sync.ts")),
			[],
		);
		assert.deepStrictEqual(
			main.filter((file) => specifiersOf(file).some((specifier) => specifier.startsWith("node:"))),
			[],
		);
	});

	it("positive control: `.` reaches the sync walk and the shared machine; ./node-sync imports node:", () => {
		assert.isTrue(main.some((file) => file.endsWith("src/DescendSync.ts")));
		assert.isTrue(main.some((file) => file.endsWith("src/internal/descendMachine.ts")));
		assert.isTrue(specifiersOf(resolve(SRC, "node-sync.ts")).includes("node:fs"));
	});
});
