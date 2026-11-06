import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, SchemaIssue } from "effect";
import { EffectedConfig, MetaConfig, PackageBuildConfig, PackageConfig } from "../../src/index.js";

const decode = (document: unknown) =>
	Schema.decodeUnknownEffect(EffectedConfig)(document, { onExcessProperty: "error", errors: "all" });

const buildOf = (build: unknown) =>
	decode({ package: { build } }).pipe(
		Effect.flatMap((config) =>
			config.package === undefined ? Effect.die("the package table was dropped") : Effect.succeed(config.package.build),
		),
	);

const failedPaths = (document: unknown) =>
	decode(document).pipe(
		Effect.flip,
		Effect.map((error) => SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => issue.path)),
	);

describe("EffectedConfig", () => {
	it.effect("decodes an empty document to no tables at all", () =>
		Effect.gen(function* () {
			const config = yield* decode({});
			assert.instanceOf(config, EffectedConfig);
			assert.isUndefined(config.package);
			assert.isUndefined(config.action);
		}),
	);

	it.effect("decodes an empty package table to every default", () =>
		Effect.gen(function* () {
			const config = yield* decode({ package: {} });
			assert.instanceOf(config.package, PackageConfig);
			assert.isUndefined(config.package?.tsdoctor);
			const build = config.package?.build;
			assert.instanceOf(build, PackageBuildConfig);
			assert.deepStrictEqual(build?.format, ["esm"]);
			assert.deepStrictEqual(build?.externals, []);
			assert.deepStrictEqual(build?.bundle, []);
			assert.deepStrictEqual(build?.bundledPackages, []);
			assert.deepStrictEqual(build?.dtsExternals, []);
			assert.strictEqual(build?.bundleNodeModules, false);
			assert.strictEqual(build?.minify, false);
			assert.strictEqual(build?.emitDts, true);
			assert.deepStrictEqual(build?.define, {});
			assert.deepStrictEqual(build?.plugins, []);
			assert.deepStrictEqual(build?.overrides, []);
			assert.deepStrictEqual(build?.looseFiles, {});
			assert.isUndefined(build?.jsx);
			assert.deepStrictEqual(build?.manifest.drop, []);
			assert.isUndefined(build?.exe);
			const meta = build?.meta;
			assert.instanceOf(meta, MetaConfig);
			if (meta instanceof MetaConfig) {
				assert.strictEqual(meta.optimistic, "auto");
				assert.deepStrictEqual(meta.tsdoc.tagDefinitions, []);
				assert.deepStrictEqual(
					meta.tsdoc.suppressWarnings.map((rule) => ({ messageId: rule.messageId, pattern: rule.pattern })),
					[{ messageId: "ae-forgotten-export", pattern: "_base" }],
				);
			}
		}),
	);

	it.effect("names the old formats misspelling by its full path", () =>
		Effect.gen(function* () {
			const paths = yield* failedPaths({ package: { build: { formats: ["esm"] } } });
			assert.deepStrictEqual(paths, [["package", "build", "formats"]]);
		}),
	);

	it.effect("rejects an unknown key at every level", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* failedPaths({ pakcage: {} }), [["pakcage"]]);
			assert.deepStrictEqual(yield* failedPaths({ package: { biuld: {} } }), [["package", "biuld"]]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { meta: { optimistc: true } } } }), [
				["package", "build", "meta", "optimistc"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { meta: { tsdoc: { suppress: [] } } } } }), [
				["package", "build", "meta", "tsdoc", "suppress"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { manifest: { keep: [] } } } }), [
				["package", "build", "manifest", "keep"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { jsx: { factory: "h" } } } }), [
				["package", "build", "jsx", "factory"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { exe: { fileName: "a", name: "b" } } } }), [
				["package", "build", "exe", "name"],
			]);
			assert.deepStrictEqual(
				yield* failedPaths({ package: { build: { overrides: [{ entries: ["."], formats: ["cjs"] }] } } }),
				[["package", "build", "overrides", 0, "formats"]],
			);
			assert.deepStrictEqual(
				yield* failedPaths({ package: { build: { looseFiles: { "a.js": { source: "a.ts", fromat: "cjs" } } } } }),
				[["package", "build", "looseFiles", "a.js", "fromat"]],
			);
			assert.deepStrictEqual(yield* failedPaths({ package: { tsdoctor: { title: "x" } } }), [
				["package", "tsdoctor", "title"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { tsdoctor: { openGraph: { generator: "satori" } } } }), [
				["package", "tsdoctor", "openGraph", "generator"],
			]);
		}),
	);

	it.effect("rejects a value outside a literal set", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { format: ["umd"] } } }), [
				["package", "build", "format", 0],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { meta: true } } }), [
				["package", "build", "meta"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { tsdoctor: { openGraph: { generate: "canvas" } } } }), [
				["package", "tsdoctor", "openGraph", "generate"],
			]);
		}),
	);

	it.effect("leaves the action table open until its own schema lands", () =>
		Effect.gen(function* () {
			const config = yield* decode({ action: { anything: 1 } });
			assert.deepStrictEqual(config.action, { anything: 1 });
		}),
	);
});

