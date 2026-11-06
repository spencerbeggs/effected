import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { ActionBundle, BuildResult, BundleFailed, BundleResult, BundleStats } from "../../src/index.js";
import { configOf, runBundle, withFiles } from "./action-fixture.js";

const MAIN = { "src/main.ts": 'console.log("main");\n' };

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("ActionBundle.build", () => {
	it.live("emits one file per entry, and reports each", () =>
		withFiles(
			{
				...MAIN,
				"src/pre.ts": 'console.log("pre");\n',
				"src/cleanup.ts": 'console.log("post");\n',
				"src/worker.ts": 'console.log("worker");\n',
				"src/lazy.ts": "export const lazy = 1;\n",
				"src/dynamic.ts": 'const { lazy } = await import("./lazy.ts");\nconsole.log(lazy);\n',
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* ActionBundle.build(
						configOf({
							entries: { post: "src/cleanup.ts", workers: { worker: "src/worker.ts", dynamic: "src/dynamic.ts" } },
						}),
						{ cwd, clean: true },
					);
					assert.instanceOf(result, BuildResult);
					assert.isTrue(result.success);
					assert.sameMembers(readdirSync(join(cwd, "dist")), [
						"main.js",
						"pre.js",
						"post.js",
						"worker.js",
						"dynamic.js",
						"package.json",
					]);
					assert.strictEqual(readFileSync(join(cwd, "dist", "package.json"), "utf8"), '{ "type": "module" }');
					assert.deepStrictEqual(
						result.entries.map((entry) => entry.stats?.entry),
						["main", "pre", "post", "worker", "dynamic"],
					);
					const main = result.entries[0];
					assert.instanceOf(main, BundleResult);
					assert.instanceOf(main?.stats, BundleStats);
					assert.strictEqual(main?.stats?.outputPath, "dist/main.js");
					assert.strictEqual(main?.stats?.size, readFileSync(join(cwd, "dist", "main.js")).length);
					assert.strictEqual(runBundle(join(cwd, "dist", "dynamic.js")).trim(), "1");
				}),
		),
	);

	it.live("takes a UMD package's module build over its main", () =>
		withFiles(
			{
				"src/main.ts": 'import { value } from "dual";\nconsole.log(value);\n',
				"node_modules/dual/package.json": '{ "name": "dual", "main": "./umd/main.js", "module": "./esm/main.js" }',
				"node_modules/dual/esm/main.js": 'export const value = "esm";\n',
				"node_modules/dual/umd/main.js": [
					"(function (factory) {",
					'	if (typeof module === "object" && typeof module.exports === "object") {',
					"		var v = factory(require, exports);",
					"		if (v !== undefined) module.exports = v;",
					"	}",
					"})(function (require, exports) {",
					'	exports.value = require("./impl").value;',
					"});",
					"",
				].join("\n"),
				"node_modules/dual/umd/impl.js": 'exports.value = "umd";\n',
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* ActionBundle.build(configOf(), { cwd, clean: true });
					assert.isTrue(result.success, JSON.stringify(result));
					assert.strictEqual(runBundle(join(cwd, "dist", "main.js")).trim(), "esm");
				}),
		),
	);

	it.live("defines __dirname and __filename from the bundle's own location, and leaves a local one alone", () =>
		withFiles(
			{
				"src/main.ts": [
					'import { where } from "legacy";',
					'import { shadowed } from "./shadow.ts";',
					"console.log(JSON.stringify({ ...where(), shadowed, url: import.meta.url }));",
					"",
				].join("\n"),
				"src/shadow.ts": 'const __dirname = "local";\nexport const shadowed = __dirname;\n',
				"node_modules/legacy/package.json": '{ "name": "legacy", "main": "index.js" }',
				"node_modules/legacy/index.js": "exports.where = () => ({ dirname: __dirname, filename: __filename });\n",
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* ActionBundle.build(configOf(), { cwd, clean: true });
					assert.isTrue(result.success, JSON.stringify(result));
					const dist = join(cwd, "dist");
					const seen = JSON.parse(runBundle(join(dist, "main.js"))) as Record<string, string>;
					assert.match(seen.dirname ?? "", /dist$/);
					assert.match(seen.filename ?? "", /dist\/main\.js$/);
					assert.strictEqual(seen.shadowed, "local");
					assert.match(seen.url ?? "", /^file:.*dist\/main\.js$/);
				}),
		),
	);

	it.live("compiles process.env.NODE_ENV to production", () =>
		withFiles({ "src/main.ts": "console.log(process.env.NODE_ENV);\n" }, (cwd) =>
			Effect.gen(function* () {
				yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.strictEqual(runBundle(join(cwd, "dist", "main.js")).trim(), "production");
			}),
		),
	);

	it.live("keeps a computed import native", () =>
		withFiles(
			{
				"dist/sibling.js": 'export default "loaded";\n',
				"src/main.ts": [
					'const name = process.argv[2] ?? "sibling.js";',
					"const sibling = await import(new URL(name, import.meta.url).href);",
					"console.log(sibling.default);",
					"",
				].join("\n"),
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* ActionBundle.build(configOf(), { cwd, clean: false });
					assert.isTrue(result.success, JSON.stringify(result));
					assert.strictEqual(runBundle(join(cwd, "dist", "main.js")).trim(), "loaded");
				}),
		),
	);

	it.live(
		"leaves no bundle behind for an entry that fails, keeping the others and the previous run's other files",
		() =>
			withFiles(
				{
					...MAIN,
					"src/broken.ts": 'throw new TypeError("not a function at load");\n',
					"src/unparsable.ts": "const = ;\n",
					"dist/broken.js": "stale\n",
					"dist/broken.js.map": "stale\n",
					"dist/unparsable.js": "stale\n",
					"dist/kept.txt": "kept\n",
				},
				(cwd) =>
					Effect.gen(function* () {
						const result = yield* ActionBundle.build(
							configOf({
								build: { sourceMap: true },
								entries: { workers: { broken: "src/broken.ts", unparsable: "src/unparsable.ts" } },
							}),
							{ cwd, clean: false },
						);
						assert.isFalse(result.success);
						assert.sameMembers(readdirSync(join(cwd, "dist")), ["kept.txt", "main.js", "main.js.map", "package.json"]);
					}),
			),
	);

	it.live("skips the load check when importCheck is false", () =>
		withFiles({ "src/main.ts": 'throw new TypeError("not a function at load");\n' }, (cwd) =>
			Effect.gen(function* () {
				const failing = yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isFalse(failing.success);

				const unchecked = yield* ActionBundle.build(configOf({ build: { importCheck: false } }), { cwd, clean: true });
				assert.isTrue(unchecked.success, JSON.stringify(unchecked));
				assert.isTrue(existsSync(join(cwd, "dist", "main.js")));
			}),
		),
	);

	it.live("does not run the bundle at all when importCheck is false", () =>
		withFiles({}, (cwd) => {
			const marker = join(cwd, "ran.txt");
			writeFileSync(
				join(cwd, "main.ts"),
				`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "x");\n`,
			);
			return Effect.gen(function* () {
				const config = { entries: { main: "main.ts" } };
				yield* ActionBundle.build(configOf({ ...config, build: { importCheck: false } }), { cwd, clean: true });
				assert.isFalse(existsSync(marker));
				yield* ActionBundle.build(configOf(config), { cwd, clean: true });
				assert.isTrue(
					existsSync(marker),
					"the same build with the check on does run it, so the assertion above can fail",
				);
			});
		}),
	);

	it.live("keeps what an unguarded entry writes out of dist", () =>
		withFiles(
			{
				"src/main.ts": [
					'import { writeFileSync } from "node:fs";',
					'import { join } from "node:path";',
					'writeFileSync("from-cwd.txt", "x");',
					'writeFileSync(join(process.env.HOME ?? "", "from-home.txt"), "x");',
					"",
				].join("\n"),
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* ActionBundle.build(configOf(), { cwd, clean: true });
					assert.isTrue(result.success, JSON.stringify(result));
					assert.sameMembers(readdirSync(join(cwd, "dist")), ["main.js", "package.json"]);
				}),
		),
	);

	it.live("warns, rather than fails, when a bundled CommonJS module requires an external that is not installed", () =>
		withFiles(
			{
				"src/main.ts": 'import { value } from "needs-peer";\nconsole.log(value);\n',
				"node_modules/needs-peer/package.json": '{ "name": "needs-peer", "main": "index.js" }',
				"node_modules/needs-peer/index.js": 'exports.value = require("peer-x");\n',
			},
			(cwd) =>
				Effect.gen(function* () {
					const excused = yield* ActionBundle.build(configOf({ build: { externals: ["peer-x"] } }), {
						cwd,
						clean: true,
					});
					assert.isTrue(excused.success, JSON.stringify(excused));
					const warnings = excused.entries[0]?.warnings ?? [];
					assert.lengthOf(warnings, 1);
					assert.include(warnings[0] ?? "", "peer-x");
					assert.include(warnings[0] ?? "", "not installed");

					const unconfigured = yield* ActionBundle.build(configOf(), { cwd, clean: true });
					assert.isFalse(unconfigured.success);
				}),
		),
	);

	it.live("kills the load check's child when the build is interrupted", () =>
		withFiles({}, (cwd) => {
			const pidFile = join(cwd, "pid.txt");
			writeFileSync(
				join(cwd, "main.ts"),
				[
					'import { writeFileSync } from "node:fs";',
					`writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
					'process.on("SIGTERM", () => {});',
					"setTimeout(() => process.exit(0), 20_000);",
					"",
				].join("\n"),
			);
			return Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					ActionBundle.build(configOf({ entries: { main: "main.ts" } }), { cwd, clean: true }),
				);
				while (!existsSync(pidFile) || readFileSync(pidFile, "utf8") === "") yield* Effect.sleep("20 millis");
				const pid = Number(readFileSync(pidFile, "utf8"));
				assert.isTrue(isAlive(pid));
				yield* Fiber.interrupt(fiber);
				for (let tries = 0; tries < 100 && isAlive(pid); tries++) yield* Effect.sleep("20 millis");
				assert.isFalse(isAlive(pid), "the child outlived the interrupted build");
			});
		}),
	);

	it.live("fails an entry that does not load, and still builds the rest", () =>
		withFiles(
			{
				...MAIN,
				"src/broken.ts": 'throw new TypeError("not a function at load");\n',
				"src/unparsable.ts": "const = ;\n",
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* ActionBundle.build(
						configOf({ entries: { workers: { broken: "src/broken.ts", unparsable: "src/unparsable.ts" } } }),
						{ cwd, clean: true },
					);
					assert.isFalse(result.success);
					assert.isString(result.error);
					assert.deepStrictEqual(
						result.entries.map((entry) => entry.success),
						[true, false, false],
					);
					assert.include(result.entries[1]?.error ?? "", "not a function at load");
					assert.isUndefined(result.entries[1]?.stats);
					assert.isString(result.entries[2]?.error);
				}),
		),
	);

	it.live("passes an unguarded action that stops on a missing input", () =>
		withFiles({ "src/main.ts": 'throw new Error("Input required and not supplied: token");\n' }, (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isTrue(result.success, JSON.stringify(result));
			}),
		),
	);

	it.live("fails before touching dist when a named entry is missing or a worker name is unsafe", () =>
		withFiles({ ...MAIN, "dist/old.js": "old\n" }, (cwd) =>
			Effect.gen(function* () {
				for (const document of [
					{ entries: { main: "src/absent.ts" } },
					{ entries: { pre: "src/absent.ts" } },
					{ entries: { post: "src/absent.ts" } },
					{ entries: { workers: { silk: "src/absent.ts" } } },
					{ entries: { workers: { "../escape": "src/main.ts" } } },
					{ entries: { workers: { main: "src/main.ts" } } },
				]) {
					const error = yield* ActionBundle.build(configOf(document), { cwd, clean: true }).pipe(Effect.flip);
					assert.instanceOf(error, BundleFailed);
					assert.isTrue(existsSync(join(cwd, "dist", "old.js")), JSON.stringify(document));
				}
			}),
		),
	);

	it.live("clean removes what is already in dist, and clean = false keeps it", () =>
		withFiles({ ...MAIN, "dist/old.js": "old\n" }, (cwd) =>
			Effect.gen(function* () {
				yield* ActionBundle.build(configOf(), { cwd, clean: false });
				assert.isTrue(existsSync(join(cwd, "dist", "old.js")));
				yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isFalse(existsSync(join(cwd, "dist", "old.js")));
			}),
		),
	);

	it.live("writes a source map when asked", () =>
		withFiles(MAIN, (cwd) =>
			Effect.gen(function* () {
				yield* ActionBundle.build(configOf({ build: { sourceMap: true } }), { cwd, clean: true });
				assert.isTrue(existsSync(join(cwd, "dist", "main.js.map")));
				yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isFalse(existsSync(join(cwd, "dist", "main.js.map")));
			}),
		),
	);

	it.live("carries rolldown's warnings on the entry", () =>
		withFiles({ "src/main.ts": 'console.log(eval("1"));\n' }, (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBundle.build(configOf(), { cwd, clean: true });
				assert.isTrue(result.success, JSON.stringify(result));
				const warnings = result.entries[0]?.warnings ?? [];
				assert.lengthOf(warnings, 1);
				assert.include(warnings[0] ?? "", "eval");
				assert.notInclude(warnings[0] ?? "", "\u001b[");
			}),
		),
	);
});
