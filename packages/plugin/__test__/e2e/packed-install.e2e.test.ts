import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Run } from "@effected/commands";
import { McpProbe, McpProcess } from "@effected/mcp-kit/testing";
import { Workspaces } from "@effected/workspaces";
import type {
	PackedInstallOptions,
	PackedInstallPreflightOptions,
	PackedInstallResult,
} from "@effected/workspaces/testing";
import { InstalledConsumer, PackedInstall } from "@effected/workspaces/testing";
import { Context, Duration, Effect, FileSystem, Layer, Redacted } from "effect";
import effectPackage from "effect/package.json" with { type: "json" };
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
	// CI provisions only node (which ships npm) and pnpm, from the root devEngines, so those two are required there;
	// bun and yarn run wherever a developer has them installed.
	managers: process.env.CI ? ["npm", "pnpm"] : ["npm", "pnpm", "bun", "yarn"],
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
 * The catalog plugin's release artifact. A consumer gets `publicHoistPattern`
 * only through this hook's `updateConfig`, so the hoisted workspace loads the
 * built pnpmfile (pnpm's `pnpmfile` setting) instead of writing the setting
 * itself: a hook that stopped delivering the hoist fails here.
 */
const CATALOG_PLUGIN: PackedInstallPreflightOptions = { carrier: "@effected/pnpm-plugin-effected", closure: [] };
const CATALOG_PNPMFILE = `${ROOT}/packages/pnpm-plugin-effected/dist/prod/npm/pkg/pnpmfile.mjs`;

// Module evaluation, before `describe` runs. PackedInstall packs `dist/prod/npm/pkg` (the release
// artifact): with it absent the suite skips locally and FAILS under CI, so it never stops proving the
// published tarballs silently. The release workflow runs `ci:test` before `ci:build`, so the root
// `ci:test` script prod-builds this carrier's closure first. The gate reads `CI` through `Config`.
const GATE = await Effect.runPromise(
	Effect.all([PackedInstall.preflight(RUN), PackedInstall.preflight(CATALOG_PLUGIN)]).pipe(
		Effect.map(([carrier, catalog]) => ({
			ready: carrier.ready && catalog.ready,
			missing: [...carrier.missing, ...catalog.missing],
		})),
		Effect.flatMap(PackedInstall.gate),
		Effect.provide(Live),
	),
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

/**
 * The schema cases, one install shared across them and each case a subdirectory of it. npm and pnpm only: they are the
 * two layouts that decide how the config's import resolves, and the two CI requires. The consumer's own code imports
 * these two, and pnpm links only what a consumer declares.
 */
const SCHEMA_RUN: PackedInstallOptions = {
	...RUN,
	managers: ["npm", "pnpm"],
	consumerDependencies: { "@effected/schemastore": "*", effect: effectPackage.version },
};
/** The MCP server installed alone, with no carrier, so a config cannot reach `@effected/plugin`. */
const MCP_RUN: PackedInstallOptions = { ...SCHEMA_RUN, carrier: "@effected/mcp", bins: ["effected-mcp"] };
const SCHEMA_BUDGET = PackedInstall.timeoutBudget({
	managers: SCHEMA_RUN.managers,
	installTimeout: SCHEMA_RUN.installTimeout,
	packTimeout: SCHEMA_RUN.packTimeout,
	packages: PACKED,
});
const SCHEMA_CASE: Duration.Input = "3 minutes";
// Two more installs than the shared one, which `SCHEMA_CASE` does not allow for.
const MISMATCH_CASE: Duration.Input = "8 minutes";
const vitestGuard = (budget: Duration.Input) => Duration.toMillis(Duration.fromInputUnsafe(budget)) + 60_000;

const FIXTURE = resolve(import.meta.dirname, "fixtures/schema-consumer");
const FIXTURE_FILES = ["schemastore.config.ts", "src/output.ts"];
// A version no release of the package has: not "0.0.0", which the check reads as an unbuilt source run.
const STALE_VERSION = "0.0.1";

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
 * `app` (and the root) can reach it, and the hoist comes only from the
 * catalog plugin's hook when `pnpmfile` names it. With the carrier as a root
 * devDependency instead, `pnpm exec` reaches it from every leaf with or
 * without the hoist, so that layout would prove nothing about the hoist.
 */
const pnpmWorkspace = (
	result: PackedInstallResult,
	consumer: InstalledConsumer,
	name: string,
	pnpmfile: string | undefined,
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
				...(pnpmfile === undefined ? {} : { pnpmfile }),
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
		const scrubbed = consumer.env === undefined ? PackedInstall.scrubEnv(RUN.env) : Redacted.value(consumer.env);
		// The test runs under this monorepo's `pnpm`, whose PATH carries its own `node_modules/.bin`
		// directories, and the carrier's front ends put a workspace `effected` there; `pnpm exec`
		// would find that one from `app` and the control would fail for the wrong reason.
		const env = {
			...scrubbed,
			PATH: (scrubbed.PATH ?? "")
				.split(":")
				.filter((entry) => !entry.startsWith(ROOT))
				.join(":"),
		};
		const pnpm = (args: ReadonlyArray<string>, cwd: string) =>
			Run.collect(ChildProcess.make("pnpm", args, { cwd, env, extendEnv: false, stdin: "ignore" }), {
				timeout: "3 minutes",
			});
		const install = yield* pnpm(["install", "--config.ignore-scripts=true"], directory);
		assert.isTrue(install.succeeded, `${name} install: ${install.stdout}\n${install.stderr}`);
		return yield* pnpm(["exec", "effected", "--version"], `${directory}/packages/app`);
	});

class SchemaInstall extends Context.Service<SchemaInstall, PackedInstallResult>()("test/SchemaInstall") {}
const SchemaLive = Layer.effect(SchemaInstall, PackedInstall.run(SCHEMA_RUN)).pipe(Layer.provideMerge(Live));

class McpInstall extends Context.Service<McpInstall, PackedInstallResult>()("test/McpInstall") {}
const McpLive = Layer.effect(McpInstall, PackedInstall.run(MCP_RUN)).pipe(Layer.provideMerge(Live));

const toolEnv = (result: PackedInstallResult) => ({
	XDG_DATA_HOME: `${result.scratch}/xdg`,
	XDG_STATE_HOME: `${result.scratch}/xdg-state`,
});

/** A copy of the fixture in a subdirectory of the consumer, whose `node_modules` it resolves through. */
const project = (consumer: InstalledConsumer, name: string, config: (source: string) => string = (source) => source) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = `${consumer.directory}/${name}`;
		yield* fs.makeDirectory(`${directory}/src`, { recursive: true });
		for (const file of FIXTURE_FILES) {
			const source = yield* fs.readFileString(`${FIXTURE}/${file}`);
			yield* fs.writeFileString(`${directory}/${file}`, file === "schemastore.config.ts" ? config(source) : source);
		}
		return directory;
	});

