// The sync facade is plain synchronous code, so plain `it()` is correct
// wherever no Effect runs. The parity matrix is the exception: it runs the
// Effect service and the facade over the SAME scripted world and asserts they
// agree, which is the facade's whole promise.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Result } from "effect";
import { ExecContext, LocalExec } from "../src/LocalExec.js";
import type { ScriptResult } from "../src/ScriptedSpawner.js";
import { ScriptedSpawner } from "../src/ScriptedSpawner.js";
import { Tool, VersionNone } from "../src/Tool.js";
import { ResolvedTool, ToolDiscovery, ToolNotFoundError, ToolRefusedError } from "../src/ToolDiscovery.js";
import type { SyncSpawnResult } from "../src/ToolDiscoverySync.js";
import { makeToolDiscoverySync } from "../src/ToolDiscoverySync.js";

const pnpmContext = LocalExec.contextFor("pnpm", { directory: "/repo" });

/** One location's behaviour: absent (spawn fails), or a run with an exit and stdout. */
type Outcome = "absent" | { readonly exit: number; readonly stdout: string };

/** A world in which the global tool and the `pnpm` launcher answer independently. */
interface World {
	readonly global: Outcome;
	readonly launcher: Outcome;
}

const toScript =
	(world: World) =>
	(command: string): ScriptResult => {
		const outcome = command === "pnpm" ? world.launcher : world.global;
		return outcome === "absent" ? ScriptedSpawner.notFound(command) : { stdout: outcome.stdout, exit: outcome.exit };
	};

interface SpawnCall {
	readonly command: string;
	readonly args: ReadonlyArray<string>;
	readonly cwd: string | undefined;
}

/** A recording sync spawn over a world. */
const syncSpawn = (world: World) => {
	const calls: Array<SpawnCall> = [];
	const spawn = (command: string, args: ReadonlyArray<string>, options: { readonly cwd?: string | undefined }) => {
		calls.push({ command, args, cwd: options.cwd });
		const outcome = command === "pnpm" ? world.launcher : world.global;
		return outcome === "absent"
			? ({ error: new Error(`spawn ${command} ENOENT`), status: null, stdout: "" } satisfies SyncSpawnResult)
			: ({ status: outcome.exit, stdout: outcome.stdout } satisfies SyncSpawnResult);
	};
	return { spawn, calls };
};

/** Either a resolution's observable fields or the failure's tag — what parity compares. */
const observe = (result: Result.Result<ResolvedTool, { readonly _tag: string }>) =>
	Result.isSuccess(result)
		? {
				source: result.success.source,
				version: result.success.version,
				globalVersion: result.success.globalVersion,
				localVersion: result.success.localVersion,
				mismatch: result.success.mismatch,
				argv: result.success.argv("x"),
			}
		: { failure: result.failure._tag };

describe("makeToolDiscoverySync — parity with ToolDiscovery", () => {
	const outcomes: ReadonlyArray<readonly [string, Outcome]> = [
		["absent", "absent"],
		["1.0.0", { exit: 0, stdout: "1.0.0" }],
		["2.0.0", { exit: 0, stdout: "v2.0.0\n" }],
		["exit 1", { exit: 1, stdout: "" }],
	];
	const tools: ReadonlyArray<Tool> = [
		Tool.named("biome"),
		Tool.named("biome", { prefer: "global" }),
		Tool.named("biome", { source: "local" }),
		Tool.named("biome", { source: "global" }),
		Tool.named("biome", { source: "both" }),
		Tool.named("biome", { onMismatch: "fail" }),
		Tool.named("biome", { prefer: "global", onMismatch: "preferLocal" }),
		Tool.named("biome", { version: VersionNone.make({}), prefer: "global" }),
		Tool.named("biome", { version: VersionNone.make({ flag: "--help" }), source: "local" }),
	];

	for (const [globalLabel, global] of outcomes) {
		for (const [launcherLabel, launcher] of outcomes) {
			const world: World = { global, launcher };
			it.effect(`global ${globalLabel}, local ${launcherLabel}: every policy answers alike`, () =>
				Effect.gen(function* () {
					const sync = makeToolDiscoverySync({ spawn: syncSpawn(world).spawn, context: pnpmContext });
					const layer = ToolDiscovery.layer.pipe(
						Layer.provide(
							Layer.mergeAll(ScriptedSpawner.make(toScript(world)).layer, LocalExec.layerContext(pnpmContext)),
						),
					);
					for (const tool of tools) {
						const viaEffect = yield* Effect.result(
							Effect.gen(function* () {
								const discovery = yield* ToolDiscovery;
								return yield* discovery.resolve(tool);
							}),
						).pipe(Effect.provide(layer));
						assert.deepStrictEqual(
							observe(sync.resolve(tool)),
							observe(viaEffect),
							`${tool.source}/${tool.onMismatch}/${tool.prefer}`,
						);
					}
				}),
			);
		}
	}
});

