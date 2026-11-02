import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Run } from "@effected/commands";
import { McpProbe, McpProcess } from "@effected/mcp-kit/testing";
import { Workspaces } from "@effected/workspaces";
import type { InstalledConsumer, PackedInstallOptions, PackedInstallResult } from "@effected/workspaces/testing";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, FileSystem, Layer, Redacted } from "effect";
import { ChildProcess } from "effect/process";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const CARRIER = "@effected/plugin";

const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * ONE options object: `closure` plans with it, `run` installs with it. The
 * front ends declare the carrier's bin names too, on purpose (each is also
 * installed and run alone), so `allowSharedBins` is set and the carrier's own
 * shims are proven with `runCarrierBin` / `carrierCommand`.
 */
const RUN: PackedInstallOptions = {
	carrier: CARRIER,
	closure: "auto",
	// While a dogfood loop links an unreleased sibling build, the consumers get it too; otherwise inert.
	workspaceOverrides: true,
	// CI provisions npm, pnpm and bun (root devEngines), so they are required there; yarn is opportunistic locally.
	managers: process.env.CI ? ["npm", "pnpm", "bun"] : ["npm", "pnpm", "bun", "yarn"],
	bins: ["effected", "effected-mcp"],
	allowSharedBins: true,
	// A runner exporting FORCE_COLOR would colour the output asserted below.
	env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
	// A missing manager fails in CI; locally any one that is installed is enough.
	require: process.env.CI ? "all" : "any",
	installTimeout: "3 minutes",
	packTimeout: "30 seconds",
};

/**
 * What `@effected/pnpm-plugin-effected` sets as `publicHoistPattern` (its
 * catalog test reads it from the built hook); here it is the setting under
 * test, written into a scratch workspace.
 */
const HOIST = ["@effected/plugin"];

// Module evaluation, before `describe` runs. PackedInstall packs `dist/prod/npm/pkg` (the release
// artifact): with it absent the suite skips locally and FAILS under CI, so it never stops proving the
// published tarballs silently. The gate reads `CI` through `Config`.
const GATE = await Effect.runPromise(
	PackedInstall.preflight(RUN).pipe(Effect.flatMap(PackedInstall.gate), Effect.provide(Live)),
);
// PackedInstall is POSIX-only.
const RUNNABLE = GATE.action === "run" && process.platform !== "win32";

// The names the run will pack.
const PACKED = RUNNABLE
	? await Effect.runPromise(PackedInstall.closure(RUN.carrier, RUN).pipe(Effect.provide(Live)))
	: [];
const BUDGET = PackedInstall.timeoutBudget({
	managers: RUN.managers,
	installTimeout: RUN.installTimeout,
	packTimeout: RUN.packTimeout,
	packages: PACKED,
	// Per consumer: two --version runs, an MCP handshake and an MCP session; plus the two pnpm workspaces.
	perConsumer: "4 minutes",
});

const VERSION = /^effected \d+\.\d+\.\d+ via @effected\/plugin (\d+\.\d+\.\d+)$/;

interface ToolsList {
	readonly result?: { readonly tools?: ReadonlyArray<{ readonly name: string }> };
}
interface ToolCall {
	readonly result?: {
		readonly isError?: boolean;
		readonly structuredContent?: {
			readonly tool?: unknown;
			readonly distribution?: { readonly name?: unknown; readonly version?: unknown } | null;
			readonly effect?: unknown;
		};
	};
}

/** The carrier's `effected-mcp` over stdio: list the tools, call `identity`, close. */
const mcpSession = (consumer: InstalledConsumer, env: Record<string, string>) =>
	Effect.gen(function* () {
		const child = yield* McpProcess.spawn(yield* consumer.carrierCommand("effected-mcp", [], { env }));
		yield* child.handshake();
		yield* child.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const listed = (yield* child.readUntilResponse(2)).response as ToolsList;
		yield* child.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "identity", arguments: {} } });
		const called = (yield* child.readUntilResponse(3)).response as ToolCall;
		yield* child.closeStdin;
		return { listed, called, exitCode: yield* child.exitCode, stderr: yield* child.stderrFinal };
	}).pipe(Effect.scoped, Effect.timeout("30 seconds"));

/**
 * A pnpm workspace consumer: the carrier is a dependency of the leaf
 * `packages/tools`, and `effected` is run from its sibling leaf
 * `packages/app`, which depends on nothing. pnpm links a package's bins only
 * into the projects that declare it, so only the hoist puts `effected` where
 * `app` (and the root) can reach it. With the carrier as a root
 * devDependency instead, `pnpm exec` reaches it from every leaf with or
 * without the hoist, so that layout would prove nothing about the hoist.
 */
