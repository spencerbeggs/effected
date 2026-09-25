import { assert, describe, it, layer } from "@effect/vitest";
import type { SpawnScript } from "@effected/commands";
import { ScriptedSpawner } from "@effected/commands";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Duration, Effect, FileSystem, Layer, Path, Redacted } from "effect";
import { WorkspaceDiscovery, WorkspacePackage } from "../src/index.js";
import { InstalledConsumer, PackedInstall } from "../src/testing.js";

const carrier = WorkspacePackage.make({
	name: "@x/carrier",
	version: "1.0.0",
	path: "/repo/packages/carrier",
	packageJsonPath: "/repo/packages/carrier/package.json",
	relativePath: "packages/carrier",
	workspaceRoot: "/repo",
	dependencies: { "@x/lib": "workspace:^" },
});
const lib = WorkspacePackage.make({
	name: "@x/lib",
	version: "1.0.0",
	path: "/repo/packages/lib",
	packageJsonPath: "/repo/packages/lib/package.json",
	relativePath: "packages/lib",
	workspaceRoot: "/repo",
});
const Discovery = WorkspaceDiscovery.layerTest({ listPackages: () => Effect.succeed([carrier, lib]) });
const ENV = {
	PATH: "/usr/bin",
	HOME: "/home/u",
	CI: "true",
	INIT_CWD: "/repo",
	NODE_V8_COVERAGE: "/cov",
	npm_config_user_agent: "pnpm/12",
	pnpm_config_verify_deps_before_run: "false",
	PNPM_SCRIPT_SRC_DIR: "/repo/packages/carrier",
	YARN_NODE_LINKER: "pnp",
};
const SCRUBBED = { PATH: "/usr/bin", HOME: "/home/u" };
const versions: Readonly<Record<string, string>> = { npm: "11.19.1\n", pnpm: "12.5.1\n", bun: "1.4.2\n" };

/** Answers `--version` from `versions` (absent = not installed); everything else from `rest`. */
const script =
	(rest: SpawnScript = () => ({})): SpawnScript =>
	(command, args) => {
		if (args[0] === "--version") {
			const out = versions[command];
			return out === undefined ? ScriptedSpawner.notFound(command) : { stdout: out };
		}
		return rest(command, args);
	};

const suite = (spawner: ScriptedSpawner, seed: Record<string, string> = {}) =>
	layer(Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer, spawner.layer, Discovery));

