import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem, Path } from "effect";
import { Effect, Option } from "effect";
import { ActionCheck, DriftEntry } from "../../src/index.js";

const STAGE = "/stage";
const SOURCE_YML = "/pkg/action.yml";
const PERSISTED = "/out";

const seed: Readonly<Record<string, string>> = {
	[`${STAGE}/main.js`]: "main\n",
	[`${STAGE}/lib/util.js`]: "util\n",
	[SOURCE_YML]: "name: x\n",
	[`${PERSISTED}/action.yml`]: "name: x\n",
	[`${PERSISTED}/dist/main.js`]: "main\n",
	[`${PERSISTED}/dist/lib/util.js`]: "util\n",
};

const inVolume = <A, E>(
	overrides: Readonly<Record<string, string | null>>,
	program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) => {
	const files = Object.fromEntries(
		Object.entries({ ...seed, ...overrides }).filter((pair): pair is [string, string] => pair[1] !== null),
	);
	return program.pipe(Effect.provide(MemoryFileSystem.layerWithPath(files)));
};

const persisted = (stagedActionYml: Option.Option<string> = Option.some(SOURCE_YML)) =>
	ActionCheck.compare({
		stagedActionYml,
		stagedDist: STAGE,
		targetDir: PERSISTED,
		target: "persisted",
		includeActionYml: true,
	});

const distOf = (targetDir: string) =>
	ActionCheck.compare({
		stagedActionYml: Option.none(),
		stagedDist: STAGE,
		targetDir,
		target: "dist",
		includeActionYml: false,
	});

describe("ActionCheck.compare", () => {
	it.effect("identical trees have no drift", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* persisted(), []);
			}),
		),
	);

	it.effect("a changed byte is changed", () =>
		inVolume(
			{ [`${PERSISTED}/dist/main.js`]: "mainX\n", "/pkg/dist/main.js": "x", "/pkg/dist/lib/util.js": "util\n" },
			Effect.gen(function* () {
				const drift = yield* persisted();
				assert.deepStrictEqual(drift, [new DriftEntry({ target: "persisted", path: "dist/main.js", kind: "changed" })]);
				const dist = yield* distOf("/pkg/dist");
				assert.deepStrictEqual(dist, [new DriftEntry({ target: "dist", path: "main.js", kind: "changed" })]);
			}),
		),
	);

	it.effect("a file only in the build is missing", () =>
		inVolume(
			{ [`${PERSISTED}/dist/lib/util.js`]: null, "/pkg/dist/main.js": "main\n" },
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* persisted(), [
					new DriftEntry({ target: "persisted", path: "dist/lib/util.js", kind: "missing" }),
				]);
				assert.deepStrictEqual(yield* distOf("/pkg/dist"), [
					new DriftEntry({ target: "dist", path: "lib/util.js", kind: "missing" }),
				]);
			}),
		),
	);

	it.effect("a file only in the target is extra", () =>
		inVolume(
			{
				[`${PERSISTED}/dist/old.js`]: "old\n",
				"/pkg/dist/main.js": "main\n",
				"/pkg/dist/lib/util.js": "util\n",
				"/pkg/dist/z.js": "z",
			},
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* persisted(), [
					new DriftEntry({ target: "persisted", path: "dist/old.js", kind: "extra" }),
				]);
				assert.deepStrictEqual(yield* distOf("/pkg/dist"), [
					new DriftEntry({ target: "dist", path: "z.js", kind: "extra" }),
				]);
			}),
		),
	);

	it.effect("an absent target dir reports every file missing", () =>
		inVolume(
			{},
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* distOf("/nowhere"), [
					new DriftEntry({ target: "dist", path: "lib/util.js", kind: "missing" }),
					new DriftEntry({ target: "dist", path: "main.js", kind: "missing" }),
				]);
			}),
		),
	);

	it.effect("an absent persisted dir reports every file missing, sorted", () =>
		inVolume(
			{
				[`${PERSISTED}/action.yml`]: null,
				[`${PERSISTED}/dist/main.js`]: null,
				[`${PERSISTED}/dist/lib/util.js`]: null,
			},
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* persisted(), [
					new DriftEntry({ target: "persisted", path: "action.yml", kind: "missing" }),
					new DriftEntry({ target: "persisted", path: "dist/lib/util.js", kind: "missing" }),
					new DriftEntry({ target: "persisted", path: "dist/main.js", kind: "missing" }),
				]);
			}),
		),
	);

	it.effect("action.yml is compared when included", () =>
		inVolume(
			{ [`${PERSISTED}/action.yml`]: "name: y\n" },
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* persisted(), [
					new DriftEntry({ target: "persisted", path: "action.yml", kind: "changed" }),
				]);
			}),
		),
	);

	it.effect("no action.yml on either side is not drift", () =>
		inVolume(
			{ [`${PERSISTED}/action.yml`]: null },
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* persisted(Option.none()), []);
			}),
		),
	);
});