const filesUnder = (directory: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const files = new Map<string, string>();
		for (const entry of yield* fs.readDirectory(directory, { recursive: true })) {
			if ((yield* fs.stat(`${directory}/${entry}`)).type === "File") {
				files.set(entry, yield* fs.readFileString(`${directory}/${entry}`));
			}
		}
		return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
	});

/**
 * What the build wrote, byte for byte, against the committed copy. A smoke test for developing the kit, so an `effect`
 * advance that changes the generated output changes this copy. Read what changed first; then regenerate it in place,
 * because the fixture's `outputDir` is `expected`: run `pnpm exec effected schema build` from the fixture's directory.
 */
const assertExpected = (directory: string, label: string) =>
	Effect.gen(function* () {
		const written = yield* filesUnder(`${directory}/expected`);
		const expected = yield* filesUnder(`${FIXTURE}/expected`);
		assert.isAbove(expected.size, 0, "the committed copy holds documents");
		assert.deepStrictEqual([...written.entries()], [...expected.entries()], label);
	});

interface SchemaToolCall {
	readonly result?: {
		readonly isError?: boolean;
		readonly content?: ReadonlyArray<{ readonly text?: string }>;
		readonly structuredContent?: {
			readonly verdict?: string;
			readonly versionMismatch?: {
				readonly tool?: string;
				readonly found?: ReadonlyArray<{ readonly version?: string }>;
			};
		};
	};
}

