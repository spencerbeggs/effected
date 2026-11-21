// Ported from @savvy-web/github-action-builder __test__/services/persist-local.test.ts, over memfs.
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Yaml } from "@effected/yaml";
import type { Path } from "effect";
import { Effect, FileSystem, Logger, PlatformError, Schema } from "effect";
import {
	ActionConfig,
	ActionYmlPathError,
	PersistLocal,
	PersistLocalError,
	PersistLocalResult,
	PersistTarget,
} from "../../src/index.js";

const CWD = "/action";
const OUT = `${CWD}/.github/actions/local`;

const ACTION_YML = `name: "Test Action"
description: "A test action"
runs:
  using: "node24"
  main: "dist/main/index.js"
`;

const seed: Readonly<Record<string, string>> = {
	[`${CWD}/src/main.ts`]: 'console.log("hello");',
	[`${CWD}/dist/main/index.js`]: 'console.log("built");',
	[`${CWD}/dist/package.json`]: '{ "type": "module" }',
	[`${CWD}/action.yml`]: ACTION_YML,
};

const configOf = (persistLocal: unknown = {}) => Schema.decodeUnknownSync(ActionConfig)({ persistLocal });

const persist = (persistLocal?: unknown) =>
	Effect.gen(function* () {
		const target = yield* PersistTarget.resolve(configOf(persistLocal), { cwd: CWD, root: CWD });
		return yield* PersistLocal.persist(target, { cwd: CWD, distDir: `${CWD}/dist` });
	});

const WS = "/ws";
const PKG = `${WS}/actions/one`;
const STAGING = `${PKG}/.action-staging`;
const WS_OUT = `${WS}/.github/actions/one`;

/** Persists a staging-built action under the workspace base. */
const persistWorkspace = (extra: Record<string, unknown> = {}) =>
	Effect.gen(function* () {
		const target = yield* PersistTarget.resolve(configOf({ base: "workspace", dist: false, ...extra }), {
			cwd: PKG,
			root: WS,
		});
		return yield* PersistLocal.persist(target, { cwd: PKG, distDir: STAGING });
	});

/** Runs a program over a volume holding `overrides` on top of the seed; a `null` override removes a seeded file. */
const inVolume = <A, E>(
	overrides: Readonly<Record<string, string | null>>,
	program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) => {
	const files = Object.fromEntries(
		Object.entries({ ...seed, ...overrides }).filter((pair): pair is [string, string] => pair[1] !== null),
	);
	return program.pipe(Effect.provide(MemoryFileSystem.layerWithPath(files)));
};

const read = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.readFileString(path);
	});
const exists = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.exists(path);
	});