describe("makeToolDiscoverySync — probing", () => {
	it("probes the global tool bare and the local one through the launcher, in its directory", () => {
		const { spawn, calls } = syncSpawn({
			global: { exit: 0, stdout: "1.0.0" },
			launcher: { exit: 0, stdout: "1.0.0" },
		});
		makeToolDiscoverySync({ spawn, context: pnpmContext }).resolve(Tool.named("biome"));
		assert.deepStrictEqual(calls, [
			{ command: "biome", args: ["--version"], cwd: undefined },
			{ command: "pnpm", args: ["exec", "biome", "--version"], cwd: "/repo" },
		]);
	});

	it("with no context, only the global copy is probed", () => {
		const { spawn, calls } = syncSpawn({ global: { exit: 0, stdout: "1.0.0" }, launcher: "absent" });
		const resolved = makeToolDiscoverySync({ spawn }).resolve(Tool.named("biome"));
		assert.isTrue(Result.isSuccess(resolved));
		assert.lengthOf(calls, 1);
	});

	it("a context with an empty prefix runs the tool bare, in its directory", () => {
		const { spawn, calls } = syncSpawn({ global: { exit: 0, stdout: "1.0.0" }, launcher: "absent" });
		const context = ExecContext.make({
			label: "direct",
			prefix: [],
			dlxPrefix: [],
			scriptPrefix: [],
			directory: "/repo",
		});
		makeToolDiscoverySync({ spawn, context }).resolve(Tool.named("biome"));
		assert.deepStrictEqual(calls[1], { command: "biome", args: ["--version"], cwd: "/repo" });
	});

	it("a throwing spawn reads as absence, never escapes", () => {
		const discovery = makeToolDiscoverySync({
			spawn: () => {
				throw new Error("boom");
			},
			context: pnpmContext,
		});
		const resolved = discovery.resolve(Tool.named("biome"));
		assert.isTrue(Result.isFailure(resolved) && resolved.failure instanceof ToolNotFoundError);
		assert.isFalse(discovery.isAvailable(Tool.named("biome")));
	});

	it("a signal-ended global run still proves the tool exists", () => {
		const discovery = makeToolDiscoverySync({ spawn: () => ({ status: null, stdout: "" }) });
		assert.isTrue(discovery.isAvailable(Tool.named("biome")));
	});

	it("a refused name never reaches the spawn", () => {
		const discovery = makeToolDiscoverySync({
			spawn: () => {
				throw new Error("the guard must refuse before any spawn");
			},
		});
		for (const name of ["", "-rf", "--version"]) {
			const resolved = discovery.resolve(Tool.named(name));
			assert.isTrue(Result.isFailure(resolved) && resolved.failure instanceof ToolRefusedError, name);
		}
	});
});

