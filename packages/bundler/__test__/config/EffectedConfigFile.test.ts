import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import {
	ActionConfig,
	EffectedConfig,
	EffectedConfigError,
	EffectedConfigFile,
	MetaConfig,
	PackageConfig,
	merge,
} from "../../src/index.js";

const ROOT = "/repo";
const PKG = "/repo/packages/a";

const workspace = {
	[`${ROOT}/pnpm-workspace.yaml`]: "packages:\n  - packages/*\n",
	[`${ROOT}/package.json`]: JSON.stringify({ name: "root", private: true }),
	[`${PKG}/package.json`]: JSON.stringify({ name: "a", version: "1.0.0" }),
};

const world = (
	seed: Readonly<Record<string, string>>,
	options?: Parameters<typeof MemoryFileSystem.layerWithPath>[1],
) => {
	const base = MemoryFileSystem.layerWithPath(seed, options);
	return WorkspaceDiscovery.layer().pipe(Layer.provideMerge(WorkspaceRoot.layer), Layer.provideMerge(base));
};

const load = (seed: Readonly<Record<string, string>>, cwd: string = PKG) =>
	EffectedConfigFile.load({ cwd }).pipe(Effect.provide(world({ ...workspace, ...seed })));

const metaOf = (meta: unknown): MetaConfig => {
	assert.instanceOf(meta, MetaConfig);
	return meta as MetaConfig;
};