describe("PersistLocal.persist", () => {
	it.effect("copies action.yml and dist/ to the output directory", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				const result = yield* persist();
				assert.instanceOf(result, PersistLocalResult);
				assert.strictEqual(result.filesCopied, 3);
				assert.strictEqual(result.filesSkipped, 0);
				assert.strictEqual(result.outputPath, OUT);
				assert.strictEqual(yield* read(`${OUT}/action.yml`), ACTION_YML);
				assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), 'console.log("built");');
				assert.strictEqual(yield* read(`${OUT}/dist/package.json`), '{ "type": "module" }');
			}),
		),
	);

	it.effect("skips unchanged files on a second run", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				yield* persist();
				const second = yield* persist();
				assert.strictEqual(second.filesCopied, 0);
				assert.strictEqual(second.filesSkipped, 3);
			}),
		),
	);

	it.effect("copies a changed file on a later run", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				yield* persist();
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString(`${CWD}/dist/main/index.js`, 'console.log("updated");');
				const second = yield* persist();
				assert.strictEqual(second.filesCopied, 1);
				assert.strictEqual(second.filesSkipped, 2);
				assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), 'console.log("updated");');
			}),
		),
	);

	it.effect("writes nothing when disabled", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				const result = yield* persist({ enabled: false });
				assert.strictEqual(result.filesCopied, 0);
				assert.strictEqual(result.filesSkipped, 0);
				assert.isFalse(result.actTemplateGenerated);
				assert.isFalse(yield* exists(OUT));
				assert.isFalse(yield* exists(`${CWD}/.actrc`));
			}),
		),
	);

	it.effect("generates the act template with the builder's contents", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				const result = yield* persist({ actTemplate: true });
				assert.isTrue(result.actTemplateGenerated);
				assert.strictEqual(
					yield* read(`${CWD}/.actrc`),
					"--container-architecture linux/amd64\n-W .github/workflows/act-test.yml\n",
				);
				assert.strictEqual(
					yield* read(`${CWD}/.github/workflows/act-test.yml`),
					`name: Local Test
on:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: "./.github/actions/local"
`,
				);
			}),
		),
	);

	it.effect("does not overwrite existing act template files", () =>
		inVolume(
			{ [`${CWD}/.actrc`]: "custom content", [`${CWD}/.github/workflows/act-test.yml`]: "custom workflow" },
			Effect.gen(function* () {
				const result = yield* persist({ actTemplate: true });
				assert.isFalse(result.actTemplateGenerated);
				assert.strictEqual(yield* read(`${CWD}/.actrc`), "custom content");
				assert.strictEqual(yield* read(`${CWD}/.github/workflows/act-test.yml`), "custom workflow");
			}),
		),
	);

	it.effect("generates only the template file that is absent", () =>
		inVolume(
			{ [`${CWD}/.actrc`]: "custom content" },
			Effect.gen(function* () {
				const result = yield* persist();
				assert.isTrue(result.actTemplateGenerated);
				assert.strictEqual(yield* read(`${CWD}/.actrc`), "custom content");
				assert.isTrue(yield* exists(`${CWD}/.github/workflows/act-test.yml`));
			}),
		),
	);

	it.effect("skips the act template when actTemplate is false", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				const result = yield* persist({ actTemplate: false });
				assert.isFalse(result.actTemplateGenerated);
				assert.isFalse(yield* exists(`${CWD}/.actrc`));
			}),
		),
	);

	it.effect("uses a custom output path", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				const result = yield* persist({ path: ".github/actions/custom" });
				assert.strictEqual(result.outputPath, `${CWD}/.github/actions/custom`);
				assert.isTrue(yield* exists(`${CWD}/.github/actions/custom/action.yml`));
			}),
		),
	);

	it.effect("removes stale destination files and the directories they leave empty", () =>
		inVolume(
			{ [`${OUT}/dist/old/deep/stale.js`]: "stale", [`${OUT}/dist/main/stale.js`]: "stale" },
			Effect.gen(function* () {
				yield* persist();
				assert.isFalse(yield* exists(`${OUT}/dist/old/deep/stale.js`));
				assert.isFalse(yield* exists(`${OUT}/dist/old`));
				assert.isFalse(yield* exists(`${OUT}/dist/main/stale.js`));
				assert.isTrue(yield* exists(`${OUT}/dist/main/index.js`));
			}),
		),
	);

	it.effect("removes a stale symlinked directory as a link, never what it points at", () =>
		Effect.gen(function* () {
			const files: Record<string, string> = { ...seed, "/outside/keep.js": "keep", "/outside/deep/keep.js": "keep" };
			yield* Effect.gen(function* () {
				yield* persist();
				assert.isTrue(yield* exists("/outside/keep.js"));
				assert.isTrue(yield* exists("/outside/deep/keep.js"));
				assert.isFalse(yield* exists(`${OUT}/dist/linked`));
			}).pipe(
				Effect.provide(
					MemoryFileSystem.layerWithPath({ ...files, [`${OUT}/dist/linked`]: MemoryFileSystem.symlink("/outside") }),
				),
			);
		}),
	);

	it.effect("replaces a symlinked directory the build writes into, leaving its target alone", () =>
		Effect.gen(function* () {
			yield* Effect.gen(function* () {
				yield* persist();
				assert.isFalse(yield* exists("/outside/index.js"));
				assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), 'console.log("built");');
			}).pipe(
				Effect.provide(
					MemoryFileSystem.layerWithPath({
						...seed,
						"/outside/other.js": "keep",
						[`${OUT}/dist/main`]: MemoryFileSystem.symlink("/outside"),
					}),
				),
			);
		}),
	);

	it.effect("replaces only dist/: a sibling README.md survives and a stale dist file goes", () =>
		inVolume(
			{ [`${OUT}/README.md`]: "# committed", [`${OUT}/dist/stale.js`]: "stale" },
			Effect.gen(function* () {
				yield* persist();
				assert.strictEqual(yield* read(`${OUT}/README.md`), "# committed");
				assert.isFalse(yield* exists(`${OUT}/dist/stale.js`));
				assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), 'console.log("built");');
			}),
		),
	);

	it.effect("replaces a symlinked dist with a real directory, leaving its target alone", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* persist();
			assert.strictEqual((yield* fs.lstat(`${OUT}/dist`)).type, "Directory");
			assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), 'console.log("built");');
			assert.strictEqual(yield* read("/outside/stale.js"), "keep");
			assert.isFalse(yield* exists("/outside/main"));
			assert.isFalse(yield* exists("/outside/package.json"));
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					...seed,
					"/outside/stale.js": "keep",
					[`${OUT}/dist`]: MemoryFileSystem.symlink("/outside"),
				}),
			),
		),
	);

	it.effect("leaves the persisted dist whole when a write fails partway", () => {
		const refused = (path: string) =>
			PlatformError.systemError({
				_tag: "PermissionDenied",
				module: "FileSystem",
				method: "writeFile",
				pathOrDescriptor: path,
			});
		const persistedManifest = (path: string) => path.startsWith(`${OUT}/`) && path.endsWith("package.json");
		return Effect.gen(function* () {
			yield* persist().pipe(Effect.flip);
			assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), "old");
			assert.strictEqual(yield* read(`${OUT}/dist/package.json`), "old");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ ...seed, [`${OUT}/dist/main/index.js`]: "old", [`${OUT}/dist/package.json`]: "old" },
					{
						faults: (base) => ({
							copyFile: (from, to) => (persistedManifest(to) ? Effect.fail(refused(to)) : base.copyFile(from, to)),
							writeFile: (path, data, options) =>
								persistedManifest(path) ? Effect.fail(refused(path)) : base.writeFile(path, data, options),
						}),
					},
				),
			),
		);
	});

	it.effect("replaces a symlinked action.yml rather than writing through it", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* persist();
			assert.strictEqual((yield* fs.lstat(`${OUT}/action.yml`)).type, "File");
			assert.strictEqual(yield* read(`${OUT}/action.yml`), ACTION_YML);
			assert.strictEqual(yield* read("/outside/action.yml"), "outside");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					...seed,
					"/outside/action.yml": "outside",
					[`${OUT}/action.yml`]: MemoryFileSystem.symlink("/outside/action.yml"),
				}),
			),
		),
	);

	it.effect("does not write the act workflow through a symlinked .github/workflows that leaves the workspace", () =>
		Effect.gen(function* () {
			const result = yield* persist({ actTemplate: true });
			assert.isFalse(yield* exists("/outside/workflows/act-test.yml"));
			assert.deepStrictEqual(result.actTemplateSkipped, [`${CWD}/.github/workflows/act-test.yml`]);
			assert.isTrue(yield* exists(`${CWD}/.actrc`));
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					...seed,
					"/outside/workflows/keep.yml": "keep",
					[`${CWD}/.github/workflows`]: MemoryFileSystem.symlink("/outside/workflows"),
				}),
			),
		),
	);

	it.effect("treats a dangling .actrc link as present and never follows it", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* persist({ actTemplate: true });
			assert.isFalse(yield* exists("/outside/actrc"));
			assert.strictEqual((yield* fs.lstat(`${CWD}/.actrc`)).type, "SymbolicLink");
			assert.isTrue(yield* exists(`${CWD}/.github/workflows/act-test.yml`));
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					...seed,
					"/outside/keep.txt": "keep",
					[`${CWD}/.actrc`]: MemoryFileSystem.symlink("/outside/actrc"),
				}),
			),
		),
	);

	it.effect("quotes the act step's path, so a # in it survives YAML", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				yield* persist({ path: ".github/actions/a #b", actTemplate: true });
				const workflow = (yield* Yaml.parse(yield* read(`${CWD}/.github/workflows/act-test.yml`))) as {
					readonly jobs: { readonly test: { readonly steps: ReadonlyArray<{ readonly uses: string }> } };
				};
				assert.strictEqual(workflow.jobs.test.steps[1]?.uses, "./.github/actions/a #b");
			}),
		),
	);

	it.effect("fails with ActionYmlPathError when a runs path does not resolve", () =>
		inVolume(
			{
				[`${CWD}/action.yml`]:
					'name: "T"\ndescription: "T"\nruns:\n  using: "node24"\n  main: "dist/nonexistent/index.js"\n',
			},
			Effect.gen(function* () {
				const error = yield* persist().pipe(Effect.flip);
				assert.instanceOf(error, ActionYmlPathError);
				if (error instanceof ActionYmlPathError) {
					assert.strictEqual(error.entryType, "main");
					assert.strictEqual(error.specifiedPath, "dist/nonexistent/index.js");
					assert.strictEqual(error.expectedPath, `${OUT}/dist/nonexistent/index.js`);
				}
			}),
		),
	);

	it.effect("succeeds without an action.yml", () =>
		inVolume(
			{ [`${CWD}/action.yml`]: null },
			Effect.gen(function* () {
				yield* persist();
				assert.isFalse(yield* exists(`${OUT}/action.yml`));
			}),
		),
	);

	it.effect("removes a stale destination action.yml when the source is deleted", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				yield* persist();
				assert.isTrue(yield* exists(`${OUT}/action.yml`));
				const fs = yield* FileSystem.FileSystem;
				yield* fs.remove(`${CWD}/action.yml`);
				yield* persist();
				assert.isFalse(yield* exists(`${OUT}/action.yml`));
			}),
		),
	);

	it.effect("takes an action.yml without runs, or that does not parse", () =>
		Effect.gen(function* () {
			yield* inVolume({ [`${CWD}/action.yml`]: 'name: "T"\ndescription: "No runs"\n' }, persist());
			yield* inVolume({ [`${CWD}/action.yml`]: 'name: "T"\ndescription: "Empty runs"\nruns:\n' }, persist());
			yield* inVolume({ [`${CWD}/action.yml`]: 'name: "T"\ndescription: "Scalar runs"\nruns: node24\n' }, persist());
			yield* inVolume({ [`${CWD}/action.yml`]: "null\n" }, persist());
			yield* inVolume({ [`${CWD}/action.yml`]: "name: [unclosed\n" }, persist());
		}),
	);

	it.effect("takes a missing dist directory", () =>
		Effect.gen(function* () {
			const result = yield* inVolume(
				{
					[`${CWD}/dist/main/index.js`]: null,
					[`${CWD}/dist/package.json`]: null,
					[`${CWD}/action.yml`]: 'name: "T"\ndescription: "No dist"\n',
				},
				persist(),
			);
			assert.strictEqual(result.filesCopied, 1);
		}),
	);

	it.effect("fails with PersistLocalError naming the path when a write is refused", () =>
		Effect.gen(function* () {
			const denied = (path: string) =>
				Effect.fail(
					PlatformError.systemError({
						_tag: "PermissionDenied",
						module: "FileSystem",
						method: "rename",
						pathOrDescriptor: path,
					}),
				);
			const error = yield* persist().pipe(
				Effect.provide(MemoryFileSystem.layerWithPath(seed, { faults: { rename: (from) => denied(from) } })),
				Effect.flip,
			);
			assert.instanceOf(error, PersistLocalError);
			if (error instanceof PersistLocalError) assert.strictEqual(error.path, `${OUT}/dist`);
		}),
	);

	it.effect("leaves the old action.yml unchanged when the dist write fails", () => {
		const refused = (path: string) =>
			PlatformError.systemError({
				_tag: "PermissionDenied",
				module: "FileSystem",
				method: "writeFile",
				pathOrDescriptor: path,
			});
		const persistedManifest = (path: string) => path.startsWith(`${OUT}/`) && path.endsWith("package.json");
		return Effect.gen(function* () {
			yield* persist().pipe(Effect.flip);
			assert.strictEqual(yield* read(`${OUT}/action.yml`), "old: yml\n");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ ...seed, [`${OUT}/action.yml`]: "old: yml\n" },
					{
						faults: (base) => ({
							copyFile: (from, to) => (persistedManifest(to) ? Effect.fail(refused(to)) : base.copyFile(from, to)),
							writeFile: (path, data, options) =>
								persistedManifest(path) ? Effect.fail(refused(path)) : base.writeFile(path, data, options),
						}),
					},
				),
			),
		);
	});

	it.effect("succeeds with a warning when only removing the old dist fails", () => {
		const lines: Array<{ readonly level: string; readonly message: string }> = [];
		const capture = Logger.make((options) => {
			lines.push({ level: options.logLevel, message: JSON.stringify(options.message) });
		});
		const refused = (path: string) =>
			PlatformError.systemError({
				_tag: "PermissionDenied",
				module: "FileSystem",
				method: "remove",
				pathOrDescriptor: path,
			});
		// The first removal of `.dist.old` is the pre-promote clear; the second is the cleanup after the swap.
		let removals = 0;
		return Effect.gen(function* () {
			const result = yield* persist();
			assert.instanceOf(result, PersistLocalResult);
			assert.strictEqual(yield* read(`${OUT}/dist/main/index.js`), 'console.log("built");');
			assert.isTrue(lines.some((line) => line.level === "Warn" && line.message.includes(".dist.old")));
		}).pipe(
			Effect.provide(Logger.layer([capture])),
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ ...seed, [`${OUT}/dist/main/index.js`]: "old" },
					{
						faults: (base) => ({
							remove: (path, options) =>
								path.endsWith("/.dist.old") && ++removals === 2
									? Effect.fail(refused(path))
									: base.remove(path, options),
						}),
					},
				),
			),
		);
	});
});