describe("PackedInstall.run", () => {
	const probing = ScriptedSpawner.make(script());
	suite(probing)((it) => {
		it.effect("probes each manager with --version from the scratch dir, under a scrubbed env, stdin ignored", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({
						carrier: "@x/carrier",
						closure: "auto",
						managers: ["npm", "pnpm", "yarn", "bun"],
						packFrom: { directory: "dist/pkg" },
						bins: ["x"],
						env: ENV,
					}),
				);
				assert.strictEqual(error.reason, "PackSourceMissing");
				assert.strictEqual(error.package, "@x/carrier");
				const probes = probing.spawns.slice(0, 4);
				assert.deepStrictEqual(
					probes.map((spawn) => [spawn.command, ...spawn.args]),
					[
						["npm", "--version"],
						["pnpm", "--version"],
						["yarn", "--version"],
						["bun", "--version"],
					],
				);
				for (const spawn of probes) {
					assert.strictEqual(spawn.cwd, probes[0]?.cwd);
					assert.isTrue(spawn.cwd?.startsWith("/tmp/"), `probed from ${spawn.cwd}, never the repo`);
					assert.deepStrictEqual(spawn.env, SCRUBBED);
					assert.strictEqual(spawn.extendEnv, false);
					assert.strictEqual(spawn.options.stdin, "ignore");
				}
				assert.strictEqual(probing.spawns.length, 4, "nothing packed from a missing directory");
			}),
		);
	});

	suite(ScriptedSpawner.make(script(() => ({}))))((it) => {
		it.effect("fails NoManagerAvailable rather than succeeding with nothing installed", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["yarn"], bins: [], env: ENV }),
				);
				assert.strictEqual(error.reason, "NoManagerAvailable");
			}),
		);

		it.effect("an empty managers list fails NoManagerAvailable saying so, before anything spawns", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: [], bins: [], env: ENV }),
				);
				assert.strictEqual(error.reason, "NoManagerAvailable");
				assert.include(error.message, "managers is empty");
			}),
		);

		it.effect("require all: a missing manager fails ManagerUnavailable, naming it", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({
						carrier: "@x/carrier",
						closure: "auto",
						managers: ["npm", "yarn"],
						require: "all",
						bins: [],
						env: ENV,
					}),
				);
				assert.deepStrictEqual([error.reason, error.manager], ["ManagerUnavailable", "yarn"]);
			}),
		);

		it.effect("fails UnknownPackage for a carrier the workspace does not contain", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/nope", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.package], ["UnknownPackage", "@x/nope"]);
			}),
		);
	});

	// bun prints a perfectly good version and exits 1 (a corepack refusal looks like this): only the exit code rules it out.
	const refusing: SpawnScript = (command, args) =>
		command === "bun" && args[0] === "--version" ? { exit: 1, stdout: "1.4.2\n" } : script()(command, args);
	suite(ScriptedSpawner.make(refusing))((it) => {
		it.effect("a manager whose --version exits non-zero is unavailable", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({
						carrier: "@x/carrier",
						closure: "auto",
						managers: ["npm", "bun"],
						require: "all",
						bins: [],
						env: ENV,
					}),
				);
				assert.deepStrictEqual([error.reason, error.manager], ["ManagerUnavailable", "bun"]);
			}),
		);
	});

	const failing = ScriptedSpawner.make(
		script((command) =>
			command === "pnpm"
				? { exit: 1, stdout: "ERR_PNPM_BOOM the pack broke", stderr: "WARN this project pins pnpm@12.6.0" }
				: {},
		),
	);
	suite(failing)((it) => {
		it.effect(
			"source mode runs pnpm pack in the package dir into an empty destination, and carries both streams on failure",
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(
						PackedInstall.run({
							carrier: "@x/carrier",
							closure: "auto",
							managers: ["npm"],
							packFrom: "source",
							bins: [],
							env: ENV,
						}),
					);
					assert.deepStrictEqual([error.reason, error.package], ["PackFailed", "@x/carrier"]);
					assert.include(error.output ?? "", "ERR_PNPM_BOOM", "the real error on stdout survives a stderr banner");
					assert.include(error.output ?? "", "WARN this project pins");
					assert.notInclude(error.message, "pnpm install", "the hint is reserved for the workspace-protocol failure");
					const pack = failing.spawns[1];
					assert.strictEqual(pack?.command, "pnpm");
					assert.strictEqual(pack?.cwd, "/repo/packages/carrier");
					assert.deepStrictEqual(
						pack?.args.filter((arg) => !arg.startsWith("/")),
						["pack", "--pack-destination", "--config.ignore-scripts=true"],
					);
				}),
		);
	});

	const backslash = Layer.effect(
		Path.Path,
		Effect.gen(function* () {
			const posix = yield* Path.Path;
			return { ...posix, sep: "\\" };
		}),
	).pipe(Layer.provide(Path.layer));
	const refused = ScriptedSpawner.make(script());
	layer(Layer.mergeAll(MemoryFileSystem.layerWith({}), backslash, refused.layer, Discovery))((it) => {
		it.effect("refuses a non-POSIX platform before spawning anything", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.strictEqual(error.reason, "UnsupportedPlatform");
				assert.strictEqual(refused.spawns.length, 0);
			}),
		);
	});

	const defaulted = ScriptedSpawner.make(script());
	suite(defaulted, { "/repo/packages/carrier/dist/prod/npm/pkg/package.json": "{}" })((it) => {
		it.effect("packs from dist/prod/npm/pkg with npm by default, and fails when no tarball lands", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.package], ["PackFailed", "@x/carrier"]);
				assert.include(error.message, "found 0");
				const pack = defaulted.spawns[1];
				assert.strictEqual(pack?.command, "npm");
				assert.strictEqual(pack?.cwd, "/repo/packages/carrier/dist/prod/npm/pkg");
				const destination = pack?.args[3] ?? "";
				assert.deepStrictEqual(pack?.args, ["pack", "--ignore-scripts", "--pack-destination", destination]);
				assert.isTrue(
					destination.startsWith(defaulted.spawns[0]?.cwd ?? "<no probe>"),
					"the destination lives in the scratch dir",
				);
			}),
		);
	});

	const uninstalled = ScriptedSpawner.make(
		script((command) =>
			command === "pnpm"
				? {
						exit: 1,
						stderr:
							'ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL Cannot resolve workspace protocol of dependency "@x/lib" because this dependency is not installed. Try running "pnpm install".',
					}
				: {},
		),
	);
	suite(uninstalled)((it) => {
		it.effect("source mode in a never-installed workspace names the missing pnpm install", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({
						carrier: "@x/carrier",
						closure: "auto",
						managers: ["npm"],
						packFrom: "source",
						bins: [],
						env: ENV,
					}),
				);
				assert.deepStrictEqual([error.reason, error.package], ["PackFailed", "@x/carrier"]);
				assert.include(error.message, "run pnpm install in the workspace");
				assert.include(error.output ?? "", "ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL");
			}),
		);
	});
});