describe("makeToolDiscoverySync — a presence-only probe's flag", () => {
	it("passes the caller-chosen flag to both probes", () => {
		const { spawn, calls } = syncSpawn({ global: { exit: 0, stdout: "" }, launcher: { exit: 0, stdout: "" } });
		makeToolDiscoverySync({ spawn, context: pnpmContext }).resolve(
			Tool.named("legacy", { version: VersionNone.make({ flag: "--help" }) }),
		);
		assert.deepStrictEqual(
			calls.map((call) => [call.command, ...call.args]),
			[
				["legacy", "--help"],
				["pnpm", "exec", "legacy", "--help"],
			],
		);
	});
});

describe("makeToolDiscoverySync — caching", () => {
	it("a found tool is probed once, and policy is applied per call", () => {
		const { spawn, calls } = syncSpawn({
			global: { exit: 0, stdout: "1.0.0" },
			launcher: { exit: 0, stdout: "1.0.0" },
		});
		const discovery = makeToolDiscoverySync({ spawn, context: pnpmContext });
		const first = discovery.resolve(Tool.named("biome"));
		const second = discovery.resolve(Tool.named("biome", { prefer: "global" }));
		assert.lengthOf(calls, 2, "one global and one local probe, then none");
		assert.strictEqual(Result.isSuccess(first) && first.success.source, "local");
		assert.strictEqual(Result.isSuccess(second) && second.success.source, "global");
	});

	it("absence is NOT memoized — a tool installed mid-process is found", () => {
		const world: { global: Outcome; launcher: Outcome } = { global: "absent", launcher: "absent" };
		const discovery = makeToolDiscoverySync({
			spawn: (command) => {
				const outcome = command === "pnpm" ? world.launcher : world.global;
				return outcome === "absent"
					? { error: new Error("ENOENT"), status: null, stdout: "" }
					: { status: outcome.exit, stdout: outcome.stdout };
			},
		});
		assert.isFalse(discovery.isAvailable(Tool.named("biome")));
		world.global = { exit: 0, stdout: "1.0.0" };
		assert.isTrue(discovery.isAvailable(Tool.named("biome")));
	});

	it("invalidate forgets one tool, invalidateAll forgets every tool", () => {
		const { spawn, calls } = syncSpawn({ global: { exit: 0, stdout: "1.0.0" }, launcher: "absent" });
		const discovery = makeToolDiscoverySync({ spawn });
		discovery.resolve(Tool.named("biome"));
		discovery.resolve(Tool.named("tsc"));
		assert.lengthOf(calls, 2);

		discovery.invalidate(Tool.named("biome"));
		discovery.resolve(Tool.named("biome"));
		discovery.resolve(Tool.named("tsc"));
		assert.lengthOf(calls, 3, "only biome was re-probed");

		discovery.invalidateAll();
		discovery.resolve(Tool.named("biome"));
		discovery.resolve(Tool.named("tsc"));
		assert.lengthOf(calls, 5);
	});

	it("separate instances keep separate caches", () => {
		const { spawn, calls } = syncSpawn({ global: { exit: 0, stdout: "1.0.0" }, launcher: "absent" });
		makeToolDiscoverySync({ spawn }).resolve(Tool.named("biome"));
		makeToolDiscoverySync({ spawn }).resolve(Tool.named("biome"));
		assert.lengthOf(calls, 2);
	});
});

describe("makeToolDiscoverySync — the resolved tool", () => {
	it("returns the shared ResolvedTool, whose argv carries the launcher for a local copy", () => {
		const { spawn } = syncSpawn({ global: "absent", launcher: { exit: 0, stdout: "2.0.0" } });
		const resolved = makeToolDiscoverySync({ spawn, context: pnpmContext }).resolve(Tool.named("biome"));
		if (Result.isFailure(resolved)) return assert.fail("expected a resolution");
		assert.instanceOf(resolved.success, ResolvedTool);
		assert.deepStrictEqual(resolved.success.argv("check", "--write"), ["pnpm", "exec", "biome", "check", "--write"]);
		assert.deepStrictEqual(resolved.success.version, Option.some("2.0.0"));
		assert.strictEqual(resolved.success.context?.directory, "/repo");
	});
});
