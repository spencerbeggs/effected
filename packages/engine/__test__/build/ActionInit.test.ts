// `ActionInit` over real temporary directories: the end-to-end case bundles with rolldown, which reads the real disk.
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { ActionConfig, ActionValidation } from "@effected/bundler";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError, Schema } from "effect";
import {
	ActionInit,
	ActionInitResult,
	ActionMetadataInvalidError,
	ActionMetadataMissingError,
	ActionRun,
	NotAPackageError,
	ScaffoldConflictError,
	ScaffoldExistsError,
	ScaffoldWriteError,
} from "../../src/build/index.js";

const Live = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const MANIFEST = JSON.stringify({ name: "@acme/greet", description: "Greets someone", type: "module" });

const withDir = <A, E>(files: Readonly<Record<string, string>>, use: (cwd: string) => Effect.Effect<A, E>) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			// Realpathed, because macOS's temp directory is a symlink.
			const cwd = realpathSync(mkdtempSync(join(tmpdir(), "effected-action-init-")));
			for (const [name, source] of Object.entries(files)) {
				mkdirSync(dirname(join(cwd, name)), { recursive: true });
				writeFileSync(join(cwd, name), source);
			}
			return cwd;
		}),
		use,
		(cwd) => Effect.sync(() => rmSync(cwd, { recursive: true, force: true })),
	);

const init = (cwd: string, input: Partial<Parameters<typeof ActionInit.run>[0]> = {}) =>
	ActionInit.run({ force: false, ...input }, { cwd }).pipe(Effect.provide(Live));

const PLANNED = ["effected.toml", "action.yml", "src/main.ts", "src/program.ts", "tsconfig.json"];

describe("ActionInit.plan", () => {
	it("is the canon's files, in order, and names what the source imports", () => {
		const scaffold = ActionInit.plan({ name: "greet", description: "Greets" });
		assert.deepStrictEqual(
			scaffold.files.map((file) => file.path),
			PLANNED,
		);
		assert.sameMembers([...scaffold.dependencies], ["@effected/github-actions", "effect", "@effect/platform-node"]);
		assert.sameMembers([...scaffold.devDependencies], ["@effected/plugin", "typescript", "@types/node"]);
		const tsconfig = JSON.parse(scaffold.files.find((file) => file.path === "tsconfig.json")?.contents ?? "{}");
		assert.strictEqual(tsconfig.extends, "@effected/plugin/tsconfig/action.json");
		const main = scaffold.files.find((file) => file.path === "src/main.ts")?.contents ?? "";
		assert.include(main, "if (process.env.GITHUB_ACTIONS)");
	});

	it("quotes the name and description, so text YAML would read as structure stays one string", () => {
		const name = 'greet: "x" # not a comment\nruns: evil';
		const yml = ActionInit.plan({ name, description: "Greets: everyone" }).files[1]?.contents ?? "";
		const line = yml.split("\n").find((candidate) => candidate.startsWith("name: ")) ?? "";
		assert.strictEqual(JSON.parse(line.slice("name: ".length)), name);
		assert.strictEqual(yml.split("\n").filter((candidate) => candidate.startsWith("runs:")).length, 1);
	});
});

describe("ActionInit.plan's YAML", () => {
	it("escapes DEL, C1 and the line and paragraph separators, which JSON leaves raw", () => {
		const yml = ActionInit.plan({ name: "a\u007Fb\u0085c\u2028d", description: "x" }).files[1]?.contents ?? "";
		const line = yml.split("\n").find((candidate) => candidate.startsWith("name: ")) ?? "";
		assert.strictEqual(line, 'name: "a\\u007Fb\\u0085c\\u2028d"');
		assert.isNull(/[\u007F-\u009F\u2028\u2029]/.exec(yml));
	});
});