describe("PackedInstall.run past the pack", () => {
	// The scratch directory is pinned to /scratch through a fault handler, so a
	// seed can stand in for what npm pack writes and what an install links.
	const SCRATCH = "/scratch";
	const CARRIER_TGZ = "/scratch/tarballs/0/x-carrier-1.0.0.tgz";
	const LIB_TGZ = "/scratch/tarballs/1/x-lib-1.0.0.tgz";
	const BIN = MemoryFileSystem.file("#!/usr/bin/env node\n", { mode: 0o755 });
	const seedWith = (extra: MemoryFileSystemSeed = {}): MemoryFileSystemSeed => ({
		"/repo/packages/carrier/dist/prod/npm/pkg/package.json": "{}",
		"/repo/packages/lib/dist/prod/npm/pkg/package.json": "{}",
		[SCRATCH]: MemoryFileSystem.directory(),
		[CARRIER_TGZ]: "",
		[LIB_TGZ]: "",
		...extra,
	});
	const manifests = (carrierDeps: Record<string, string> = { "@x/lib": "^1.0.0" }): SpawnScript =>
		script((command, args) => {
			if (command === "tar") {
				const name = args[1] === CARRIER_TGZ ? "@x/carrier" : "@x/lib";
				const dependencies = name === "@x/carrier" ? carrierDeps : {};
				return { stdout: JSON.stringify({ name, version: "1.0.0", dependencies }) };
			}
			return {};
		});
	const installSuite = (
		spawner: ScriptedSpawner,
		seed: MemoryFileSystemSeed,
		options?: { excludeTestServices: true },
	) =>
		layer(
			Layer.mergeAll(
				MemoryFileSystem.layerFaultyWith(seed, { makeTempDirectoryScoped: () => Effect.succeed(SCRATCH) }),
				Path.layer,
				spawner.layer,
				Discovery,
			),
			options,
		);

	const happy = ScriptedSpawner.make(manifests());
	installSuite(
		happy,
		seedWith({
			"/scratch/consumer-npm/node_modules/.bin/x": BIN,
			"/scratch/consumer-pnpm/node_modules/.bin/x": BIN,
		}),
	)((it) => {
		it.effect("installs under every available manager and reports consumers, unavailable managers and tarballs", () =>
			Effect.gen(function* () {
				const result = yield* PackedInstall.run({
					carrier: "@x/carrier",
					closure: "auto",
					managers: ["npm", "yarn", "pnpm"],
					bins: ["x"],
					env: ENV,
				});
				assert.deepStrictEqual(
					result.consumers.map((c) => [c.manager, c.managerVersion, c.directory]),
					[
						["npm", "11.19.1", "/scratch/consumer-npm"],
						["pnpm", "12.5.1", "/scratch/consumer-pnpm"],
					],
				);
				assert.strictEqual(result.consumers[0]?.binPath("x"), "/scratch/consumer-npm/node_modules/.bin/x");
				assert.deepStrictEqual(result.unavailable, ["yarn"], "require defaults to any");
				assert.deepStrictEqual(result.tarballs, { "@x/carrier": CARRIER_TGZ, "@x/lib": LIB_TGZ });
				assert.strictEqual(result.scratch, SCRATCH, "the scratch root is exposed");
				assert.include(String(result.consumers[0]), "/scratch/consumer-npm", "the printed consumer shows its fields");
				assert.notInclude(String(result.consumers[0]), "/home/u", "but its env prints redacted");

				const tars = happy.spawns.filter((spawn) => spawn.command === "tar");
				assert.deepStrictEqual(
					tars.map((spawn) => [spawn.cwd, ...spawn.args]),
					[
						["/scratch/tarballs/0", "-xzOf", CARRIER_TGZ, "package/package.json"],
						["/scratch/tarballs/1", "-xzOf", LIB_TGZ, "package/package.json"],
					],
				);

				const installs = happy.spawns.filter((spawn) => spawn.args[0] === "install");
				assert.deepStrictEqual(
					installs.map((spawn) => [spawn.command, spawn.cwd, ...spawn.args]),
					[
						["npm", "/scratch/consumer-npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"],
						["pnpm", "/scratch/consumer-pnpm", "install", "--config.ignore-scripts=true"],
					],
				);
				for (const spawn of installs) {
					assert.deepStrictEqual(spawn.env, SCRUBBED);
					assert.strictEqual(spawn.extendEnv, false);
					assert.strictEqual(spawn.options.stdin, "ignore");
				}

				const fs = yield* FileSystem.FileSystem;
				const npmManifest = JSON.parse(yield* fs.readFileString("/scratch/consumer-npm/package.json")) as Record<
					string,
					unknown
				>;
				assert.strictEqual(npmManifest.packageManager, "npm@11.19.1");
				assert.deepStrictEqual(npmManifest.dependencies, { "@x/carrier": `file:${CARRIER_TGZ}` });
				assert.deepStrictEqual(npmManifest.overrides, { "@x/lib": `file:${LIB_TGZ}` });
				assert.strictEqual(
					yield* fs.readFileString("/scratch/consumer-pnpm/pnpm-workspace.yaml"),
					`overrides:\n  "@x/lib": "file:${LIB_TGZ}"\n`,
				);
			}),
		);
	});

	const unresolved = ScriptedSpawner.make(manifests({ "@x/lib": "workspace:^" }));
	installSuite(
		unresolved,
		seedWith(),
	)((it) => {
		it.effect("a packed manifest still carrying workspace: fails UnresolvedProtocol before any install", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.package], ["UnresolvedProtocol", "@x/carrier"]);
				assert.include(error.message, "dependencies.@x/lib: workspace:^");
				assert.strictEqual(
					unresolved.spawns.filter((spawn) => spawn.command === "tar").length,
					1,
					"the manifest was read",
				);
				assert.isFalse(unresolved.spawns.some((spawn) => spawn.args[0] === "install"));
			}),
		);
	});

	const absent = ScriptedSpawner.make(manifests());
	installSuite(
		absent,
		seedWith({ "/scratch/consumer-npm/node_modules/.bin/x": BIN }),
	)((it) => {
		it.effect("a bin the install did not link fails MissingBin, naming it", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({
						carrier: "@x/carrier",
						closure: "auto",
						managers: ["npm"],
						bins: ["x", "ghost"],
						env: ENV,
					}),
				);
				assert.deepStrictEqual([error.reason, error.manager], ["MissingBin", "npm"]);
				assert.include(error.message, ".bin/ghost", "x is present and passed; ghost is the one reported");
				// What .bin DOES hold separates a wrong bin name from a link that never happened.
				assert.strictEqual(error.package, "@x/carrier");
				assert.strictEqual(error.output, "node_modules/.bin holds: x");
				assert.include(error.message, "node_modules/.bin holds: x");
			}),
		);
	});

	installSuite(
		ScriptedSpawner.make(manifests()),
		seedWith(),
	)((it) => {
		it.effect("MissingBin says so when the install linked no .bin directory at all", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: ["x"], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.package], ["MissingBin", "@x/carrier"]);
				assert.strictEqual(error.output, "node_modules/.bin does not exist or cannot be listed");
			}),
		);
	});

	const twice = ScriptedSpawner.make(manifests());
	installSuite(
		twice,
		seedWith({ "/scratch/consumer-npm/node_modules/.bin/x": BIN }),
	)((it) => {
		it.effect("a manager listed twice is probed and installed once, never twice into one directory", () =>
			Effect.gen(function* () {
				const result = yield* PackedInstall.run({
					carrier: "@x/carrier",
					closure: "auto",
					managers: ["npm", "npm"],
					bins: ["x"],
					env: ENV,
				});
				assert.deepStrictEqual(
					result.consumers.map((consumer) => consumer.manager),
					["npm"],
				);
				assert.strictEqual(twice.spawns.filter((spawn) => spawn.args[0] === "--version").length, 1);
				assert.strictEqual(twice.spawns.filter((spawn) => spawn.args[0] === "install").length, 1);
			}),
		);
	});

	const unexecutable = ScriptedSpawner.make(manifests());
	installSuite(
		unexecutable,
		seedWith({ "/scratch/consumer-npm/node_modules/.bin/x": MemoryFileSystem.file("", { mode: 0o644 }) }),
	)((it) => {
		it.effect("a bin present without an execute bit fails MissingBin", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: ["x"], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.manager], ["MissingBin", "npm"]);
				assert.include(error.message, ".bin/x is missing or not executable");
			}),
		);
	});

	const crowded = ScriptedSpawner.make(manifests());
	installSuite(
		crowded,
		seedWith({ "/scratch/tarballs/0/stale-0.9.0.tgz": "" }),
	)((it) => {
		it.effect("two tarballs in one destination fail PackFailed rather than picking one", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.package], ["PackFailed", "@x/carrier"]);
				assert.include(error.message, "found 2");
			}),
		);
	});

	const LONG = "a".repeat(3000);
	const brokenInstall = ScriptedSpawner.make((command, args) =>
		args[0] === "install" ? { exit: 1, stdout: LONG, stderr: "ERR_INSTALL_BOOM" } : manifests()(command, args),
	);
	installSuite(
		brokenInstall,
		seedWith(),
	)((it) => {
		it.effect("a failed install fails InstallFailed with the tail of both streams", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.manager], ["InstallFailed", "npm"]);
				const output = error.output ?? "";
				assert.isTrue(output.endsWith("ERR_INSTALL_BOOM"), "stderr comes last");
				assert.isTrue(output.startsWith("aaa"), "stdout precedes it");
				assert.strictEqual(output.length, 2000, "only the tail is kept");
			}),
		);
	});

	// The real clock: installTimeout is a real ceiling, and a hung install must trip it.
	const hungInstall = ScriptedSpawner.make((command, args) =>
		args[0] === "install" ? { hang: true } : manifests()(command, args),
	);
	installSuite(hungInstall, seedWith(), { excludeTestServices: true })((it) => {
		it.effect("an install that outlives installTimeout fails InstallFailed naming the manager and the ceiling", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({
						carrier: "@x/carrier",
						closure: "auto",
						managers: ["npm"],
						bins: [],
						env: ENV,
						installTimeout: "50 millis",
					}),
				).pipe(Effect.timeout("3 seconds"));
				assert.deepStrictEqual([error.reason, error.manager], ["InstallFailed", "npm"]);
				assert.strictEqual(error.message, "npm install timed out after 50ms");
				assert.isTrue(
					hungInstall.spawns.some((spawn) => spawn.args[0] === "install"),
					"the install was spawned",
				);
			}),
		);
	});

	// The discriminating control: a spawn that never started keeps the spawn-failure message.
	const unspawnable = ScriptedSpawner.make((command, args) =>
		args[0] === "install" ? ScriptedSpawner.notFound(command) : manifests()(command, args),
	);
	installSuite(
		unspawnable,
		seedWith(),
	)((it) => {
		it.effect("an install that cannot spawn fails InstallFailed as could not run, not as a timeout", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					PackedInstall.run({ carrier: "@x/carrier", closure: "auto", managers: ["npm"], bins: [], env: ENV }),
				);
				assert.deepStrictEqual([error.reason, error.manager], ["InstallFailed", "npm"]);
				assert.strictEqual(error.message, "npm install could not run");
			}),
		);
	});
});

