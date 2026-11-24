// MarkdownlintConfigFile over an in-memory volume: reading one config file
// with its `extends` chain, and resolving the config that applies to a
// markdown file the way markdownlint-cli2 does (the nearest directory holding
// a supported `.markdownlint.*` decides; ancestors are not merged in).

import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { MarkdownlintConfigFile } from "../src/config/index.js";

const withVolume = (seed: Record<string, string>) => MemoryFileSystem.layerWithPath(seed);

const MAX_FILE_BYTES = 1024 * 1024;

describe("MarkdownlintConfigFile.read", () => {
	it.effect("parses a .json with comments and trailing commas", () =>
		Effect.gen(function* () {
			const config = yield* MarkdownlintConfigFile.read("/c/.markdownlint.json");
			assert.deepStrictEqual(config, { default: true, MD013: { line_length: 100 } });
		}).pipe(
			Effect.provide(
				withVolume({
					"/c/.markdownlint.json": '{\n\t// house style\n\t"default": true,\n\t"MD013": { "line_length": 100, },\n}\n',
				}),
			),
		),
	);

	it.effect("parses a .jsonc", () =>
		Effect.gen(function* () {
			const config = yield* MarkdownlintConfigFile.read("/c/.markdownlint.jsonc");
			assert.deepStrictEqual(config, { MD001: false });
		}).pipe(Effect.provide(withVolume({ "/c/.markdownlint.jsonc": '/* c */ { "MD001": false }' }))),
	);

	it.effect("parses a .yaml and a .yml", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* MarkdownlintConfigFile.read("/c/.markdownlint.yaml"), {
				default: false,
				MD013: { line_length: 20 },
			});
			assert.deepStrictEqual(yield* MarkdownlintConfigFile.read("/d/.markdownlint.yml"), { MD047: true });
		}).pipe(
			Effect.provide(
				withVolume({
					"/c/.markdownlint.yaml": "# c\ndefault: false\nMD013:\n  line_length: 20\n",
					"/d/.markdownlint.yml": "MD047: true\n",
				}),
			),
		),
	);

	it.effect("follows a relative extends and merges child over parent, dropping extends", () =>
		Effect.gen(function* () {
			const config = yield* MarkdownlintConfigFile.read("/repo/docs/.markdownlint.json");
			assert.deepStrictEqual(config, { default: false, MD001: true, MD013: { line_length: 40 }, MD047: true });
		}).pipe(
			Effect.provide(
				withVolume({
					"/repo/docs/.markdownlint.json": '{ "extends": "../base/rules.yaml", "MD013": { "line_length": 40 } }',
					"/repo/base/rules.yaml": "extends: /shared/root.json\nMD001: true\nMD013:\n  line_length: 80\n",
					"/shared/root.json": '{ "default": false, "MD001": false, "MD047": true }',
				}),
			),
		),
	);

	it.effect("ignores a falsy extends, as markdownlint does, keeping the key", () =>
		Effect.gen(function* () {
			const config = yield* MarkdownlintConfigFile.read("/c/.markdownlint.json");
			assert.deepStrictEqual(config, { extends: null, MD001: false });
		}).pipe(Effect.provide(withVolume({ "/c/.markdownlint.json": '{ "extends": null, "MD001": false }' }))),
	);

	it.effect("fails extends-missing naming the missing target", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(error._tag, "MarkdownlintConfigError");
			assert.strictEqual(error.reason, "extends-missing");
			assert.strictEqual(error.path, "/c/nope.json");
		}).pipe(Effect.provide(withVolume({ "/c/.markdownlint.json": '{ "extends": "./nope.json" }' }))),
	);

	it.effect("fails extends-cycle for a -> b -> a, naming the re-entered file", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/a.json"));
			assert.strictEqual(error.reason, "extends-cycle");
			assert.strictEqual(error.path, "/c/a.json");
		}).pipe(
			Effect.provide(
				withVolume({
					"/c/a.json": '{ "extends": "b.json" }',
					"/c/b.json": '{ "extends": "./a.json" }',
				}),
			),
		),
	);

	/** `/c/f0.json` extends `f1.json`, and so on: `links` extends links ending at a plain file. */
	const chain = (links: number): Record<string, string> => {
		const seed: Record<string, string> = {};
		for (let index = 0; index < links; index++) {
			seed[`/c/f${index}.json`] = `{ "extends": "f${index + 1}.json", "L${index}": true }`;
		}
		seed[`/c/f${links}.json`] = `{ "L${links}": true }`;
		return seed;
	};

	it.effect("follows 16 extends links", () =>
		Effect.gen(function* () {
			const config = yield* MarkdownlintConfigFile.read("/c/f0.json");
			assert.lengthOf(Object.keys(config), 17);
		}).pipe(Effect.provide(withVolume(chain(16)))),
	);

	it.effect("fails extends-depth at the 17th link, naming the refused file", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/f0.json"));
			assert.strictEqual(error.reason, "extends-depth");
			assert.strictEqual(error.path, "/c/f17.json");
		}).pipe(Effect.provide(withVolume(chain(17)))),
	);

	it.effect("fails parse for malformed content in the file that holds it", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(error.reason, "parse");
			assert.strictEqual(error.path, "/c/base.yaml");
		}).pipe(
			Effect.provide(
				withVolume({
					"/c/.markdownlint.json": '{ "extends": "base.yaml" }',
					"/c/base.yaml": "MD013: [unclosed\n",
				}),
			),
		),
	);

	it.effect("reads an empty, blank, comment-only or null document as an empty config, as cli2 does", () =>
		Effect.gen(function* () {
			for (const file of [
				"/e/empty.json",
				"/e/blank.json",
				"/e/line.jsonc",
				"/e/block.json",
				"/e/null.json",
				"/e/comment.yaml",
				"/e/null.yaml",
				"/e/tilde.yml",
			]) {
				assert.deepStrictEqual(yield* MarkdownlintConfigFile.read(file), {}, file);
			}
		}).pipe(
			Effect.provide(
				withVolume({
					"/e/empty.json": "",
					"/e/blank.json": "  \n\t\n",
					"/e/line.jsonc": "// only a comment\n",
					"/e/block.json": "/* only */\n",
					"/e/null.json": "null\n",
					"/e/comment.yaml": "# only a comment\n",
					"/e/null.yaml": "null\n",
					"/e/tilde.yml": "~\n",
				}),
			),
		),
	);

	// Named divergence: markdownlint reads a non-empty value that is not an
	// object (an array, a scalar) as {}; this package refuses it.
	it.effect("fails parse for a value that is not a plain object", () =>
		Effect.gen(function* () {
			for (const file of ["/c/array.json", "/c/scalar.yaml"]) {
				const error = yield* Effect.flip(MarkdownlintConfigFile.read(file));
				assert.strictEqual(error.reason, "parse", file);
				assert.strictEqual(error.path, file);
			}
		}).pipe(Effect.provide(withVolume({ "/c/array.json": "[1, 2]", "/c/scalar.yaml": "just text\n" }))),
	);

	it.effect("fails parse for an extends that is not a string, where markdownlint throws", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(error.reason, "parse");
			assert.strictEqual(error.path, "/c/.markdownlint.json");
		}).pipe(Effect.provide(withVolume({ "/c/.markdownlint.json": '{ "extends": ["./a.json"] }' }))),
	);

	it.effect("fails unreadable for a file that is not there", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(error.reason, "unreadable");
			assert.strictEqual(error.path, "/c/.markdownlint.json");
		}).pipe(Effect.provide(withVolume({}))),
	);

	it.effect("fails too-large for a 5 MiB file, and reads one at exactly the cap", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/big.json"));
			assert.strictEqual(error.reason, "too-large");
			assert.strictEqual(error.path, "/c/big.json");
			assert.deepStrictEqual(yield* MarkdownlintConfigFile.read("/c/cap.json"), { MD001: false });
		}).pipe(
			Effect.provide(
				withVolume({
					"/c/big.json": `{ "MD001": false }${" ".repeat(5 * MAX_FILE_BYTES)}`,
					"/c/cap.json": '{ "MD001": false }'.padEnd(MAX_FILE_BYTES, " "),
				}),
			),
		),
	);

	it.effect("refuses a file stat reports as not regular before reading it", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(error.reason, "unreadable");
			assert.strictEqual(error.path, "/c/fifo.json");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ "/c/.markdownlint.json": '{ "extends": "fifo.json" }', "/c/fifo.json": '{ "MD001": false }' },
					{
						// A FIFO or device reports size 0; reading one never ends, so it must not be read.
						faults: (base) => ({
							stat: (path) =>
								path === "/c/fifo.json"
									? base.stat(path).pipe(Effect.map((info) => ({ ...info, type: "FIFO" as const })))
									: undefined,
						}),
					},
				),
			),
		),
	);

	it.effect("checks the size before reading", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/big.json"));
			assert.strictEqual(error.reason, "too-large");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ "/c/big.json": " ".repeat(5 * MAX_FILE_BYTES) },
					{ faults: { readFile: () => Effect.die("readFile reached before the size check") } },
				),
			),
		),
	);

	// Named divergence: cli2 tries a TOML parser between JSONC and YAML; this
	// package does not, so TOML content fails parse.
	it.effect("fails parse for TOML content, which cli2 would accept", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(error.reason, "parse");
			assert.strictEqual(error.path, "/c/.markdownlint.json");
		}).pipe(Effect.provide(withVolume({ "/c/.markdownlint.json": "MD001 = false\n[MD013]\nline_length = 20\n" }))),
	);

	it.effect("fails unsupported for a .cjs, and for an extends naming a cli2 options file", () =>
		Effect.gen(function* () {
			const cjs = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.cjs"));
			assert.strictEqual(cjs.reason, "unsupported");
			assert.strictEqual(cjs.path, "/c/.markdownlint.cjs");
			const cli2 = yield* Effect.flip(MarkdownlintConfigFile.read("/c/.markdownlint.json"));
			assert.strictEqual(cli2.reason, "unsupported");
			assert.strictEqual(cli2.path, "/c/.markdownlint-cli2.jsonc");
		}).pipe(
			Effect.provide(
				withVolume({
					"/c/.markdownlint.cjs": "module.exports = {};",
					"/c/.markdownlint.json": '{ "extends": ".markdownlint-cli2.jsonc" }',
					"/c/.markdownlint-cli2.jsonc": '{ "config": {} }',
				}),
			),
		),
	);
});