/** `schema_check` over the installed `effected-mcp`, from `cwd`. */
const schemaCheck = (consumer: InstalledConsumer, cwd: string, env: Record<string, string>) =>
	Effect.gen(function* () {
		const child = yield* McpProcess.spawn(yield* consumer.carrierCommand("effected-mcp", [], { env, cwd }));
		yield* child.handshake();
		yield* child.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "schema_check", arguments: {} } });
		const called = (yield* child.readUntilResponse(2)).response as SchemaToolCall;
		yield* child.closeStdin;
		return { result: called.result, exitCode: yield* child.exitCode, stderr: yield* child.stderrFinal };
	}).pipe(Effect.scoped, Effect.timeout("1 minute"));

/**
 * The partial bump as a consumer's tree holds it: the tool on its own `@effected/schemastore`, and beside it the one the
 * consumer declares, at another version. The stale copy is the real tarball with its version and its stamp rewritten.
 */
const staleSchemastore = (result: PackedInstallResult) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = `${result.scratch}/stale-schemastore`;
		const tarball = result.tarballs["@effected/schemastore"];
		assert.isDefined(tarball, "@effected/schemastore was packed");
		const tar = (args: ReadonlyArray<string>) =>
			Run.collect(ChildProcess.make("tar", args, { stdin: "ignore" }), { timeout: "30 seconds" }).pipe(
				Effect.tap((output) => Effect.sync(() => assert.isTrue(output.succeeded, output.stderr))),
			);
		yield* fs.makeDirectory(directory, { recursive: true });
		yield* tar(["-xzf", `${tarball}`, "-C", directory]);
		const manifestPath = `${directory}/package/package.json`;
		const manifest = JSON.parse(yield* fs.readFileString(manifestPath)) as { readonly version: string };
		yield* fs.writeFileString(manifestPath, JSON.stringify({ ...manifest, version: STALE_VERSION }));
		const stampPath = `${directory}/package/internal/version.js`;
		const stamp = yield* fs.readFileString(stampPath);
		assert.include(stamp, `"${manifest.version}"`, "the built stamp is a literal this can rewrite");
		yield* fs.writeFileString(stampPath, stamp.replaceAll(`"${manifest.version}"`, `"${STALE_VERSION}"`));
		const stale = `${result.scratch}/stale-schemastore.tgz`;
		yield* tar(["-czf", stale, "-C", directory, "package"]);
		return { stale, tool: manifest.version };
	});

/**
 * A consumer whose direct `@effected/schemastore` is the stale tarball while the carrier and the engine keep the real
 * one, so the override for the package is scoped to those two. npm and pnpm both spell that, and the case runs under each.
 */