describe("EffectedConfigFile.load", () => {
	it.effect("answers every package default and no source when no file exists anywhere", () =>
		Effect.gen(function* () {
			const resolved = yield* load({});
			assert.instanceOf(resolved.config, EffectedConfig);
			assert.instanceOf(resolved.config.package, PackageConfig);
			assert.strictEqual(resolved.config.package.build.minify, false);
			assert.deepStrictEqual(resolved.config.package.build.format, ["esm"]);
			const meta = metaOf(resolved.config.package.build.meta);
			assert.strictEqual(meta.optimistic, "auto");
			assert.deepStrictEqual(
				meta.tsdoc.suppressWarnings.map((rule) => ({ messageId: rule.messageId, pattern: rule.pattern })),
				[{ messageId: "ae-forgotten-export", pattern: "_base" }],
			);
			assert.isUndefined(resolved.config.package.bundle);
			assert.isUndefined(resolved.config.action);
			assert.deepStrictEqual({ ...resolved.sources }, {});
		}),
	);

	it.effect("answers package defaults when the files found have no package table", () =>
		Effect.gen(function* () {
			const resolved = yield* load({ [`${ROOT}/effected.toml`]: '[action.entries]\nmain = "src/run.ts"\n' });
			assert.strictEqual(resolved.sources.root, `${ROOT}/effected.toml`);
			assert.strictEqual(resolved.config.action?.entries.main, "src/run.ts");
			assert.strictEqual(resolved.config.package.build.emitDts, true);
			assert.deepStrictEqual(resolved.config.package.build.format, ["esm"]);
		}),
	);

	it.effect("answers the action defaults from an empty action table", () =>
		Effect.gen(function* () {
			const resolved = yield* load({ [`${PKG}/effected.toml`]: "[action]\n" });
			assert.instanceOf(resolved.config.action, ActionConfig);
			assert.strictEqual(resolved.config.action?.entries.main, "src/main.ts");
			assert.strictEqual(resolved.config.action?.build.minify, true);
			assert.strictEqual(resolved.config.action?.persistLocal.path, ".github/actions/local");
		}),
	);

	it.effect("reads importCheck from TOML, defaulting it on", () =>
		Effect.gen(function* () {
			const off = yield* load({ [`${PKG}/effected.toml`]: "[action.build]\nimportCheck = false\n" });
			assert.isFalse(off.config.action?.build.importCheck);
			const on = yield* load({ [`${PKG}/effected.toml`]: "[action.build]\nminify = false\n" });
			assert.isTrue(on.config.action?.build.importCheck);
			const wrong = yield* load({ [`${PKG}/effected.toml`]: '[action.build]\nimportCheck = "no"\n' }).pipe(Effect.flip);
			assert.strictEqual(wrong.issuePath, "action.build.importCheck");
		}),
	);

	it.effect("decodes a worker table whose keys carry dashes, and merges the action table across tiers", () =>
		Effect.gen(function* () {
			const resolved = yield* load({
				[`${ROOT}/effected.toml`]: "[action.build]\nminify = false\n",
				[`${PKG}/effected.toml`]: '[action.entries.workers]\nchangelog-silk = "src/changelog/silk.ts"\n',
			});
			assert.deepStrictEqual(resolved.config.action?.entries.workers, { "changelog-silk": "src/changelog/silk.ts" });
			assert.strictEqual(resolved.config.action?.build.minify, false);
		}),
	);

	it.effect("fails a removed action key with its path, blaming the file that wrote it", () =>
		Effect.gen(function* () {
			const error = yield* load({
				[`${PKG}/effected.toml`]: '[action.build]\nnativeDynamicImports = ["@changesets/apply-release-plan"]\n',
			}).pipe(Effect.flip);
			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(error.issuePath, "action.build.nativeDynamicImports");
			assert.strictEqual(error.path, `${PKG}/effected.toml`);
		}),
	);

	it.effect("prefers the root .config file over the root file", () =>
		Effect.gen(function* () {
			const resolved = yield* load({
				[`${ROOT}/.config/effected.toml`]: "[package.build]\nminify = true\n",
				[`${ROOT}/effected.toml`]: "[package.build]\nminify = false\nemitDts = false\n",
			});
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.config.package.build.emitDts, true, "the losing candidate is not merged");
			assert.strictEqual(resolved.sources.root, `${ROOT}/.config/effected.toml`);
			assert.isUndefined(resolved.sources.package);
		}),
	);

	it.effect("falls through to the root file when .config has none", () =>
		Effect.gen(function* () {
			const resolved = yield* load({ [`${ROOT}/effected.toml`]: "[package.build]\nminify = true\n" });
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.sources.root, `${ROOT}/effected.toml`);
		}),
	);

	it.effect("walks the package candidates in order, first found wins", () =>
		Effect.gen(function* () {
			const dot = `${PKG}/.config/effected.toml`;
			const plain = `${PKG}/effected.toml`;
			const lib = `${PKG}/lib/configs/effected.toml`;
			const file = (externals: string) => `[package.build]\nexternals = ["${externals}"]\n`;

			const first = yield* load({ [dot]: file("dot"), [plain]: file("plain"), [lib]: file("lib") });
			assert.deepStrictEqual(first.config.package.build.externals, ["dot"]);
			assert.strictEqual(first.sources.package, dot);

			const second = yield* load({ [plain]: file("plain"), [lib]: file("lib") });
			assert.deepStrictEqual(second.config.package.build.externals, ["plain"]);
			assert.strictEqual(second.sources.package, plain);

			const third = yield* load({ [lib]: file("lib") });
			assert.deepStrictEqual(third.config.package.build.externals, ["lib"]);
			assert.strictEqual(third.sources.package, lib);
		}),
	);

	it.effect("applies only the root tier when cwd is the root", () =>
		Effect.gen(function* () {
			const resolved = yield* load(
				{
					[`${ROOT}/effected.toml`]: "[package.build]\nminify = true\n",
					[`${ROOT}/lib/configs/effected.toml`]: "[package.build]\nemitDts = false\n",
				},
				ROOT,
			);
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.config.package.build.emitDts, true, "lib/configs is a package candidate only");
			assert.strictEqual(resolved.sources.root, `${ROOT}/effected.toml`);
			assert.isUndefined(resolved.sources.package);
		}),
	);

	it.effect("treats a non-normalized cwd at the root as the root", () =>
		Effect.gen(function* () {
			const resolved = yield* load(
				{ [`${ROOT}/effected.toml`]: "[package.build]\nminify = true\n" },
				`${ROOT}/packages/..`,
			);
			assert.strictEqual(resolved.sources.root, `${ROOT}/effected.toml`);
			assert.isUndefined(resolved.sources.package);
		}),
	);

	it.effect("lets a package scalar override the root's", () =>
		Effect.gen(function* () {
			const resolved = yield* load({
				[`${ROOT}/effected.toml`]: "[package.build]\nminify = false\n",
				[`${PKG}/effected.toml`]: "[package.build]\nminify = true\n",
			});
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.sources.root, `${ROOT}/effected.toml`);
			assert.strictEqual(resolved.sources.package, `${PKG}/effected.toml`);
		}),
	);

	it.effect("replaces a root array with a package array", () =>
		Effect.gen(function* () {
			const resolved = yield* load({
				[`${ROOT}/effected.toml`]: '[package.build]\nexternals = ["a"]\n',
				[`${PKG}/effected.toml`]: '[package.build]\nexternals = ["b"]\n',
			});
			assert.deepStrictEqual(resolved.config.package.build.externals, ["b"]);
		}),
	);

	it.effect("merges sibling keys of a nested table from both tiers", () =>
		Effect.gen(function* () {
			const resolved = yield* load({
				[`${ROOT}/effected.toml`]: '[[package.build.meta.tsdoc.suppressWarnings]]\nmessageId = "root-rule"\n',
				[`${PKG}/effected.toml`]: "[package.build.meta]\noptimistic = false\n",
			});
			const meta = metaOf(resolved.config.package.build.meta);
			assert.strictEqual(meta.optimistic, false);
			assert.deepStrictEqual(
				meta.tsdoc.suppressWarnings.map((rule) => rule.messageId),
				["root-rule"],
			);
		}),
	);

	it.effect("applies defaults after precedence: a root value survives an unrelated package table", () =>
		Effect.gen(function* () {
			const resolved = yield* load({
				[`${ROOT}/effected.toml`]: "[package.build]\nminify = true\n",
				[`${PKG}/effected.toml`]: "[package.build]\nemitDts = false\n",
			});
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.config.package.build.emitDts, false);
			assert.strictEqual(metaOf(resolved.config.package.build.meta).optimistic, "auto");
		}),
	);

	it.effect("lets a package meta false beat a root meta table, and the reverse", () =>
		Effect.gen(function* () {
			const disabled = yield* load({
				[`${ROOT}/effected.toml`]: "[package.build.meta]\noptimistic = true\n",
				[`${PKG}/effected.toml`]: "[package.build]\nmeta = false\n",
			});
			assert.strictEqual(disabled.config.package.build.meta, false);

			const enabled = yield* load({
				[`${ROOT}/effected.toml`]: "[package.build]\nmeta = false\n",
				[`${PKG}/effected.toml`]: "[package.build.meta]\noptimistic = true\n",
			});
			assert.strictEqual(metaOf(enabled.config.package.build.meta).optimistic, true);
		}),
	);

	it.effect("takes the root from options without asking discovery", () =>
		Effect.gen(function* () {
			const resolved = yield* EffectedConfigFile.load({ cwd: "/elsewhere/pkg", root: "/elsewhere" }).pipe(
				Effect.provide(
					world({
						"/elsewhere/effected.toml": "[package.build]\nminify = true\n",
						"/elsewhere/pkg/effected.toml": "[package.build]\nemitDts = false\n",
					}),
				),
			);
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.config.package.build.emitDts, false);
		}),
	);

	it.effect("treats cwd as the root when no workspace root sits above it", () =>
		Effect.gen(function* () {
			const resolved = yield* EffectedConfigFile.load({ cwd: "/solo" }).pipe(
				Effect.provide(world({ "/solo/effected.toml": "[package.build]\nminify = true\n" })),
			);
			assert.strictEqual(resolved.config.package.build.minify, true);
			assert.strictEqual(resolved.sources.root, "/solo/effected.toml");
			assert.isUndefined(resolved.sources.package);
		}),
	);

	it.effect("reports invalid TOML with the parse reason and the file's path", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(load({ [`${PKG}/effected.toml`]: "[package.build\nminify = true\n" }));
			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(error.path, `${PKG}/effected.toml`);
			assert.isUndefined(error.issuePath);
			assert.include(error.reason, "toml parse failed: ");
			assert.notStrictEqual(error.reason, "toml parse failed: ", "the parser's own text follows the prefix");
		}),
	);

	it.effect("names an unknown key by its issue path", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(load({ [`${PKG}/effected.toml`]: '[package.build]\nformats = ["esm"]\n' }));
			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(error.issuePath, "package.build.formats");
			assert.strictEqual(error.path, `${PKG}/effected.toml`);
			assert.include(error.reason, "package.build.formats");
			assert.include(error.message, `${PKG}/effected.toml`);
			assert.include(error.message, "package.build.formats");
		}),
	);

	it.effect("fails the retired [package.tsdoctor] table, naming [package.bundle] where its settings moved", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(load({ [`${PKG}/effected.toml`]: '[package.tsdoctor]\nname = "Kit"\n' }));
			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(error.issuePath, "package.tsdoctor");
			assert.include(error.reason, "package.tsdoctor");
			assert.include(error.reason, "renamed to [package.bundle]");
			// positive control: the same settings under the new table decode
			const resolved = yield* load({ [`${PKG}/effected.toml`]: '[package.bundle]\nname = "Kit"\n' });
			assert.strictEqual(resolved.config.package.bundle?.name, "Kit");
		}),
	);

	it.effect("adds no rename hint to an ordinary unknown key", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(load({ [`${PKG}/effected.toml`]: "[package.build]\naaa = 1\n" }));
			assert.notInclude(error.reason, "renamed to");
		}),
	);

	it.effect("reports every bad key, and the first as the issue path", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(load({ [`${PKG}/effected.toml`]: "[package.build]\naaa = 1\nbbb = 2\n" }));
			assert.strictEqual(error.issuePath, "package.build.aaa");
			assert.include(error.reason, "package.build.aaa");
			assert.include(error.reason, "package.build.bbb");
		}),
	);

	it.effect("blames the file that wrote the bad key, whichever tier it is", () =>
		Effect.gen(function* () {
			const rootBad = yield* Effect.flip(
				load({
					[`${ROOT}/effected.toml`]: "[package.build]\nformats = 1\n",
					[`${PKG}/effected.toml`]: "[package.build]\nminify = true\n",
				}),
			);
			assert.strictEqual(rootBad.path, `${ROOT}/effected.toml`);

			const pkgBad = yield* Effect.flip(
				load({
					[`${ROOT}/effected.toml`]: "[package.build]\nminify = true\n",
					[`${PKG}/effected.toml`]: "[package.build]\nformats = 1\n",
				}),
			);
			assert.strictEqual(pkgBad.path, `${PKG}/effected.toml`);
		}),
	);

	it.effect("blames the file nearest a missing required key", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				load({
					[`${ROOT}/effected.toml`]: '[package.build.exe]\nentry = "./a.ts"\n',
					[`${PKG}/effected.toml`]: "[package.build]\nminify = true\n",
				}),
			);
			assert.strictEqual(error.issuePath, "package.build.exe.fileName");
			assert.strictEqual(error.path, `${ROOT}/effected.toml`);
		}),
	);

	it.effect("blames the package when both tiers reach a missing key equally far", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				load({
					[`${ROOT}/effected.toml`]: '[package.build.exe]\nentry = "./a.ts"\n',
					[`${PKG}/effected.toml`]: '[package.build.exe]\nnodeVersion = "25.9.0"\n',
				}),
			);
			assert.strictEqual(error.issuePath, "package.build.exe.fileName");
			assert.strictEqual(error.path, `${PKG}/effected.toml`);
		}),
	);

	it.effect("reports a read failure that is not absence rather than skipping the candidate", () =>
		Effect.gen(function* () {
			const target = `${ROOT}/.config/effected.toml`;
			const error = yield* Effect.flip(
				EffectedConfigFile.load({ cwd: PKG }).pipe(
					Effect.provide(
						world(
							{ ...workspace, [`${ROOT}/effected.toml`]: "[package.build]\nminify = true\n" },
							{
								faults: (base) => ({
									readFileString: (path, encoding) =>
										path === target
											? Effect.fail(
													PlatformError.systemError({
														_tag: "PermissionDenied",
														module: "FileSystem",
														method: "readFileString",
														pathOrDescriptor: path,
													}),
												)
											: base.readFileString(path, encoding),
								}),
							},
						),
					),
				),
			);
			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(error.path, target);
			assert.isUndefined(error.issuePath);
		}),
	);

	it.effect("wraps a discovery failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				EffectedConfigFile.load({ cwd: PKG }).pipe(
					Effect.provide(world({ ...workspace, [`${ROOT}/pnpm-workspace.yaml`]: "packages: [" })),
				),
			);
			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(error.path, `${ROOT}/pnpm-workspace.yaml`);
		}),
	);

	it.effect("cannot be steered onto Object.prototype by a table name", () =>
		Effect.gen(function* () {
			yield* load({
				[`${ROOT}/effected.toml`]: '["__proto__"]\npolluted = true\n',
				[`${PKG}/effected.toml`]: '["__proto__"]\npolluted = true\n',
			}).pipe(Effect.ignore);
			assert.isUndefined(({} as Record<string, unknown>).polluted);
		}),
	);

	it.effect("reads nothing above the root it was given", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.makeDirectory(`${ROOT}/x`, { recursive: true });
			yield* fs.writeFileString(`${ROOT}/effected.toml`, "[package.build]\nminify = true\n");
			const resolved = yield* EffectedConfigFile.load({ cwd: `${ROOT}/x`, root: `${ROOT}/x` });
			assert.strictEqual(resolved.config.package.build.minify, false);
			assert.isUndefined(resolved.sources.root);
		}).pipe(Effect.provide(world(workspace))),
	);
});

describe("merge", () => {
	it("merges objects per key and replaces arrays and scalars", () => {
		assert.deepStrictEqual(merge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: { e: 1 } }), {
			a: { b: 1, c: [3] },
			d: { e: 1 },
		});
	});

	it("modifies neither input", () => {
		const root = { a: { b: 1 } };
		const pkg = { a: { c: 2 } };
		merge(root, pkg);
		assert.deepStrictEqual(root, { a: { b: 1 } });
		assert.deepStrictEqual(pkg, { a: { c: 2 } });
	});
});
