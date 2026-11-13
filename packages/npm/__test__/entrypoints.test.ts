// The root entry stays runtime-neutral: a Workers consumer imports
// `@effected/npm` with no `@effect/platform-node` installed (it is an
// optional peer), so nothing the root reaches may import it. Only `./node`
// does. Checked over the source graph, which is what the build bundles.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const PLATFORM = "@effect/platform-node";

type Read = (file: string) => string;
const readDisk: Read = (file) => readFileSync(file, "utf8");

/** Line comments first, then blocks: a `/*`-bearing word in a line comment must not open a phantom block. */
const stripComments = (text: string): string => text.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every specifier a module loads: imports, re-exports, side-effect imports and `import("<literal>")`. */
const specifiersOf = (text: string): ReadonlyArray<string> =>
	[...stripComments(text).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/g)].map(
		(match) => match[2] ?? "",
	);

/** The package specifiers every source module reachable from `entry` loads, sorted. `.js` specifiers map to `.ts`. */
const packagesReachedFrom = (entry: string, read: Read = readDisk): ReadonlyArray<string> => {
	const seen = new Set<string>();
	const packages = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of specifiersOf(read(file))) {
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier).replace(/\.js$/, ".ts"));
			else packages.add(specifier);
		}
	}
	return [...packages].sort();
};

const reachesPlatform = (packages: ReadonlyArray<string>): boolean =>
	packages.some((name) => name === PLATFORM || name.startsWith(`${PLATFORM}/`));

describe("entrypoints", () => {
	it("the root entry never imports @effect/platform-node", () => {
		const reached = packagesReachedFrom(join(SRC, "index.ts"));
		assert.include(reached, "effect", "the control: the root graph was walked");
		assert.isFalse(reachesPlatform(reached), `the root reaches ${reached.join(", ")}`);
	});

	it("the ./node entry reaches @effect/platform-node", () => {
		// The positive control: the same walk does find the peer where it is used.
		assert.isTrue(reachesPlatform(packagesReachedFrom(join(SRC, "node.ts"))));
	});

	it("mutation control: a transitive import is found, one in a comment is not", () => {
		const files: Record<string, string> = {
			"/pkg/index.ts": '// import "@effect/platform-node/Undici"\nexport { A } from "./a.js";',
			"/pkg/a.ts": 'export { B } from "./b.js";',
			"/pkg/b.ts": 'import { Agent } from "@effect/platform-node/Undici";\nexport const B = Agent;',
		};
		const read: Read = (file) => files[file] ?? "";
		assert.deepStrictEqual(packagesReachedFrom("/pkg/index.ts", read), ["@effect/platform-node/Undici"]);
		files["/pkg/b.ts"] = "export const B = 1;";
		assert.deepStrictEqual(packagesReachedFrom("/pkg/index.ts", read), []);
	});

	it("the pnpm-only release-age gate moved to @effected/pnpm", async () => {
		const root = await import("../src/index.js");
		assert.notProperty(root, "ReleaseAgeGate");
		assert.notProperty(root, "PartialReleaseAgeGate");
		// The control: the shared resolver contracts stay here.
		assert.property(root, "CatalogResolver");
		assert.property(root, "WorkspaceResolver");
	});
});