const mismatchedConsumer = (result: PackedInstallResult, consumer: InstalledConsumer, stale: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = `${result.scratch}/mismatched-${consumer.manager}`;
		const file = (pkg: string) => `file:${result.tarballs[pkg]}`;
		const rest = Object.keys(result.tarballs).filter(
			(pkg) => pkg !== CARRIER && pkg !== "@effected/schemastore" && pkg !== "@effected/engine",
		);
		const flat = Object.fromEntries(rest.map((pkg) => [pkg, file(pkg)]));
		const real = file("@effected/schemastore");
		const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
		const dependencies = {
			[CARRIER]: file(CARRIER),
			"@effected/schemastore": `file:${stale}`,
			effect: effectPackage.version,
		};
		yield* fs.makeDirectory(directory, { recursive: true });
		if (consumer.manager === "pnpm") {
			yield* fs.writeFileString(
				`${directory}/package.json`,
				json({
					name: "mismatched",
					version: "0.0.0",
					private: true,
					devEngines: { packageManager: { name: "pnpm", version: consumer.managerVersion, onFail: "ignore" } },
					dependencies,
				}),
			);
			// JSON is valid YAML.
			yield* fs.writeFileString(
				`${directory}/pnpm-workspace.yaml`,
				json({
					minimumReleaseAge: 0,
					overrides: {
						...flat,
						"@effected/engine": file("@effected/engine"),
						[`${CARRIER}>@effected/schemastore`]: real,
						"@effected/engine>@effected/schemastore": real,
					},
				}),
			);
		} else {
			yield* fs.writeFileString(
				`${directory}/package.json`,
				json({
					name: "mismatched",
					version: "0.0.0",
					private: true,
					packageManager: `npm@${consumer.managerVersion}`,
					dependencies,
					overrides: {
						...flat,
						"@effected/engine": { ".": file("@effected/engine"), "@effected/schemastore": real },
						[CARRIER]: { "@effected/schemastore": real },
					},
				}),
			);
		}
		const args =
			consumer.manager === "pnpm"
				? ["install", "--config.ignore-scripts=true"]
				: ["install", "--ignore-scripts", "--no-audit", "--no-fund"];
		const env = consumer.env === undefined ? PackedInstall.scrubEnv(RUN.env) : Redacted.value(consumer.env);
		const install = yield* Run.collect(
			ChildProcess.make(consumer.manager, args, { cwd: directory, env, extendEnv: false, stdin: "ignore" }),
			{ timeout: "3 minutes" },
		);
		assert.isTrue(install.succeeded, `${consumer.manager} install: ${install.stdout}\n${install.stderr}`);
		return InstalledConsumer.make({ ...consumer, directory });
	});

