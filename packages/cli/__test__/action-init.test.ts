// `effected action init` as `bin.ts` runs it, under `CliRuntime.main`, over a pinned memfs volume.
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaults, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Effect, Exit, PlatformError, Runtime } from "effect";
import { TestConsole } from "effect/testing";
import { run } from "../src/main.js";
import { environment } from "./schema/harness.js";

const CWD = "/repo/greet";
const MANIFEST = JSON.stringify({ name: "@acme/greet", description: "Greets someone", type: "module" });
const PLANNED = ["effected.toml", "action.yml", "src/main.ts", "src/program.ts", "tsconfig.json"];

const cli = (
	args: ReadonlyArray<string>,
	files: MemoryFileSystemSeed = { "package.json": MANIFEST },
	options: { readonly outside?: MemoryFileSystemSeed; readonly faults?: MemoryFileSystemFaults } = {},
) =>
	Effect.gen(function* () {
		const seed: MemoryFileSystemSeed = Object.fromEntries(
			Object.entries(files).map(([name, source]) => [`${CWD}/${name}`, source]),
		);
		const handle = yield* MemoryFileSystem.makeHandle(
			{ [`${CWD}/.keep`]: "", "/outside/.keep": "", ...options.outside, ...seed },
			options.faults !== undefined ? { faults: options.faults } : {},
		);
		const exit = yield* Effect.exit(
			run({}, { cwd: CWD, ci: false }, environment(["action", "init", ...args], handle.layer)),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		const outText = (yield* TestConsole.logLines).map(String).join("\n");
		const errText = (yield* TestConsole.errorLines).map(String).join("\n");
		const present = PLANNED.filter((file) => handle.volume.has(`${CWD}/${file}`));
		const yml = handle.volume.text(`${CWD}/action.yml`) ?? "";
		const outside = (handle.volume.readDirectory("/outside") ?? []).filter((name) => name !== ".keep");
		return { code, outText, errText, present, yml, outside, volume: handle.volume };
	});

describe("effected action init", () => {
	it.effect("exits 0, writes every file and says what is left to do", () =>
		Effect.gen(function* () {
			const { code, outText, errText, present, yml } = yield* cli(["--human"]);
			assert.strictEqual(code, 0, errText);
			assert.deepStrictEqual(present, PLANNED);
			for (const file of PLANNED) assert.include(outText, `wrote ${file}`);
			assert.include(outText, "add dependencies: @effected/github-actions effect @effect/platform-node");
			assert.include(outText, "add devDependencies: @effected/plugin");
			assert.include(outText, "then run: effected action build");
			assert.notInclude(outText, '"type": "module"', "package.json already sets it");
			assert.include(yml, 'name: "greet"');
		}),
	);

	it.effect("--name and --description win over package.json", () =>
		Effect.gen(function* () {
			const { code, errText, yml } = yield* cli(["--human", "--name", "Greeter", "--description", "Says hello"]);
			assert.strictEqual(code, 0, errText);
			assert.include(yml, 'name: "Greeter"');
			assert.include(yml, 'description: "Says hello"');
		}),
	);

	it.effect("--format json writes one ActionInitResult on stdout", () =>
		Effect.gen(function* () {
			const { code, outText, errText } = yield* cli(["--format", "json"]);
			assert.strictEqual(code, 0, errText);
			const document = JSON.parse(outText) as { readonly written: ReadonlyArray<string>; typeModule: boolean };
			assert.deepStrictEqual(document.written, PLANNED);
			assert.isTrue(document.typeModule);
		}),
	);

	it.effect("exits 2 on an existing file, naming it and --force, and writes nothing", () =>
		Effect.gen(function* () {
			const { code, errText, present } = yield* cli(["--human"], { "package.json": MANIFEST, "action.yml": "keep\n" });
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "action.yml");
			assert.include(errText, "--force");
			assert.deepStrictEqual(present, ["action.yml"]);
		}),
	);

	it.effect("--force replaces an existing file", () =>
		Effect.gen(function* () {
			const { code, outText, errText, yml } = yield* cli(["--human", "--force"], {
				"package.json": MANIFEST,
				"action.yml": "keep\n",
			});
			assert.strictEqual(code, 0, errText);
			assert.include(outText, "replaced action.yml");
			assert.include(yml, "runs:");
		}),
	);

	it.effect("exits 2 in a directory with no package.json", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--human", "--name", "a", "--description", "b"], {});
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "package.json");
		}),
	);

	it.effect("exits 2 when no description is given or found", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--human"], { "package.json": JSON.stringify({ name: "x" }) });
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "description");
		}),
	);

	it.effect("exits 2 on a dangling link at a target, and creates nothing where it points", () =>
		Effect.gen(function* () {
			const { code, errText, outside, present } = yield* cli(["--human"], {
				"package.json": MANIFEST,
				"action.yml": MemoryFileSystem.symlink("/outside/pwned.yml"),
			});
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "action.yml (symlink)");
			assert.deepStrictEqual(outside, []);
			assert.deepStrictEqual(present, ["action.yml"], "only the link, nothing written");
		}),
	);

	it.effect("--force over a link to an outside file exits 2 and leaves that file alone", () =>
		Effect.gen(function* () {
			const { code, errText, volume } = yield* cli(
				["--human", "--force"],
				{ "package.json": MANIFEST, "tsconfig.json": MemoryFileSystem.symlink("/outside/precious.json") },
				{ outside: { "/outside/precious.json": "precious\n" } },
			);
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "tsconfig.json (symlink)");
			assert.strictEqual(volume.text("/outside/precious.json"), "precious\n");
		}),
	);

	it.effect("exits 2 on a symlinked src/, and writes nothing into what it points to", () =>
		Effect.gen(function* () {
			const { code, errText, outside } = yield* cli(["--human", "--force"], {
				"package.json": MANIFEST,
				src: MemoryFileSystem.symlink("/outside"),
			});
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "src (symlink)");
			assert.deepStrictEqual(outside, []);
		}),
	);

	it.effect("exits 2 on a directory at a file target, even with --force, writing nothing first", () =>
		Effect.gen(function* () {
			const { code, errText, present } = yield* cli(["--human", "--force"], {
				"package.json": MANIFEST,
				"action.yml": MemoryFileSystem.directory(),
			});
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "action.yml (not-a-file)");
			assert.deepStrictEqual(present, ["action.yml"]);
		}),
	);

	it.effect("exits 2 on a name differing only in case, even with --force, and leaves it alone", () =>
		Effect.gen(function* () {
			const { code, errText, volume } = yield* cli(["--human", "--force"], {
				"package.json": MANIFEST,
				"Action.yml": "keep\n",
			});
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "action.yml (case-variant)");
			assert.strictEqual(volume.text(`${CWD}/Action.yml`), "keep\n");
		}),
	);

	it.effect("exits 2 on a file where src/ goes", () =>
		Effect.gen(function* () {
			const { code, errText, present } = yield* cli(["--human"], { "package.json": MANIFEST, src: "a file\n" });
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "src (not-a-directory)");
			assert.deepStrictEqual(present, []);
		}),
	);

	it.effect("exits 2 on a control character in --name, naming the field", () =>
		Effect.gen(function* () {
			const { code, errText, present } = yield* cli(["--human", "--name", "gr\u007Feet"]);
			assert.strictEqual(code, 2, errText);
			assert.include(errText, "name");
			assert.include(errText, "U+007F");
			assert.deepStrictEqual(present, []);
		}),
	);

	it.effect("exits 3 when a write fails after the checks, naming the files already written", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli(["--human"], undefined, {
				faults: {
					rename: (_from, to) =>
						to === `${CWD}/src/main.ts`
							? Effect.fail(
									PlatformError.systemError({
										_tag: "PermissionDenied",
										module: "FileSystem",
										method: "rename",
										pathOrDescriptor: to,
									}),
								)
							: undefined,
				},
			});
			assert.strictEqual(code, 3, errText);
			assert.include(errText, "src/main.ts");
			assert.include(errText, "already written: effected.toml, action.yml");
		}),
	);
});