describe("InstalledConsumer.runBin", () => {
	const BIN_DIR = "/scratch/consumer-npm";
	const consumer = InstalledConsumer.make({
		manager: "npm",
		managerVersion: "11.19.1",
		directory: BIN_DIR,
		env: Redacted.make({ PATH: "/usr/bin", HOME: "/home/u", XDG_DATA_HOME: "/home/u/.local/share" }),
	});
	const runs = ScriptedSpawner.make((command) =>
		command.endsWith("/tool") ? { stdout: "1.2.3\n", stderr: "warn\n", exit: 3 } : ScriptedSpawner.notFound(command),
	);
	layer(runs.layer)((it) => {
		it.effect(
			"runs the bin from the consumer under the install env, extra env layered over, a non-zero exit a result",
			() =>
				Effect.gen(function* () {
					const output = yield* consumer.runBin("tool", ["--version"], {
						env: { XDG_DATA_HOME: "/scratch/xdg", HOME: undefined, CI: "true", npm_config_user_agent: "pnpm/12" },
					});
					assert.deepStrictEqual([output.stdout, output.stderr, output.exitCode], ["1.2.3\n", "warn\n", 3]);
					const [spawn] = runs.spawns;
					assert.deepStrictEqual(
						[spawn?.command, ...(spawn?.args ?? [])],
						[`${BIN_DIR}/node_modules/.bin/tool`, "--version"],
					);
					assert.strictEqual(spawn?.cwd, BIN_DIR);
					assert.deepStrictEqual(spawn?.env, { PATH: "/usr/bin", XDG_DATA_HOME: "/scratch/xdg" });
					assert.strictEqual(spawn?.extendEnv, false);
					assert.strictEqual(spawn?.options.stdin, "ignore");
				}),
		);

		it.effect("a bin that cannot spawn fails BinFailed naming the manager and the bin", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(consumer.runBin("absent"));
				assert.deepStrictEqual([error.reason, error.manager], ["BinFailed", "npm"]);
				assert.strictEqual(error.message, "npm: absent could not run");
			}),
		);

		it.effect("a hand-made consumer without env runs under only the options env, from the cwd given", () =>
			Effect.gen(function* () {
				const bare = InstalledConsumer.make({ manager: "pnpm", managerVersion: "12.5.1", directory: BIN_DIR });
				yield* bare.runBin("tool", [], { env: { PATH: "/bin" }, cwd: "/elsewhere" });
				const spawn = runs.spawns.at(-1);
				assert.deepStrictEqual(spawn?.env, { PATH: "/bin" });
				assert.strictEqual(spawn?.cwd, "/elsewhere");
			}),
		);
	});

	// The real clock: the bin's ceiling is a real ceiling.
	const hung = ScriptedSpawner.make(() => ({ hang: true }));
	layer(hung.layer, { excludeTestServices: true })((it) => {
		it.effect("a bin that outlives its timeout fails BinFailed naming the ceiling", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(consumer.runBin("tool", [], { timeout: "50 millis" })).pipe(
					Effect.timeout("3 seconds"),
				);
				assert.deepStrictEqual([error.reason, error.message], ["BinFailed", "npm: tool timed out after 50ms"]);
			}),
		);
	});
});