describe("ActionInit.run", () => {
	it.live("writes every file, with the name and description from package.json", () =>
		withDir({ "package.json": MANIFEST }, (cwd) =>
			Effect.gen(function* () {
				const result = yield* init(cwd);
				assert.instanceOf(result, ActionInitResult);
				assert.deepStrictEqual([...result.written], PLANNED);
				assert.deepStrictEqual([...result.overwritten], []);
				assert.isTrue(result.typeModule);
				assert.sameMembers([...result.missingDevDependencies], ["@effected/plugin", "typescript", "@types/node"]);
				const yml = readFileSync(join(cwd, "action.yml"), "utf8");
				assert.include(yml, 'name: "greet"', "the npm scope is dropped");
				assert.include(yml, 'description: "Greets someone"');
				for (const file of PLANNED) assert.isTrue(existsSync(join(cwd, file)), file);
			}),
		),
	);

	it.live("the action.yml validates strictly, a hostile name and all: no error and no warning", () =>
		withDir({ "package.json": MANIFEST }, (cwd) =>
			Effect.gen(function* () {
				yield* init(cwd, { name: 'greet: "x" # not a comment, runs: {evil}', description: "Greets: everyone" });
				const config = Schema.decodeUnknownSync(ActionConfig)({});
				const validation = yield* ActionValidation.validate(config, cwd, { ci: true }).pipe(Effect.provide(Live));
				assert.deepStrictEqual([...validation.errors], []);
				assert.deepStrictEqual([...validation.warnings], []);
				assert.isTrue(validation.valid);
			}),
		),
	);

	it.live("a given name and description win over package.json, and declared packages are not missing", () =>
		withDir(
			{
				"package.json": JSON.stringify({
					name: "x",
					dependencies: { effect: "4", "@effected/github-actions": "0" },
					devDependencies: { "@effected/plugin": "0", typescript: "7", "@types/node": "24" },
					// A peer installs nothing, so it does not count as declaring the dependency.
					peerDependencies: { "@effect/platform-node": "4" },
				}),
			},
			(cwd) =>
				Effect.gen(function* () {
					const result = yield* init(cwd, { name: "Greeter", description: "Says hello" });
					assert.isFalse(result.typeModule);
					assert.deepStrictEqual([...result.missingDependencies], ["@effect/platform-node"]);
					assert.deepStrictEqual([...result.missingDevDependencies], []);
					const yml = readFileSync(join(cwd, "action.yml"), "utf8");
					assert.include(yml, 'name: "Greeter"');
					assert.include(yml, 'description: "Says hello"');
				}),
		),
	);

	it.live("refuses to overwrite, naming every existing file, and writes nothing", () =>
		withDir({ "package.json": MANIFEST, "action.yml": "keep\n", "src/main.ts": "keep\n" }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(init(cwd));
				assert.instanceOf(error, ScaffoldExistsError);
				assert.deepStrictEqual([...(error as ScaffoldExistsError).files], ["action.yml", "src/main.ts"]);
				assert.include(error.message, "action.yml, src/main.ts");
				assert.strictEqual(readFileSync(join(cwd, "action.yml"), "utf8"), "keep\n");
				assert.isFalse(existsSync(join(cwd, "effected.toml")), "a refusal writes nothing");
			}),
		),
	);

	it.live("force overwrites and reports what it replaced", () =>
		withDir({ "package.json": MANIFEST, "action.yml": "keep\n" }, (cwd) =>
			Effect.gen(function* () {
				const result = yield* init(cwd, { force: true });
				assert.deepStrictEqual([...result.overwritten], ["action.yml"]);
				assert.include(readFileSync(join(cwd, "action.yml"), "utf8"), 'name: "greet"');
			}),
		),
	);

	it.live("fails NotAPackageError with no package.json", () =>
		withDir({}, (cwd) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(init(cwd, { name: "a", description: "b" }));
				assert.instanceOf(error, NotAPackageError);
			}),
		),
	);

	it.live("fails ActionMetadataMissingError for a description found nowhere, or blank", () =>
		withDir({ "package.json": JSON.stringify({ name: "x" }) }, (cwd) =>
			Effect.gen(function* () {
				const missing = yield* Effect.flip(init(cwd));
				assert.instanceOf(missing, ActionMetadataMissingError);
				assert.strictEqual((missing as ActionMetadataMissingError).field, "description");
				const blank = yield* Effect.flip(init(cwd, { description: "  " }));
				assert.strictEqual((blank as ActionMetadataMissingError).field, "description");
				assert.isFalse(existsSync(join(cwd, "action.yml")));
			}),
		),
	);
});

