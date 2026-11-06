// Ported from @savvy-web/github-action-builder __test__/services/persist-local.test.ts, over memfs.
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { Path } from "effect";
import { Effect, FileSystem, PlatformError, Schema } from "effect";
import {
	ActionConfig,
	ActionYmlPathError,
	PersistLocal,
	PersistLocalError,
	PersistLocalResult,
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

const persist = (persistLocal?: unknown) => PersistLocal.persist(configOf(persistLocal), { cwd: CWD });

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
      - uses: ./.github/actions/local
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
						method: "copyFile",
						pathOrDescriptor: path,
					}),
				);
			const error = yield* persist().pipe(
				Effect.provide(MemoryFileSystem.layerWithPath(seed, { faults: { copyFile: (from) => denied(from) } })),
				Effect.flip,
			);
			assert.instanceOf(error, PersistLocalError);
			if (error instanceof PersistLocalError) assert.strictEqual(error.path, `${CWD}/action.yml`);
		}),
	);
});
