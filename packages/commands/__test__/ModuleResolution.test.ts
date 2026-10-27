import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { ModuleResolution } from "../src/ModuleResolution.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

const throwingEsm = (): string => {
	throw new Error("import.meta.resolve is not supported");
};

describe("ModuleResolution.resolve", () => {
	it("resolves from a directory anchor spelled without a trailing separator", () => {
		const resolved = ModuleResolution.resolve("effect", { from: PKG });
		assert.isTrue(Option.isSome(resolved));
		assert.include(Option.getOrThrow(resolved), "effect");
	});

	it("resolves from a module URL anchor, and from a directory with a trailing separator", () => {
		const fromUrl = ModuleResolution.resolve("effect", { from: import.meta.url });
		const fromSlash = ModuleResolution.resolve("effect", { from: `${PKG}/` });
		assert.deepStrictEqual(fromUrl, fromSlash);
		assert.isTrue(Option.isSome(fromUrl));
	});

	it("a directory anchor resolves INSIDE the directory, not from its parent", () => {
		const root = mkdtempSync(join(tmpdir(), "modres-"));
		try {
			const inner = join(root, "project");
			// `only-inside` is installed under project/node_modules — reachable from the project dir, not its parent.
			const installed = join(inner, "node_modules", "only-inside");
			mkdirSync(installed, { recursive: true });
			writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "only-inside", main: "index.js" }));
			writeFileSync(join(installed, "index.js"), "module.exports = 1;\n");
			assert.isTrue(Option.isSome(ModuleResolution.resolve("only-inside", { from: inner })));
			assert.isTrue(Option.isNone(ModuleResolution.resolve("only-inside", { from: root })));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("tries the ESM resolver first and takes its file: answer", () => {
		const target = join(PKG, "package.json");
		const resolved = ModuleResolution.resolve("anything", { from: PKG, esm: () => pathToFileURL(target).href });
		assert.deepStrictEqual(resolved, Option.some(target));
	});

	it("falls through to CommonJS when the ESM resolver throws (Vite's module runner)", () => {
		const viaThrow = ModuleResolution.resolve("effect", { from: PKG, esm: throwingEsm });
		assert.deepStrictEqual(viaThrow, ModuleResolution.resolve("effect", { from: PKG }));
		assert.isTrue(Option.isSome(viaThrow));
	});

	it("falls through to CommonJS when the ESM answer is not a file: URL", () => {
		const resolved = ModuleResolution.resolve("effect", { from: PKG, esm: () => "node:fs" });
		assert.deepStrictEqual(resolved, ModuleResolution.resolve("effect", { from: PKG }));
	});

	it("answers none for a missing package and for an unexported subpath, never throwing", () => {
		assert.isTrue(Option.isNone(ModuleResolution.resolve("definitely-not-installed-xyz", { from: PKG })));
		assert.isTrue(Option.isNone(ModuleResolution.resolve("effect/definitely-not-exported", { from: PKG })));
	});

	it("realPath resolves symlinks in an ESM answer; CommonJS resolution is already real", () => {
		const root = mkdtempSync(join(tmpdir(), "modres-"));
		try {
			const real = join(root, "real.js");
			writeFileSync(real, "");
			const link = join(root, "link.js");
			symlinkSync(real, link);
			const esm = () => pathToFileURL(link).href;
			assert.deepStrictEqual(ModuleResolution.resolve("x", { from: root, esm }), Option.some(link));
			assert.deepStrictEqual(
				ModuleResolution.resolve("x", { from: root, esm, realPath: true }),
				Option.some(realpathSync(real)),
			);
			// Node's require.resolve realpaths by default (no --preserve-symlinks).
			assert.deepStrictEqual(
				ModuleResolution.resolve("./link.js", { from: `${root}/` }),
				Option.some(realpathSync(real)),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("ModuleResolution.isStale", () => {
	it("is true only for a path or file: URL that no longer exists; a bare specifier is never stale", () => {
		const root = mkdtempSync(join(tmpdir(), "modres-"));
		const file = join(root, "entry.js");
		writeFileSync(file, "");
		try {
			assert.isFalse(ModuleResolution.isStale(file));
			assert.isFalse(ModuleResolution.isStale(pathToFileURL(file).href));
			rmSync(file);
			assert.isTrue(ModuleResolution.isStale(file));
			assert.isTrue(ModuleResolution.isStale(pathToFileURL(file).href));
			assert.isFalse(ModuleResolution.isStale("vitest/node"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("ModuleResolution.load", () => {
	it("hands the importer a file: URL for a path, and a URL or bare specifier through unchanged", async () => {
		const seen: Array<string> = [];
		const importer = async (url: string): Promise<unknown> => {
			seen.push(url);
			return { ok: url };
		};
		const path = join(PKG, "package.json");
		const namespace = await ModuleResolution.load(path, { importer });
		await ModuleResolution.load(pathToFileURL(path).href, { importer });
		await ModuleResolution.load("vitest/node", { importer });
		assert.deepStrictEqual(seen, [pathToFileURL(path).href, pathToFileURL(path).href, "vitest/node"]);
		assert.deepStrictEqual(namespace, { ok: pathToFileURL(path).href });
	});

	it("defaults to a real dynamic import", async () => {
		const resolved = Option.getOrThrow(ModuleResolution.resolve("effect", { from: PKG }));
		const namespace = (await ModuleResolution.load(resolved)) as { readonly Option?: unknown };
		assert.isDefined(namespace.Option);
	});
});