const pnpmWorkspace = (
	result: PackedInstallResult,
	consumer: InstalledConsumer,
	name: string,
	hoist: ReadonlyArray<string> | undefined,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = `${result.scratch}/${name}`;
		const tarball = (pkg: string) => `file:${result.tarballs[pkg]}`;
		const overrides = Object.fromEntries(
			Object.keys(result.tarballs)
				.filter((pkg) => pkg !== CARRIER)
				.map((pkg) => [pkg, tarball(pkg)]),
		);
		const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
		yield* fs.makeDirectory(`${directory}/packages/tools`, { recursive: true });
		yield* fs.makeDirectory(`${directory}/packages/app`, { recursive: true });
		yield* fs.writeFileString(
			`${directory}/package.json`,
			json({
				name,
				version: "0.0.0",
				private: true,
				devEngines: { packageManager: { name: "pnpm", version: consumer.managerVersion, onFail: "ignore" } },
			}),
		);
		// JSON is valid YAML.
		yield* fs.writeFileString(
			`${directory}/pnpm-workspace.yaml`,
			json({
				packages: ["packages/*"],
				minimumReleaseAge: 0,
				overrides,
				...(hoist === undefined ? {} : { publicHoistPattern: hoist }),
			}),
		);
		yield* fs.writeFileString(
			`${directory}/packages/tools/package.json`,
			json({ name: "tools", version: "0.0.0", private: true, dependencies: { [CARRIER]: tarball(CARRIER) } }),
		);
		yield* fs.writeFileString(
			`${directory}/packages/app/package.json`,
			json({ name: "app", version: "0.0.0", private: true }),
		);
		const env = consumer.env === undefined ? PackedInstall.scrubEnv(RUN.env) : Redacted.value(consumer.env);
		const pnpm = (args: ReadonlyArray<string>, cwd: string) =>
			Run.collect(ChildProcess.make("pnpm", args, { cwd, env, extendEnv: false, stdin: "ignore" }), {
				timeout: "3 minutes",
			});
		const install = yield* pnpm(["install", "--config.ignore-scripts=true"], directory);
		assert.isTrue(install.succeeded, `${name} install: ${install.stdout}\n${install.stderr}`);
		return yield* pnpm(["exec", "effected", "--version"], `${directory}/packages/app`);
	});

describe.runIf(GATE.action === "fail")("packed install (@effected/plugin) prod build", () => {
	it("dist/prod exists (run `pnpm build --filter @effected/plugin...` before the tests)", () => {
		assert.fail(GATE.message);
	});
});

describe.skipIf(!RUNNABLE)("packed install (@effected/plugin)", () => {
	layer(Live, { excludeTestServices: true })((it) => {
		it.effect(
			"the carrier's bins work from a packed install under every available manager",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const manifest = JSON.parse(yield* fs.readFileString(`${ROOT}/packages/plugin/package.json`)) as {
						readonly version: string;
					};
					const result = yield* PackedInstall.run(RUN);
					assert.deepStrictEqual(Object.keys(result.tarballs), [...PACKED]);
					assert.isAbove(result.consumers.length, 0);
					yield* Effect.log(`packed ${PACKED.length} packages; unavailable: [${result.unavailable.join(", ")}]`);
					const env = { XDG_DATA_HOME: `${result.scratch}/xdg`, XDG_STATE_HOME: `${result.scratch}/xdg-state` };
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						// What a user typing the bin name gets: SOME package's bin runs.
						const typed = yield* consumer.runBin("effected", ["--version"], { env });
						assert.strictEqual(typed.exitCode, 0, `${label}: ${typed.stderr}`);

						// The carrier's own shim, whichever package took the .bin slot.
						const own = yield* consumer.runCarrierBin("effected", ["--version"], { env });
						assert.strictEqual(own.exitCode, 0, `${label}: ${own.stderr}`);
						const version = VERSION.exec(own.stdout.trim());
						assert.isNotNull(version, `${label}: ${own.stdout}`);
						assert.strictEqual(version?.[1], manifest.version, label);

						// MCP: a clean boot (no JSON-RPC error, clean stderr, exit 0).
						const probe = yield* McpProbe.initialize(yield* consumer.carrierCommand("effected-mcp", [], { env })).pipe(
							Effect.timeout("30 seconds"),
						);
						assert.isUndefined(probe.response.error, label);
						assert.strictEqual(probe.stderr, "", label);
						assert.strictEqual(probe.exitCode, 0, label);

						// MCP: the identity tool, answered from the published artifact. A real
						// effect version proves the bundled `effect/package.json` import resolves.
						const session = yield* mcpSession(consumer, env);
						assert.deepStrictEqual(
							session.listed.result?.tools?.map((tool) => tool.name),
							["identity"],
							label,
						);
						assert.strictEqual(session.called.result?.isError ?? false, false, label);
						const report = session.called.result?.structuredContent;
						assert.strictEqual(report?.tool, "effected", label);
						assert.deepStrictEqual(report?.distribution, { name: CARRIER, version: manifest.version }, label);
						assert.match(String(report?.effect), /^\d+\.\d+\.\d+/, label);
						assert.strictEqual(session.exitCode, 0, `${label}: ${session.stderr}`);

						// Which package owns each .bin slot under shared bins (undefined: pnpm's shims).
						for (const bin of RUN.bins) {
							const provenance = yield* consumer.binProvenance(bin);
							yield* Effect.log(`${label} .bin/${bin} -> ${provenance?.package ?? "a shim"}`);
						}
					}

					// The hoist: a pnpm workspace whose leaf carries the carrier, run from a sibling leaf.
					const pnpm = result.consumers.find((consumer) => consumer.manager === "pnpm");
					if (pnpm === undefined) {
						yield* Effect.log("pnpm unavailable: the workspace hoist was not proven");
						return;
					}
					const hoisted = yield* pnpmWorkspace(result, pnpm, "workspace-hoisted", HOIST);
					assert.strictEqual(hoisted.exitCode, 0, `hoisted: ${hoisted.stderr}`);
					assert.strictEqual(VERSION.exec(hoisted.stdout.trim())?.[1], manifest.version, hoisted.stdout);
					// Control: the same workspace without the hoist cannot reach the bin from `app`.
					const unhoisted = yield* pnpmWorkspace(result, pnpm, "workspace-unhoisted", undefined);
					assert.notStrictEqual(unhoisted.exitCode, 0, `unhoisted unexpectedly ran: ${unhoisted.stdout}`);
				}).pipe(Effect.scoped, Effect.timeout(BUDGET)),
			// vitest's own guard a minute above the Effect's, so a named PackedInstallError fires first.
			Duration.toMillis(BUDGET) + 60_000,
		);
	});
});