describe("MarkdownlintConfigFile.resolve", () => {
	const layered = withVolume({
		"/r/.markdownlint.json": '{ "default": false, "MD047": true, "MD010": true }',
		"/r/a/b/.markdownlint.json": '{ "extends": "../../shared/base.json", "MD013": { "line_length": 20 } }',
		"/r/shared/base.json": '{ "default": false, "MD001": true }',
	});

	it.effect("uses the nearest directory's config alone: a farther one's keys are absent", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/a/b/doc.md", { root: "/r" });
			assert.deepStrictEqual(resolved.config, { default: false, MD001: true, MD013: { line_length: 20 } });
			assert.deepStrictEqual(resolved.files, ["/r/a/b/.markdownlint.json", "/r/shared/base.json"]);
			assert.deepStrictEqual(resolved.skipped, []);
		}).pipe(Effect.provide(layered)),
	);

	it.effect("inherits the nearest ancestor's config in a directory with none", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/a/doc.md", { root: "/r" });
			assert.deepStrictEqual(resolved.config, { default: false, MD047: true, MD010: true });
			assert.deepStrictEqual(resolved.files, ["/r/.markdownlint.json"]);
		}).pipe(Effect.provide(layered)),
	);

	it.effect("does not read above root", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/a/doc.md", { root: "/r/a" });
			assert.deepStrictEqual(resolved, { config: {}, files: [], skipped: [] });
		}).pipe(Effect.provide(layered)),
	);

	it.effect("skips a lone .markdownlint-cli2.jsonc without error", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/doc.md", { root: "/r" });
			assert.deepStrictEqual(resolved, { config: {}, files: [], skipped: ["/r/.markdownlint-cli2.jsonc"] });
		}).pipe(Effect.provide(withVolume({ "/r/.markdownlint-cli2.jsonc": '{ "config": { "MD001": false } }' }))),
	);

	it.effect("reads only the first of .jsonc, .json, .yaml, .yml in one directory", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/doc.md", { root: "/r" });
			assert.deepStrictEqual(resolved.config, { MD001: "jsonc" });
			assert.deepStrictEqual(resolved.files, ["/r/.markdownlint.jsonc"]);
			const json = yield* MarkdownlintConfigFile.resolve("/s/doc.md", { root: "/s" });
			assert.deepStrictEqual(json.files, ["/s/.markdownlint.json"]);
			const yaml = yield* MarkdownlintConfigFile.resolve("/t/doc.md", { root: "/t" });
			assert.deepStrictEqual(yaml.files, ["/t/.markdownlint.yaml"]);
		}).pipe(
			Effect.provide(
				withVolume({
					"/r/.markdownlint.jsonc": '{ "MD001": "jsonc" }',
					"/r/.markdownlint.json": '{ "MD001": "json" }',
					"/r/.markdownlint.yaml": "MD001: yaml\n",
					"/s/.markdownlint.json": '{ "MD001": "json" }',
					"/s/.markdownlint.yaml": "MD001: yaml\n",
					"/t/.markdownlint.yaml": "MD001: yaml\n",
					"/t/.markdownlint.yml": "MD001: yml\n",
				}),
			),
		),
	);

	it.effect("does not report unsupported files beside a supported one, which cli2 would not read either", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/doc.md", { root: "/r" });
			assert.deepStrictEqual(resolved, { config: { MD001: false }, files: ["/r/.markdownlint.json"], skipped: [] });
		}).pipe(
			Effect.provide(
				withVolume({
					"/r/.markdownlint.json": '{ "MD001": false }',
					"/r/.markdownlint.cjs": "module.exports = {};",
					"/r/.markdownlint-cli2.jsonc": "{}",
				}),
			),
		),
	);

	// Named divergence from markdownlint-cli2: a directory holding only an
	// unsupported config (.markdownlint.cjs / .mjs, or a .markdownlint-cli2.*)
	// is skipped and the walk continues to the parent. cli2 would load the JS
	// config and stop there.
	it.effect("skips a directory holding only unsupported files and keeps walking (divergence from cli2)", () =>
		Effect.gen(function* () {
			const resolved = yield* MarkdownlintConfigFile.resolve("/r/a/doc.md", { root: "/r" });
			assert.deepStrictEqual(resolved, {
				config: { MD047: true },
				files: ["/r/.markdownlint.yml"],
				skipped: ["/r/a/.markdownlint.cjs", "/r/a/.markdownlint-cli2.yaml"],
			});
		}).pipe(
			Effect.provide(
				withVolume({
					"/r/.markdownlint.yml": "MD047: true\n",
					"/r/a/.markdownlint.cjs": "module.exports = {};",
					"/r/a/.markdownlint-cli2.yaml": "config: {}\n",
				}),
			),
		),
	);

	it.effect("fails unreadable for a file outside root, naming the file", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.resolve("/elsewhere/doc.md", { root: "/r" }));
			assert.strictEqual(error.reason, "unreadable");
			assert.strictEqual(error.path, "/elsewhere/doc.md");
			const sibling = yield* Effect.flip(MarkdownlintConfigFile.resolve("/rx/doc.md", { root: "/r" }));
			assert.strictEqual(sibling.reason, "unreadable");
			assert.strictEqual(sibling.path, "/rx/doc.md");
		}).pipe(Effect.provide(layered)),
	);

	it.effect("refuses a directory named .markdownlint.json found on the walk", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.resolve("/r/a/doc.md", { root: "/r" }));
			assert.strictEqual(error.reason, "unreadable");
			assert.strictEqual(error.path, "/r/a/.markdownlint.json");
			assert.include(error.message, "not a regular file");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					"/r/.markdownlint.json": '{ "MD001": false }',
					"/r/a/.markdownlint.json": MemoryFileSystem.directory(),
				}),
			),
		),
	);

	it.effect("fails with the nearest file's own error rather than falling back to an ancestor", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MarkdownlintConfigFile.resolve("/r/a/doc.md", { root: "/r" }));
			assert.strictEqual(error.reason, "parse");
			assert.strictEqual(error.path, "/r/a/.markdownlint.json");
		}).pipe(
			Effect.provide(
				withVolume({ "/r/.markdownlint.json": '{ "MD001": false }', "/r/a/.markdownlint.json": "{ broken" }),
			),
		),
	);
});
