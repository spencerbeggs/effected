import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * Every import specifier in a module: relative ones resolved to a source path, bare ones as written. Statements only,
 * anchored at a line start so a specifier quoted in a TSDoc example is not one. The quote must follow the keyword
 * directly (a bare side-effect `import "./x.js"`) or a `from` within the same statement — which holds no `;`, `=`
 * or parenthesis — so neither an `export const` initializer nor a quoted example in a declaration's TSDoc is one.
 */
const importsOf = (file: string): ReadonlyArray<string> => {
	const source = readFileSync(file, "utf8");
	const specifiers = [...source.matchAll(/^(?:import|export)\s+(?:[^";=()]*?\sfrom\s+)?"([^"]+)"/gm)].map(
		(match) => match[1] ?? "",
	);
	return specifiers.map((specifier) =>
		specifier.startsWith(".") ? resolve(dirname(file), specifier.replace(/\.js$/, ".ts")) : specifier,
	);
};

/** Every module and bare specifier reachable from an entrypoint, transitively. */
const reachableFrom = (entry: string): ReadonlySet<string> => {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		if (file.startsWith("/")) for (const next of importsOf(file)) queue.push(next);
	}
	return seen;
};

describe("entrypoint boundary", () => {
	it("nothing reachable from `.` imports node:* or the Node watcher", () => {
		const reachable = reachableFrom(resolve(SRC, "index.ts"));
		const offenders = [...reachable].filter(
			(entry) => entry.startsWith("node:") || /src\/(NodeJournalWatcher|node)\.ts$/.test(entry),
		);
		assert.deepStrictEqual(offenders, [], "the platform backend belongs behind ./node");
	});

	it("positive control: ./node DOES reach node:fs and the Node watcher", () => {
		const reachable = reachableFrom(resolve(SRC, "node.ts"));
		assert.isTrue(reachable.has("node:fs"), "the walker must record bare specifiers");
		assert.isTrue([...reachable].some((entry) => /src\/NodeJournalWatcher\.ts$/.test(entry)));
	});

	it("the walker resolves the main entry's modules, or it proves nothing", () => {
		const reachable = reachableFrom(resolve(SRC, "index.ts"));
		assert.isTrue([...reachable].some((entry) => /src\/internal\/engine\.ts$/.test(entry)));
	});

	it("./node exports the Node watcher and nothing else", async () => {
		const node = await import("../src/node.js");
		assert.deepStrictEqual(Object.keys(node).sort(), ["NodeJournalWatcher"]);
	});
});
