import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";

const SRC = join(import.meta.dirname, "..", "src");

const files = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
	);

/** Strips line and block comments; good enough for this package's source (no regex or template literals mention process). */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Replaced by @effected/workspaces/testing SourceBoundary in phase 3.
describe("engine purity", () => {
	it("walks a non-empty source tree (positive control)", () => {
		assert.isAbove(files(SRC).length, 2);
	});

	it("no source file reads process", () => {
		const offenders = files(SRC).filter((file) => /\bprocess\b/.test(code(readFileSync(file, "utf8"))));
		assert.deepStrictEqual(
			offenders.map((file) => relative(SRC, file)),
			[],
		);
	});

	it("no source file imports node: or a platform package", () => {
		const offenders = files(SRC).filter((file) => /from\s+"(node:|@effect\/platform)/.test(readFileSync(file, "utf8")));
		assert.deepStrictEqual(
			offenders.map((file) => relative(SRC, file)),
			[],
		);
	});

	it("the scanner catches a planted process read (negative control)", () => {
		assert.isTrue(/\bprocess\b/.test(code("const { env } = process;")));
		assert.isFalse(/\bprocess\b/.test(code("// process is mentioned only in a comment")));
	});
});
