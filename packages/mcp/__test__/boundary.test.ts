import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";

const SRC = join(import.meta.dirname, "..", "src");

const files = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
	);

/** Strips comments and module specifiers: `effect/unstable/process` is an import path, not a read. */
const code = (text: string): string =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "")
		.replace(/from\s+"[^"]*"/g, "");

const offenders = (pattern: RegExp): ReadonlyArray<string> =>
	files(SRC)
		.filter((file) => pattern.test(code(readFileSync(file, "utf8"))))
		.map((file) => relative(SRC, file));

// Replaced by @effected/workspaces/testing SourceBoundary in phase 3.
describe("mcp boundary", () => {
	it("walks a non-empty source tree (positive control)", () => {
		assert.isAbove(files(SRC).length, 2);
	});

	it("no source file reads process", () => {
		assert.deepStrictEqual(offenders(/\bprocess\b/), []);
	});

	it("no source file writes through the global console: stdout is the JSON-RPC wire", () => {
		assert.deepStrictEqual(offenders(/\bconsole\./), []);
	});

	it("no source file imports node: or a platform package", () => {
		const hits = files(SRC).filter((file) => /from\s+"(node:|@effect\/platform)/.test(readFileSync(file, "utf8")));
		assert.deepStrictEqual(
			hits.map((file) => relative(SRC, file)),
			[],
		);
	});

	it("the scanner catches planted offences and ignores what it should (negative controls)", () => {
		assert.isTrue(/\bprocess\b/.test(code("const { env } = process;")));
		assert.isFalse(/\bprocess\b/.test(code('import { ChildProcess } from "effect/unstable/process";')));
		assert.isFalse(/\bprocess\b/.test(code("// process is mentioned only in a comment")));
		assert.isTrue(/\bconsole\./.test(code("console.log(line);")));
		assert.isFalse(/\bconsole\./.test(code("const current = yield* Console.Console;")));
	});
});