describe("PersistLocal.persist under the workspace base", () => {
	const wsSeed = {
		[`${STAGING}/main.js`]: 'console.log("built");',
		[`${PKG}/action.yml`]: ACTION_YML.replace("dist/main/index.js", "dist/main.js"),
	};

	it.effect("persists from a staging dist under workspace base", () =>
		inVolume(
			{ ...wsSeed, [`${WS_OUT}/dist/stale.js`]: "stale" },
			Effect.gen(function* () {
				const result = yield* persistWorkspace();
				assert.strictEqual(result.outputPath, WS_OUT);
				assert.isTrue(yield* exists(`${WS_OUT}/action.yml`));
				assert.strictEqual(yield* read(`${WS_OUT}/dist/main.js`), 'console.log("built");');
				assert.isFalse(yield* exists(`${WS_OUT}/dist/stale.js`));
			}),
		),
	);

	it.effect("act templates at the workspace root", () =>
		inVolume(
			wsSeed,
			Effect.gen(function* () {
				const result = yield* persistWorkspace({ actTemplate: true });
				assert.isTrue(result.actTemplateGenerated);
				assert.isTrue(yield* exists(`${WS}/.actrc`));
				assert.include(yield* read(`${WS}/.github/workflows/act-test.yml`), 'uses: "./.github/actions/one"\n');
				assert.isFalse(yield* exists(`${PKG}/.github`));
			}),
		),
	);

	it.effect("no act templates by default under workspace base", () =>
		inVolume(
			wsSeed,
			Effect.gen(function* () {
				const result = yield* persistWorkspace();
				assert.isFalse(result.actTemplateGenerated);
				assert.isFalse(yield* exists(`${WS}/.actrc`));
			}),
		),
	);
});
