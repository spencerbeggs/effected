import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import { ConfigValidationError } from "../../src/errors.js";
import { copyPublicDir } from "../../src/passes/sync-public.js";

let root: string;
let src: string;
let out: string;

function write(base: string, rel: string, content: string): void {
	const abs = join(base, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "copy-public-"));
	src = join(root, "public");
	out = join(root, "out", "pkg");
	mkdirSync(out, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("copyPublicDir", () => {
	it("no-ops when the source does not exist", () => {
		assert.doesNotThrow(() => copyPublicDir(src, out));
	});

	it("accepts a source directory relative to the process cwd", () => {
		write(src, "a.txt", "a");
		const prevCwd = process.cwd();
		process.chdir(root);
		try {
			copyPublicDir("public", out);
		} finally {
			process.chdir(prevCwd);
		}
		assert.strictEqual(readFileSync(join(out, "a.txt"), "utf-8"), "a");
	});

	it("copies dotfiles, dot-directories and node_modules/ under public", () => {
		write(src, ".npmrc", "a");
		write(src, ".well-known/security.txt", "b");
		write(src, "node_modules/x/index.js", "c");
		copyPublicDir(src, out);
		assert.strictEqual(readFileSync(join(out, ".npmrc"), "utf-8"), "a");
		assert.strictEqual(readFileSync(join(out, ".well-known", "security.txt"), "utf-8"), "b");
		assert.strictEqual(readFileSync(join(out, "node_modules", "x", "index.js"), "utf-8"), "c");
	});

	it("flattens public/<path> to the out root (drops the public/ segment)", () => {
		write(src, "ecma.json", "{}");
		write(src, "tsconfig/action.json", "{ }");
		copyPublicDir(src, out);
		assert.strictEqual(readFileSync(join(out, "ecma.json"), "utf-8"), "{}");
		assert.strictEqual(readFileSync(join(out, "tsconfig/action.json"), "utf-8"), "{ }");
		assert.strictEqual(existsSync(join(out, "public")), false);
	});

	it("does NOT delete sibling files already in the out dir (additive)", () => {
		write(out, "index.js", "export {};");
		write(src, "ecma.json", "{}");
		copyPublicDir(src, out);
		assert.strictEqual(existsSync(join(out, "index.js")), true);
		assert.strictEqual(existsSync(join(out, "ecma.json")), true);
	});

	it("skips an identical prior copy without rewriting", () => {
		write(src, "ecma.json", "{}");
		write(out, "ecma.json", "{}");
		assert.doesNotThrow(() => copyPublicDir(src, out));
		assert.strictEqual(readFileSync(join(out, "ecma.json"), "utf-8"), "{}");
	});

	it("throws ConfigValidationError when a public path collides with a differing built output", () => {
		write(src, "index.js", "// public");
		write(out, "index.js", "// built output");
		assert.throws(() => copyPublicDir(src, out), ConfigValidationError);
	});

	it("throws ConfigValidationError when a public file collides with a built directory", () => {
		write(src, "foo", "public file");
		mkdirSync(join(out, "foo"), { recursive: true });
		assert.throws(() => copyPublicDir(src, out), ConfigValidationError);
	});

	it("throws ConfigValidationError when a nested public file collides with a built file at a parent path", () => {
		write(src, "foo/bar", "public nested");
		write(out, "foo", "built file");
		assert.throws(() => copyPublicDir(src, out), ConfigValidationError);
	});
});