describe("PackedInstall.timeoutBudget", () => {
	const minutes = (duration: Duration.Duration): number => Duration.toMillis(duration) / 60_000;

	it("sums every manager's probe, install and perConsumer, every package's pack and manifest read, and the slack", () => {
		const budget = PackedInstall.timeoutBudget({
			managers: ["npm", "pnpm", "yarn", "bun"],
			installTimeout: "3 minutes",
			packages: 3,
			perConsumer: "2 minutes",
		});
		// 4 x (0.5 + 3 + 2) + 3 x (2 + 0.5) + 0.5
		assert.strictEqual(minutes(budget), 30);
		assert.strictEqual(Duration.format(budget), "30m");
	});

	it("defaults installTimeout to the run's four minutes and perConsumer to zero, and counts a repeated manager once", () => {
		const budget = PackedInstall.timeoutBudget({ managers: ["npm", "npm"], packages: 1 });
		// 1 x (0.5 + 4) + 1 x 2.5 + 0.5
		assert.strictEqual(minutes(budget), 7.5);
	});
});

describe("InstalledConsumer.binProvenance", () => {
	const DIR = "/scratch/consumer-npm";
	const NM = `${DIR}/node_modules`;
	const at = (manager: "npm" | "pnpm") => InstalledConsumer.make({ manager, managerVersion: "1.0.0", directory: DIR });
	const SEED: MemoryFileSystemSeed = {
		[`${NM}/@x/carrier/package.json`]: JSON.stringify({ name: "@x/carrier", version: "1.0.0" }),
		[`${NM}/@x/carrier/dist/package.json`]: JSON.stringify({ type: "module" }),
		[`${NM}/@x/carrier/dist/bin.js`]: "#!/usr/bin/env node\n",
		[`${NM}/@x/cli/package.json`]: JSON.stringify({ name: "@x/cli", version: "1.0.0" }),
		[`${NM}/@x/cli/bin.js`]: "#!/usr/bin/env node\n",
		[`${NM}/loose.js`]: "#!/usr/bin/env node\n",
		[`${NM}/.bin/tool`]: MemoryFileSystem.symlink("../@x/carrier/dist/bin.js"),
		[`${NM}/.bin/shadowed`]: MemoryFileSystem.symlink("../@x/cli/bin.js"),
		[`${NM}/.bin/orphan`]: MemoryFileSystem.symlink("../loose.js"),
		[`${NM}/.bin/shim`]: MemoryFileSystem.file('#!/bin/sh\nexec node "$basedir/../@x/carrier/dist/bin.js" "$@"\n', {
			mode: 0o755,
		}),
	};
	layer(Layer.mergeAll(MemoryFileSystem.layerWith(SEED), Path.layer))((it) => {
		it.effect("names the package a .bin symlink resolves into, past a nameless nested package.json", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* at("npm").binProvenance("tool"), {
					package: "@x/carrier",
					target: `${NM}/@x/carrier/dist/bin.js`,
				});
			}),
		);

		it.effect("tells a hoisted bin from another package apart from the carrier's", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* at("npm").binProvenance("shadowed"))?.package, "@x/cli");
			}),
		);

		it.effect("a shim that is not a symlink (pnpm's) is undefined, not a guess", () =>
			Effect.gen(function* () {
				assert.isUndefined(yield* at("pnpm").binProvenance("shim"));
			}),
		);

		it.effect("a link into no named package inside the consumer is undefined", () =>
			Effect.gen(function* () {
				assert.isUndefined(yield* at("npm").binProvenance("orphan"));
			}),
		);

		it.effect("a missing entry fails MissingBin naming the manager", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(at("npm").binProvenance("absent"));
				assert.deepStrictEqual([error.reason, error.manager], ["MissingBin", "npm"]);
				assert.strictEqual(error.message, "npm: node_modules/.bin/absent does not exist");
			}),
		);
	});
});