describe.runIf(GATE.action === "fail")("packed install (@effected/plugin) prod build", () => {
	it("dist/prod exists (run `pnpm build --filter @effected/plugin... --filter @effected/pnpm-plugin-effected` before the tests)", () => {
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
							["identity", "schema_check", "schema_build", "schema_validate", "package_build"],
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

					// The hoist, as a consumer gets it from the catalog plugin's hook: a pnpm workspace whose
					// leaf carries the carrier, run from a sibling leaf.
					const pnpm = result.consumers.find((consumer) => consumer.manager === "pnpm");
					if (pnpm === undefined) {
						yield* Effect.log("pnpm unavailable: the workspace hoist was not proven");
						return;
					}
					const hoisted = yield* pnpmWorkspace(result, pnpm, "workspace-hoisted", CATALOG_PNPMFILE);
					assert.strictEqual(hoisted.exitCode, 0, `hoisted: ${hoisted.stderr}`);
					assert.strictEqual(VERSION.exec(hoisted.stdout.trim())?.[1], manifest.version, hoisted.stdout);
					// Control: the same workspace without the hook cannot reach the bin from `app`.
					const unhoisted = yield* pnpmWorkspace(result, pnpm, "workspace-unhoisted", undefined);
					assert.notStrictEqual(unhoisted.exitCode, 0, `unhoisted unexpectedly ran: ${unhoisted.stdout}`);
					assert.include(unhoisted.stderr, 'Command "effected" not found', unhoisted.stderr);
				}).pipe(Effect.scoped, Effect.timeout(BUDGET)),
			// vitest's own guard a minute above the Effect's, so a named PackedInstallError fires first.
			Duration.toMillis(BUDGET) + 60_000,
		);
	});

	layer(SchemaLive, { excludeTestServices: true, timeout: SCHEMA_BUDGET })((it) => {
		for (const manager of SCHEMA_RUN.managers) {
			it.effect(
				`${manager} consumer: effected schema build writes the expected documents`,
				() =>
					Effect.gen(function* () {
						const result = yield* SchemaInstall;
						assert.isAbove(result.consumers.length, 0);
						const consumer = result.consumers.find((candidate) => candidate.manager === manager);
						if (consumer === undefined) {
							yield* Effect.log(`${manager} unavailable: not proven here; CI requires it`);
							return;
						}
						const cwd = yield* project(consumer, "build");
						const built = yield* consumer.runCarrierBin("effected", ["schema", "build"], {
							env: toolEnv(result),
							cwd,
						});
						assert.strictEqual(built.exitCode, 0, `${built.stdout}\n${built.stderr}`);
						yield* assertExpected(cwd, manager);
					}).pipe(Effect.timeout(SCHEMA_CASE)),
				vitestGuard(SCHEMA_CASE),
			);
		}

		it.effect(
			"the fixture's HostedSchema from its own @effected/schemastore passes the check",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const result = yield* SchemaInstall;
					assert.isAbove(result.consumers.length, 0);
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						const cwd = yield* project(consumer, "hosted");
						const options = { env: toolEnv(result), cwd };
						const built = yield* consumer.runCarrierBin("effected", ["schema", "build"], options);
						assert.strictEqual(built.exitCode, 0, `${label}: ${built.stdout}\n${built.stderr}`);
						const checked = yield* consumer.runCarrierBin("effected", ["schema", "check"], options);
						assert.strictEqual(checked.exitCode, 0, `${label}: ${checked.stdout}\n${checked.stderr}`);

						// The consumer's runtime code, on the same copy, writes the payload the document validates.
						const env = consumer.env === undefined ? PackedInstall.scrubEnv(RUN.env) : Redacted.value(consumer.env);
						const payload = yield* Run.text(
							ChildProcess.make(process.execPath, ["src/output.ts"], { cwd, env, extendEnv: false, stdin: "ignore" }),
							{ timeout: "30 seconds" },
						);
						yield* fs.writeFileString(`${cwd}/payload.json`, payload);
						const validated = yield* consumer.runCarrierBin(
							"effected",
							["schema", "validate", "payload.json"],
							options,
						);
						assert.strictEqual(validated.exitCode, 0, `${label}: ${validated.stdout}\n${validated.stderr}`);
					}
				}).pipe(Effect.timeout(SCHEMA_CASE)),
			vitestGuard(SCHEMA_CASE),
		);

		it.effect(
			"effected schema check exits 0 after a build, and 1 after a document is edited",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const result = yield* SchemaInstall;
					assert.isAbove(result.consumers.length, 0);
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						const cwd = yield* project(consumer, "edited");
						const options = { env: toolEnv(result), cwd };
						const built = yield* consumer.runCarrierBin("effected", ["schema", "build"], options);
						assert.strictEqual(built.exitCode, 0, `${label}: ${built.stdout}\n${built.stderr}`);
						const clean = yield* consumer.runCarrierBin("effected", ["schema", "check"], options);
						assert.strictEqual(clean.exitCode, 0, `${label}: ${clean.stdout}\n${clean.stderr}`);

						const document = `${cwd}/expected/1.0/output-1.0.json`;
						const text = yield* fs.readFileString(document);
						const edited = text.replace('"additionalProperties": false', '"additionalProperties": true');
						assert.notStrictEqual(edited, text, "the edit changed the document");
						yield* fs.writeFileString(document, edited);
						const dirty = yield* consumer.runCarrierBin("effected", ["schema", "check"], options);
						assert.strictEqual(dirty.exitCode, 1, `${label}: ${dirty.stdout}\n${dirty.stderr}`);
					}
				}).pipe(Effect.timeout(SCHEMA_CASE)),
			vitestGuard(SCHEMA_CASE),
		);

		it.effect(
			"a mismatched schemastore: CLI exits 2, --ignore-version-mismatch proceeds, MCP warns",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const result = yield* SchemaInstall;
					assert.isAbove(result.consumers.length, 0);
					const { stale, tool } = yield* staleSchemastore(result);
					for (const installed of result.consumers) {
						const label = installed.manager;
						const consumer = yield* mismatchedConsumer(result, installed, stale);
						const cwd = yield* project(consumer, "mismatch");
						const env = toolEnv(result);
						const options = { env, cwd };

						const refused = yield* consumer.runCarrierBin("effected", ["schema", "build"], options);
						const refusal = `${refused.stdout}\n${refused.stderr}`;
						assert.strictEqual(refused.exitCode, 2, `${label}: ${refusal}`);
						assert.include(refusal, tool, label);
						assert.include(refusal, STALE_VERSION, label);
						assert.isFalse(yield* fs.exists(`${cwd}/expected`), `${label}: a refused run writes nothing`);

						const warned = yield* consumer.runCarrierBin(
							"effected",
							["schema", "build", "--ignore-version-mismatch"],
							options,
						);
						const warning = `${warned.stdout}\n${warned.stderr}`;
						assert.strictEqual(warned.exitCode, 0, `${label}: ${warning}`);
						assert.include(warning, tool, label);
						assert.include(warning, STALE_VERSION, label);
						yield* assertExpected(cwd, label);

						const session = yield* schemaCheck(consumer, cwd, env);
						assert.notStrictEqual(session.result?.isError, true, `${label}: ${JSON.stringify(session.result)}`);
						const mismatch = session.result?.structuredContent?.versionMismatch;
						assert.strictEqual(mismatch?.tool, tool, label);
						assert.deepStrictEqual(
							mismatch?.found?.map((found) => found.version),
							[STALE_VERSION],
							label,
						);
						assert.strictEqual(session.exitCode, 0, `${label}: ${session.stderr}`);
					}
				}).pipe(Effect.timeout(MISMATCH_CASE)),
			vitestGuard(MISMATCH_CASE),
		);
	});

	layer(McpLive, { excludeTestServices: true, timeout: SCHEMA_BUDGET })((it) => {
		it.effect(
			"@effected/mcp installed alone serves schema_check for a config importing @effected/schemastore",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const result = yield* McpInstall;
					assert.isAbove(result.consumers.length, 0);
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						assert.isFalse(yield* fs.exists(`${consumer.directory}/node_modules/@effected/plugin`), label);
						const cwd = yield* project(consumer, "alone", (source) => {
							const rewritten = source.replace(
								'import { defineSchemastore } from "@effected/plugin";',
								'import { defineConfig as defineSchemastore } from "@effected/schemastore";',
							);
							assert.notStrictEqual(rewritten, source, "the config's import was rewritten");
							return rewritten;
						});
						const session = yield* schemaCheck(consumer, cwd, toolEnv(result));
						assert.notStrictEqual(session.result?.isError, true, `${label}: ${JSON.stringify(session.result)}`);
						assert.strictEqual(session.result?.structuredContent?.verdict, "stale", label);
						assert.isUndefined(session.result?.structuredContent?.versionMismatch, label);
						assert.strictEqual(session.exitCode, 0, `${label}: ${session.stderr}`);
					}
				}).pipe(Effect.timeout(SCHEMA_CASE)),
			vitestGuard(SCHEMA_CASE),
		);

		it.effect(
			"a config importing @effected/plugin with only @effected/mcp installed gets the install line",
			() =>
				Effect.gen(function* () {
					const result = yield* McpInstall;
					assert.isAbove(result.consumers.length, 0);
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						const cwd = yield* project(consumer, "no-carrier");
						const session = yield* schemaCheck(consumer, cwd, toolEnv(result));
						assert.isTrue(session.result?.isError, `${label}: ${JSON.stringify(session.result)}`);
						assert.isUndefined(session.result?.structuredContent, label);
						assert.include(session.result?.content?.[0]?.text ?? "", "pnpm add -D @effected/plugin", label);
						assert.strictEqual(session.exitCode, 0, `${label}: ${session.stderr}`);
					}
				}).pipe(Effect.timeout(SCHEMA_CASE)),
			vitestGuard(SCHEMA_CASE),
		);
	});
});
