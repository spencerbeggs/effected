import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { PluginLoadError, loadPlugins } from "../../src/index.js";

const importer =
	(modules: Readonly<Record<string, unknown>>) =>
	async (path: string): Promise<unknown> => {
		if (!(path in modules)) throw new Error(`no such module: ${path}`);
		return modules[path];
	};

describe("loadPlugins", () => {
	it.effect("takes a default export object with a name as one plugin", () =>
		Effect.gen(function* () {
			const plugin = { name: "one" };
			const plugins = yield* loadPlugins({
				cwd: "/pkg",
				modules: ["/pkg/one.ts"],
				importModule: importer({ "/pkg/one.ts": { default: plugin } }),
			});
			assert.lengthOf(plugins, 1);
			assert.strictEqual(plugins[0], plugin);
		}),
	);

	it.effect("calls a default export factory once", () =>
		Effect.gen(function* () {
			let calls = 0;
			const plugin = { name: "made" };
			const plugins = yield* loadPlugins({
				cwd: "/pkg",
				modules: ["/pkg/made.ts"],
				importModule: importer({
					"/pkg/made.ts": {
						default: () => {
							calls++;
							return plugin;
						},
					},
				}),
			});
			assert.strictEqual(calls, 1);
			assert.deepStrictEqual(plugins, [plugin]);
		}),
	);

	it.effect("resolves a relative path against cwd and leaves an absolute one alone", () =>
		Effect.gen(function* () {
			const seen: Array<string> = [];
			yield* loadPlugins({
				cwd: "/pkg",
				modules: ["./build/a.ts", "build/b.ts", "../c.ts", "/abs/d.ts"],
				importModule: async (path) => {
					seen.push(path);
					return { default: { name: path } };
				},
			});
			assert.deepStrictEqual(seen, ["/pkg/build/a.ts", "/pkg/build/b.ts", "/c.ts", "/abs/d.ts"]);
		}),
	);

	it.effect("keeps the order the modules were named in", () =>
		Effect.gen(function* () {
			const plugins = yield* loadPlugins({
				cwd: "/pkg",
				modules: ["b.ts", "a.ts"],
				importModule: importer({
					"/pkg/a.ts": { default: { name: "a" } },
					"/pkg/b.ts": { default: { name: "b" } },
				}),
			});
			assert.deepStrictEqual(
				plugins.map((plugin) => plugin.name),
				["b", "a"],
			);
		}),
	);

	it.effect("loads nothing for no modules, without importing", () =>
		Effect.gen(function* () {
			const plugins = yield* loadPlugins({
				cwd: "/pkg",
				modules: [],
				importModule: () => Promise.reject(new Error("must not import")),
			});
			assert.deepStrictEqual(plugins, []);
		}),
	);

	const rejected: ReadonlyArray<readonly [string, unknown, string]> = [
		["a module with no default export", { plugin: { name: "x" } }, "no default export"],
		["a null module", null, "no default export"],
		["a string default", { default: "x" }, "not a rolldown plugin"],
		["a default object with no name", { default: { resolveId() {} } }, "not a rolldown plugin"],
		["a default object with a non-string name", { default: { name: 1 } }, "not a rolldown plugin"],
		["a null default", { default: null }, "not a rolldown plugin"],
		["a factory returning a non-plugin", { default: () => ({}) }, "factory"],
		["a factory returning a function", { default: () => () => ({ name: "x" }) }, "factory"],
	];
	for (const [title, module, reason] of rejected) {
		it.effect(`names the path for ${title}`, () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					loadPlugins({ cwd: "/pkg", modules: ["bad.ts"], importModule: async () => module }),
				);
				assert.instanceOf(error, PluginLoadError);
				assert.strictEqual(error.path, "/pkg/bad.ts");
				assert.include(error.reason, reason);
				assert.include(error.message, "/pkg/bad.ts");
			}),
		);
	}

	it.effect("reports a factory that throws", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				loadPlugins({
					cwd: "/pkg",
					modules: ["bad.ts"],
					importModule: async () => ({
						default: () => {
							throw new Error("boom in factory");
						},
					}),
				}),
			);
			assert.strictEqual(error.path, "/pkg/bad.ts");
			assert.include(error.reason, "boom in factory");
		}),
	);

	it.effect("reports an import that rejects", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				loadPlugins({
					cwd: "/pkg",
					modules: ["bad.ts"],
					importModule: () => Promise.reject(new Error("boom in import")),
				}),
			);
			assert.strictEqual(error.path, "/pkg/bad.ts");
			assert.include(error.reason, "boom in import");
		}),
	);

	it.effect("reports an importer that throws synchronously", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				loadPlugins({
					cwd: "/pkg",
					modules: ["bad.ts"],
					importModule: () => {
						throw new Error("sync boom");
					},
				}),
			);
			assert.include(error.reason, "sync boom");
		}),
	);

	it.effect("stops at the first module that fails", () =>
		Effect.gen(function* () {
			const seen: Array<string> = [];
			yield* Effect.flip(
				loadPlugins({
					cwd: "/pkg",
					modules: ["bad.ts", "never.ts"],
					importModule: async (path) => {
						seen.push(path);
						return {};
					},
				}),
			);
			assert.deepStrictEqual(seen, ["/pkg/bad.ts"]);
		}),
	);
});

describe("loadPlugins default importer", () => {
	const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/plugins");

	it.effect("loads a TypeScript default export object", () =>
		Effect.gen(function* () {
			const plugins = yield* loadPlugins({ cwd, modules: ["./object.ts"] });
			assert.deepStrictEqual(
				plugins.map((plugin) => plugin.name),
				["fixture-object"],
			);
		}),
	);

	it.effect("loads a TypeScript default export factory", () =>
		Effect.gen(function* () {
			const plugins = yield* loadPlugins({ cwd, modules: ["./factory.ts"] });
			assert.deepStrictEqual(
				plugins.map((plugin) => plugin.name),
				["fixture-factory"],
			);
		}),
	);

	it.effect("fails on a TypeScript module with only named exports", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(loadPlugins({ cwd, modules: ["./named.ts"] }));
			assert.strictEqual(error.path, resolve(cwd, "named.ts"));
			assert.include(error.reason, "no default export");
		}),
	);

	it.effect("fails on a module that does not exist, naming its path", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(loadPlugins({ cwd, modules: ["./missing.ts"] }));
			assert.strictEqual(error.path, resolve(cwd, "missing.ts"));
		}),
	);
});
