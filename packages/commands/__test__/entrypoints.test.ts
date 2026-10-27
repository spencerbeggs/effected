// The main entry imports nothing platform-shaped: the spawner arrives through
// `R`, and the sync facade's Node binding lives behind `./node-sync`. A
// re-export of that subpath from `src/index.ts` would put `node:child_process`
// in front of every consumer, so this suite walks the main entry's relative
// imports and pins both halves.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every `from "…"` / `import "…"` specifier in a module's source. */
const specifiersOf = (file: string): ReadonlyArray<string> =>
	[...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

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

describe("entrypoint boundary", () => {
	const main = [...reachableFrom(resolve(SRC, "index.ts"))];

	it("nothing reachable from `.` is ./node-sync", () => {
		assert.deepStrictEqual(
			main.filter((file) => file.endsWith("src/node-sync.ts")),
			[],
		);
	});

	it("nothing reachable from `.` imports a node: built-in", () => {
		const offenders = main.filter((file) => specifiersOf(file).some((specifier) => specifier.startsWith("node:")));
		assert.deepStrictEqual(offenders, []);
	});

	it("positive control: the walker reaches the sync facade, and ./node-sync does import node:", () => {
		assert.isTrue(main.some((file) => file.endsWith("src/ToolDiscoverySync.ts")));
		assert.isTrue(specifiersOf(resolve(SRC, "node-sync.ts")).includes("node:child_process"));
	});

	it("positive control: `.` reaches the new pure modules, and only ./node-sync reaches the Node-bound ones", () => {
		for (const module of ["src/RunOnce.ts", "src/internal/runOnceMachine.ts", "src/PrebuiltBinary.ts"]) {
			assert.isTrue(
				main.some((file) => file.endsWith(module)),
				module,
			);
		}
		const nodeSync = [...reachableFrom(resolve(SRC, "node-sync.ts"))];
		for (const module of ["src/ModuleResolution.ts", "src/internal/anchor.ts"]) {
			assert.isTrue(
				nodeSync.some((file) => file.endsWith(module)),
				module,
			);
			assert.isFalse(
				main.some((file) => file.endsWith(module)),
				module,
			);
		}
	});
});