describe("ActionInit.run's metadata", () => {
	const refused = [
		["DEL in the name", { name: "gr\u007Feet" }, "name", "U+007F"],
		["a C1 control in the name", { name: "gr\u009Beet" }, "name", "U+009B"],
		["a newline in the description", { description: "one\ntwo" }, "description", "U+000A"],
		["NUL in the description", { description: "a\u0000b" }, "description", "U+0000"],
		["a lone surrogate in the name", { name: "gr\uD800eet" }, "name", "U+D800"],
	] as const;
	for (const [label, input, field, character] of refused) {
		it.live(`refuses ${label}, naming the field and the character, and writes nothing`, () =>
			withDir({ "package.json": MANIFEST }, (cwd) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(init(cwd, input));
					assert.instanceOf(error, ActionMetadataInvalidError);
					assert.strictEqual((error as ActionMetadataInvalidError).field, field);
					assert.strictEqual((error as ActionMetadataInvalidError).character, character);
					assert.isFalse(existsSync(join(cwd, "action.yml")));
				}),
			),
		);
	}

	it.live("keeps a TAB, which a quoted YAML scalar carries", () =>
		withDir({ "package.json": MANIFEST }, (cwd) =>
			Effect.gen(function* () {
				yield* init(cwd, { description: "a\tb" });
				assert.include(readFileSync(join(cwd, "action.yml"), "utf8"), 'description: "a\\tb"');
			}),
		),
	);
});

/** A sibling of the action directory: where a link would carry a write. */
const outsideOf = (cwd: string) => {
	const outside = `${cwd}-outside`;
	mkdirSync(outside, { recursive: true });
	return outside;
};

const conflictsOf = (error: unknown) =>
	(error as ScaffoldConflictError).conflicts.map((conflict) => `${conflict.path}:${conflict.kind}`);

describe("ActionInit.write never leaves the action directory", () => {
	it.live("a dangling link at a target is refused, and nothing is created where it points", () =>
		withDir({ "package.json": MANIFEST }, (cwd) =>
			Effect.gen(function* () {
				const outside = outsideOf(cwd);
				symlinkSync(join(outside, "pwned.yml"), join(cwd, "action.yml"));
				const error = yield* Effect.flip(init(cwd));
				const landed = readdirSync(outside);
				rmSync(outside, { recursive: true, force: true });
				assert.instanceOf(error, ScaffoldConflictError);
				assert.deepStrictEqual(conflictsOf(error), ["action.yml:symlink"]);
				assert.deepStrictEqual(landed, []);
				assert.isFalse(existsSync(join(cwd, "effected.toml")), "a refusal writes nothing");
			}),
		),
	);

	it.live("force over a link to an outside file is refused, and the file keeps its content", () =>
		withDir({ "package.json": MANIFEST }, (cwd) =>
			Effect.gen(function* () {
				const outside = outsideOf(cwd);
				writeFileSync(join(outside, "precious.json"), "precious\n");
				symlinkSync(join(outside, "precious.json"), join(cwd, "tsconfig.json"));
				const error = yield* Effect.flip(init(cwd, { force: true }));
				const precious = readFileSync(join(outside, "precious.json"), "utf8");
				rmSync(outside, { recursive: true, force: true });
				assert.instanceOf(error, ScaffoldConflictError);
				assert.deepStrictEqual(conflictsOf(error), ["tsconfig.json:symlink"]);
				assert.strictEqual(precious, "precious\n");
				assert.isTrue(lstatSync(join(cwd, "tsconfig.json")).isSymbolicLink(), "the link is left alone");
			}),
		),
	);

	it.live("a symlinked src/ is refused, and nothing lands in the directory it points to", () =>
		withDir({ "package.json": MANIFEST }, (cwd) =>
			Effect.gen(function* () {
				const outside = outsideOf(cwd);
				symlinkSync(outside, join(cwd, "src"));
				const error = yield* Effect.flip(init(cwd, { force: true }));
				const landed = readdirSync(outside);
				rmSync(outside, { recursive: true, force: true });
				assert.instanceOf(error, ScaffoldConflictError);
				assert.deepStrictEqual(conflictsOf(error), ["src:symlink"]);
				assert.deepStrictEqual(landed, []);
				assert.isFalse(existsSync(join(cwd, "action.yml")));
			}),
		),
	);

	it.live("a directory at a file target is refused even with force, before any write", () =>
		withDir({ "package.json": MANIFEST, "action.yml/keep": "" }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(init(cwd, { force: true }));
				assert.instanceOf(error, ScaffoldConflictError);
				assert.deepStrictEqual(conflictsOf(error), ["action.yml:not-a-file"]);
				assert.isFalse(existsSync(join(cwd, "effected.toml")), "nothing was written first");
			}),
		),
	);

	it.live("a file where src/ goes is refused, naming it, and nothing is written", () =>
		withDir({ "package.json": MANIFEST, src: "a file\n" }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(init(cwd));
				assert.instanceOf(error, ScaffoldConflictError);
				assert.deepStrictEqual(conflictsOf(error), ["src:not-a-directory"]);
				assert.isFalse(existsSync(join(cwd, "effected.toml")));
			}),
		),
	);

	it.live("every conflict is named at once", () =>
		withDir({ "package.json": MANIFEST, src: "", "tsconfig.json/x": "" }, (cwd) =>
			Effect.gen(function* () {
				symlinkSync(join(cwd, "nowhere"), join(cwd, "action.yml"));
				const error = yield* Effect.flip(init(cwd));
				assert.sameMembers(conflictsOf(error), [
					"src:not-a-directory",
					"action.yml:symlink",
					"tsconfig.json:not-a-file",
				]);
			}),
		),
	);
});

