import { assert, describe, layer } from "@effect/vitest";
import type { SpawnScript } from "@effected/commands";
import { ScriptedSpawner } from "@effected/commands";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { WorkspaceDiscovery, WorkspacePackage } from "../src/index.js";
import { PackedInstall } from "../src/testing.js";

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
};
const versions: Record<string, string> = { npm: "11.19.1\n", pnpm: "12.5.1\n", bun: "1.4.2\n" };

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
					assert.deepStrictEqual(spawn.env, { PATH: "/usr/bin", HOME: "/home/u" });
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

	suite(ScriptedSpawner.make(script((command) => (command === "bun" ? { exit: 1 } : {}))))((it) => {
		it.effect("a manager whose --version exits non-zero is unavailable", () =>
			Effect.gen(function* () {
				versions.bun = "";
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
				versions.bun = "1.4.2\n";
				assert.deepStrictEqual([error.reason, error.manager], ["ManagerUnavailable", "bun"]);
			}),
		);
	});

	const failing = ScriptedSpawner.make(
		script((command) => (command === "pnpm" ? { exit: 1, stderr: "ERR_PNPM_BOOM the pack broke" } : {})),
	);
	suite(failing)((it) => {
		it.effect(
			"source mode runs pnpm pack in the package dir into an empty destination, and carries its stderr on failure",
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
					assert.include(error.output ?? "", "ERR_PNPM_BOOM");
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