describe("PackageBuildConfig", () => {
	it.effect("replaces the default suppressWarnings with an explicit empty list", () =>
		Effect.gen(function* () {
			const build = yield* buildOf({ meta: { tsdoc: { suppressWarnings: [] } } });
			assert.instanceOf(build.meta, MetaConfig);
			if (build.meta instanceof MetaConfig) {
				assert.deepStrictEqual(build.meta.tsdoc.suppressWarnings, []);
			}
		}),
	);

	it.effect("keeps meta false as the opt out", () =>
		Effect.gen(function* () {
			const build = yield* buildOf({ meta: false });
			assert.strictEqual(build.meta, false);
		}),
	);

	it.effect("accepts every optimistic spelling", () =>
		Effect.gen(function* () {
			for (const optimistic of ["auto", true, false] as const) {
				const build = yield* buildOf({ meta: { optimistic } });
				assert.instanceOf(build.meta, MetaConfig);
				if (build.meta instanceof MetaConfig) assert.strictEqual(build.meta.optimistic, optimistic);
			}
		}),
	);

	it.effect("accepts exe as an object and as an array", () =>
		Effect.gen(function* () {
			const one = yield* buildOf({ exe: { fileName: "tool" } });
			assert.isFalse(Array.isArray(one.exe));
			const many = yield* buildOf({
				exe: [
					{ fileName: "a", targets: [{ platform: "win", arch: "x64" }] },
					{
						fileName: "b",
						entry: "./src/b.ts",
						nodeVersion: "25.9.0",
						seaConfig: { useSnapshot: true },
					},
				],
			});
			assert.isTrue(Array.isArray(many.exe));
			assert.lengthOf(many.exe as ReadonlyArray<unknown>, 2);
		}),
	);

	it.effect("requires exe.fileName, in either shape", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { exe: {} } } }), [
				["package", "build", "exe", "fileName"],
			]);
			assert.deepStrictEqual(yield* failedPaths({ package: { build: { exe: [{}] } } }), [
				["package", "build", "exe", 0, "fileName"],
			]);
		}),
	);

	it.effect("accepts a loose file as a path and as a spec", () =>
		Effect.gen(function* () {
			const build = yield* buildOf({
				looseFiles: { "a.mjs": "./src/a.ts", "b.js": { source: "./src/b.ts", format: "cjs" } },
			});
			assert.strictEqual(build.looseFiles["a.mjs"], "./src/a.ts");
			const spec = build.looseFiles["b.js"];
			assert.isTrue(typeof spec === "object" && spec.source === "./src/b.ts" && spec.format === "cjs");
		}),
	);

	it.effect("carries an entry override, css left open", () =>
		Effect.gen(function* () {
			const build = yield* buildOf({
				overrides: [{ entries: ["./runtime"], platform: "browser", outSubdir: "runtime", css: { inject: true } }],
			});
			const override = build.overrides[0];
			assert.deepStrictEqual(override?.entries, ["./runtime"]);
			assert.strictEqual(override?.platform, "browser");
			assert.strictEqual(override?.outSubdir, "runtime");
			assert.deepStrictEqual(override?.css, { inject: true });
			assert.isUndefined(override?.format);
		}),
	);
});

describe("TsdoctorConfig", () => {
	it.effect("takes the satori generator as a literal and false registries", () =>
		Effect.gen(function* () {
			const config = yield* decode({
				package: {
					tsdoctor: {
						name: "Kit",
						tagline: "t",
						description: "d",
						openGraph: {
							generate: "satori",
							cacheSalt: false,
							themeColor: "#000",
							images: [{ path: "og.png", width: 1200, height: 630 }],
						},
						registries: false,
					},
				},
			});
			const tsdoctor = config.package?.tsdoctor;
			assert.strictEqual(tsdoctor?.name, "Kit");
			assert.strictEqual(tsdoctor?.openGraph?.generate, "satori");
			assert.strictEqual(tsdoctor?.openGraph?.cacheSalt, false);
			assert.strictEqual(tsdoctor?.openGraph?.images?.[0]?.path, "og.png");
			assert.strictEqual(tsdoctor?.registries, false);
		}),
	);

	it.effect("takes a registry list", () =>
		Effect.gen(function* () {
			const config = yield* decode({
				package: { tsdoctor: { registries: [{ type: "npm", name: "npm", url: "https://npmjs.com/a" }] } },
			});
			const registries = config.package?.tsdoctor?.registries;
			assert.isTrue(Array.isArray(registries));
		}),
	);

	it.effect("holds an image to exactly one of path and url", () =>
		Effect.gen(function* () {
			for (const image of [{}, { path: "a.png", url: "https://a.b/a.png" }]) {
				const paths = yield* failedPaths({ package: { tsdoctor: { openGraph: { images: [image] } } } });
				assert.deepStrictEqual(paths, [["package", "tsdoctor", "openGraph", "images", 0]]);
			}
		}),
	);
});