describe("ActionInit.write's uninspectable targets", () => {
	const denied = (method: string, path: string) =>
		Effect.fail(
			PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path }),
		);
	const initOver = (faults: Parameters<typeof MemoryFileSystem.makeHandle>[1]) =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(
				{ "/a/package.json": MANIFEST, "/a/action.yml": "keep\n" },
				faults,
			);
			const error = yield* Effect.flip(
				ActionInit.run({ force: true }, { cwd: "/a" }).pipe(Effect.provide(Layer.mergeAll(handle.layer, Path.layer))),
			);
			return { error, handle };
		});

	it.effect("an entry lstat cannot inspect is refused as unreadable, even with force, and nothing is written", () =>
		Effect.gen(function* () {
			const { error, handle } = yield* initOver({
				faults: { lstat: (path) => (path === "/a/action.yml" ? denied("lstat", path) : undefined) },
			});
			assert.instanceOf(error, ScaffoldConflictError);
			assert.deepStrictEqual(conflictsOf(error), ["action.yml:unreadable"]);
			assert.isFalse(handle.volume.has("/a/effected.toml"));
		}),
	);

	it.effect("an existing file this process may not write is refused as unwritable, even with force", () =>
		Effect.gen(function* () {
			const { error, handle } = yield* initOver({
				faults: { access: (path) => (path === "/a/action.yml" ? denied("access", path) : undefined) },
			});
			assert.instanceOf(error, ScaffoldConflictError);
			assert.deepStrictEqual(conflictsOf(error), ["action.yml:unwritable"]);
			assert.strictEqual(handle.volume.text("/a/action.yml"), "keep\n");
			assert.isFalse(handle.volume.has("/a/effected.toml"));
		}),
	);
});

describe("ActionInit.write's directories and names", () => {
	const denied = (method: string, path: string) =>
		Effect.fail(
			PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path }),
		);
	const over = (
		seed: Parameters<typeof MemoryFileSystem.makeHandle>[0],
		options: Parameters<typeof MemoryFileSystem.makeHandle>[1] = {},
	) =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/a/package.json": MANIFEST, ...seed }, options);
			const exit = yield* Effect.exit(
				ActionInit.run({ force: true }, { cwd: "/a" }).pipe(Effect.provide(Layer.mergeAll(handle.layer, Path.layer))),
			);
			return { exit, handle, error: exit._tag === "Failure" ? yield* Effect.flip(exit) : undefined };
		});

	it.effect("a read-only existing src/ is refused as unwritable, even with force, and nothing is written", () =>
		Effect.gen(function* () {
			const { error, handle } = yield* over(
				{ "/a/src": MemoryFileSystem.directory() },
				{ faults: { access: (path) => (path === "/a/src" ? denied("access", path) : undefined) } },
			);
			assert.instanceOf(error, ScaffoldConflictError);
			assert.deepStrictEqual(conflictsOf(error), ["src:unwritable"]);
			assert.isFalse(handle.volume.has("/a/effected.toml"));
		}),
	);

	it.effect("a read-only action directory is refused as unwritable, named as .", () =>
		Effect.gen(function* () {
			const { error, handle } = yield* over(
				{},
				{ faults: { access: (path) => (path === "/a" ? denied("access", path) : undefined) } },
			);
			assert.deepStrictEqual(conflictsOf(error), [".:unwritable"]);
			assert.isFalse(handle.volume.has("/a/effected.toml"));
		}),
	);

	it.effect("a name differing only in case is a conflict, even with force, and is left alone", () =>
		Effect.gen(function* () {
			const { error, handle } = yield* over({ "/a/Action.yml": "keep\n", "/a/SRC/x": "" });
			assert.instanceOf(error, ScaffoldConflictError);
			assert.sameMembers(conflictsOf(error), ["action.yml:case-variant", "src:case-variant"]);
			assert.strictEqual(handle.volume.text("/a/Action.yml"), "keep\n");
			assert.isFalse(handle.volume.has("/a/action.yml"));
			assert.isFalse(handle.volume.has("/a/effected.toml"));
		}),
	);

	it.effect("a directory on a target's path that changes after the checks stops the run before that write", () =>
		Effect.gen(function* () {
			let seen = 0;
			// The first lstat of src/ is the pre-pass (absent); later ones are the per-write checks, after it was created.
			const swapped = (path: string) => {
				if (path !== "/a/src") return undefined;
				seen += 1;
				return seen > 1 ? denied("lstat", path) : undefined;
			};
			const { error, handle } = yield* over({}, { faults: { lstat: swapped } });
			assert.instanceOf(error, ScaffoldWriteError);
			assert.strictEqual((error as ScaffoldWriteError).path, "src/main.ts");
			assert.deepStrictEqual([...(error as ScaffoldWriteError).written], ["effected.toml", "action.yml"]);
			assert.include((error as ScaffoldWriteError).message, "no longer resolves inside");
			assert.isFalse(handle.volume.has("/a/src/main.ts"));
		}),
	);
});

