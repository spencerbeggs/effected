import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * Every import specifier in a module — static `from`, side-effect `import "…"`,
 * and dynamic `import("…")` alike, type-only included: a type-only import of
 * an optional peer still breaks type resolution for a consumer who skipped it.
 */
const specifiersOf = (file: string): ReadonlyArray<string> => {
	const source = readFileSync(file, "utf8");
	const patterns = [/from\s+"([^"]+)"/g, /import\s+"([^"]+)"/g, /import\(\s*"([^"]+)"\s*\)/g];
	return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
};

/** Every module reachable from an entrypoint, with every bare specifier those modules name. */
const reachableFrom = (entry: string): { readonly files: ReadonlySet<string>; readonly bare: ReadonlySet<string> } => {
	const files = new Set<string>();
	const bare = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || files.has(file)) continue;
		files.add(file);
		for (const specifier of specifiersOf(file)) {
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
			else bare.add(specifier);
		}
	}
	return { files, bare };
};

describe("entrypoint boundary", () => {
	it("nothing reachable from `.` names @effected/memfs or the testing modules", () => {
		const { files, bare } = reachableFrom(resolve(SRC, "index.ts"));
		const offenders = [...files].filter((file) => /src\/(AppTest|testing)\.ts$/.test(file));
		assert.deepStrictEqual(offenders, [], "test utilities belong behind ./testing");
		const peers = [...bare].filter(
			(specifier) => specifier === "@effected/memfs" || specifier.startsWith("@effected/memfs/"),
		);
		assert.deepStrictEqual(peers, [], "@effected/memfs is an optional peer the root must never reach");
		assert.isFalse(
			bare.has("@effected/app/testing"),
			"a self-reference is a way into ./testing no relative edge shows",
		);
	});

	it("positive control: ./testing DOES reach AppTest and @effected/memfs", () => {
		const { files, bare } = reachableFrom(resolve(SRC, "testing.ts"));
		assert.isTrue([...files].some((file) => /src\/AppTest\.ts$/.test(file)));
		assert.isTrue(bare.has("@effected/memfs"));
	});

	it("the walker resolves the main entry's modules, or it proves nothing", () => {
		const { files, bare } = reachableFrom(resolve(SRC, "index.ts"));
		assert.isTrue([...files].some((file) => /src\/AppStore\.ts$/.test(file)));
		assert.isTrue(bare.has("@effected/store"));
	});

	it("the main entry and ./testing export disjoint surfaces", async () => {
		const main = await import("../src/index.js");
		const testing = await import("../src/testing.js");
		assert.deepStrictEqual(Object.keys(main).sort(), ["App", "AppCache", "AppConfig", "AppStore"]);
		assert.deepStrictEqual(Object.keys(testing).sort(), ["AppTest"]);
		assert.notProperty(main.App, "layerTest");
	});
});