describe("ActionInit.write after its checks", () => {
	it.effect("a write that fails names the path and exactly the files written before it", () =>
		Effect.gen(function* () {
			const failing = (to: string) =>
				to === "/a/src/main.ts"
					? Effect.fail(
							PlatformError.systemError({
								_tag: "PermissionDenied",
								module: "FileSystem",
								method: "rename",
								pathOrDescriptor: to,
							}),
						)
					: undefined;
			const handle = yield* MemoryFileSystem.makeHandle(
				{ "/a/package.json": MANIFEST },
				{ faults: { rename: (_from, to) => failing(to) } },
			);
			const error = yield* Effect.flip(
				ActionInit.run({ force: false }, { cwd: "/a" }).pipe(Effect.provide(Layer.mergeAll(handle.layer, Path.layer))),
			);
			assert.instanceOf(error, ScaffoldWriteError);
			const write = error as ScaffoldWriteError;
			assert.strictEqual(write.path, "src/main.ts");
			assert.deepStrictEqual([...write.written], ["effected.toml", "action.yml"]);
			assert.include(write.message, "already written: effected.toml, action.yml");
			assert.isTrue(handle.volume.has("/a/action.yml"));
			assert.isFalse(handle.volume.has("/a/src/main.ts"));
		}),
	);
});

// The scaffold's imports resolve through links to the workspace's own copies, as an install would place them.
const require = createRequire(import.meta.url);
const ENGINE = resolve(import.meta.dirname, "../..");
const GITHUB_ACTIONS = resolve(ENGINE, "../github-actions");
// The bundler reads the tsconfig, so the preset's package has to be installed too: a scaffold without it fails to bundle.
const PLUGIN = resolve(ENGINE, "../plugin");
const EFFECT = dirname(require.resolve("effect/package.json"));

describe("action init, then action build", () => {
	it.live(
		"builds the scaffold cleanly: no validation issue, and the bundle loads",
		() =>
			withDir({ "package.json": MANIFEST }, (cwd) =>
				Effect.gen(function* () {
					mkdirSync(join(cwd, "node_modules/@effected"), { recursive: true });
					symlinkSync(GITHUB_ACTIONS, join(cwd, "node_modules/@effected/github-actions"));
					symlinkSync(EFFECT, join(cwd, "node_modules/effect"));
					symlinkSync(PLUGIN, join(cwd, "node_modules/@effected/plugin"));
					yield* init(cwd);

					// `ci: true` is strict mode: a warning would fail the build.
					const answer = yield* ActionRun.run({ validate: true, persist: false }, { cwd, ci: true }).pipe(
						Effect.provide(Live),
					);
					assert.strictEqual(answer.verdict, "ok", JSON.stringify(answer.result.build.entries));
					assert.deepStrictEqual([...answer.result.validation.errors], []);
					assert.deepStrictEqual([...answer.result.validation.warnings], []);
					assert.isTrue(answer.result.build.success);
					assert.strictEqual(answer.result.build.entries[0]?.stats?.outputPath, "dist/main.js");
					assert.isTrue(existsSync(join(cwd, "dist/main.js")));
				}),
			),
		{ timeout: 120_000 },
	);
});
