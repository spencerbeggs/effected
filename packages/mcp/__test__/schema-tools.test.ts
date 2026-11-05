import { assert, describe, it } from "@effect/vitest";
import { McpHarness } from "@effected/mcp-kit/testing";
import type { MemoryFileSystemFaultsFactory, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { SchemastoreConfig } from "@effected/schemastore";
import { StoreDocument, defineConfig } from "@effected/schemastore";
import { Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { McpProtocol } from "effect/ai";
import { ServerLayer } from "../src/server.js";

const BASE = "https://example.com/schemas";
const STAMP = Symbol.for("@effected/schemastore/version");
const ROOT = "/repo";
const CONFIG_PATH = "/repo/schemastore.config.ts";
const DOC_PATH = "/repo/schemas/app.json";
const DOC_ID = `${BASE}/app.json`;

const Fixture = Schema.Struct({ name: Schema.String });
const Changed = Schema.Struct({ name: Schema.String, host: Schema.optionalKey(Schema.String) });

const configOf = (schema: Schema.Constraint): SchemastoreConfig =>
	defineConfig({ name: "test", outputDir: "schemas", baseUrl: BASE, schemas: { app: { schema } } });

const emitted = (schema: Schema.Constraint): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id: DOC_ID })).serializeResult());

const stamped = (config: SchemastoreConfig, version: string): SchemastoreConfig =>
	// The spread keeps the brand and drops `defineConfig`'s own stamp, which is non-enumerable and fixed.
	Object.defineProperty({ ...config }, STAMP, { value: version });

interface ToolResult {
	readonly isError?: boolean;
	readonly structuredContent?: Record<string, unknown>;
	readonly content?: ReadonlyArray<{ readonly text?: string }>;
}

interface RunResult {
	readonly verdict: string;
	readonly versionMismatch?: { readonly message: string };
	readonly report: {
		readonly schemas: ReadonlyArray<{
			readonly diff?: {
				readonly hunks: ReadonlyArray<{ readonly lines: ReadonlyArray<unknown> }>;
				readonly unified: string;
			};
		}>;
	};
}

const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;
const runOf = (result: ToolResult): RunResult => result.structuredContent as unknown as RunResult;
const textOf = (result: ToolResult): string => result.content?.map((part) => part.text ?? "").join("") ?? "";

interface ServeOptions {
	readonly seed?: MemoryFileSystemSeed;
	readonly config?: unknown;
	readonly cwd?: string;
	readonly strictStdout?: boolean;
	readonly importModule?: (path: string) => Promise<unknown>;
	readonly faults?: MemoryFileSystemFaultsFactory;
}

// One volume, built once and handed to the server through `services`, so the test reads back what the tools wrote.
const serve = (options: ServeOptions = {}) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(
			options.seed ?? { [`${ROOT}/pnpm-workspace.yaml`]: "", [CONFIG_PATH]: "" },
			options.faults !== undefined ? { faults: options.faults } : {},
		);
		const services = yield* Layer.build(handle.layer);
		const loads: Array<string> = [];
		const harness = yield* McpHarness.make(
			ServerLayer({
				cwd: options.cwd ?? ROOT,
				importModule:
					options.importModule ??
					((path) => {
						loads.push(path);
						return Promise.resolve({ default: options.config ?? configOf(Fixture) });
					}),
			}),
			{ services, ...(options.strictStdout !== undefined ? { strictStdout: options.strictStdout } : {}) },
		);
		yield* harness.initialize;
		return { harness, volume: handle.volume, loads };
	});

describe("schema tools", () => {
	it.effect("tools/list declares each tool's output schema", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve();
			const tools = yield* harness.listTools;
			assert.deepStrictEqual(tools.map((tool) => tool.name).sort(), [
				"identity",
				"schema_build",
				"schema_check",
				"schema_validate",
			]);
			for (const [name, field] of [
				["schema_check", "verdict"],
				["schema_build", "verdict"],
				["schema_validate", "valid"],
			] as const) {
				const tool = tools.find((candidate) => candidate.name === name) as unknown as {
					readonly outputSchema?: unknown;
				};
				assert.include(JSON.stringify(tool.outputSchema ?? {}), `"${field}"`, name);
			}
		}).pipe(Effect.scoped),
	);

	it.effect("schema_check on stale input returns verdict 'stale' with a diff, is not isError, and writes nothing", () =>
		Effect.gen(function* () {
			const before = emitted(Fixture);
			const { harness, volume } = yield* serve({
				seed: { [`${ROOT}/pnpm-workspace.yaml`]: "", [CONFIG_PATH]: "", [DOC_PATH]: before },
				config: configOf(Changed),
			});
			const result = resultOf(yield* harness.callTool("schema_check", {}));
			assert.strictEqual(result.isError ?? false, false);
			const run = runOf(result);
			assert.strictEqual(run.verdict, "stale");
			assert.include(run.report.schemas[0]?.diff?.unified ?? "", '"host"');
			assert.strictEqual(volume.text(DOC_PATH), before);
			assert.deepStrictEqual(
				volume.paths().filter((path) => path.startsWith("/repo/schemas/catalog")),
				[],
			);
		}).pipe(Effect.scoped),
	);

	it.effect("schema_build writes, and a second schema_check is 'ok'", () =>
		Effect.gen(function* () {
			const { harness, volume } = yield* serve();
			const built = resultOf(yield* harness.callTool("schema_build", {}));
			assert.strictEqual(built.isError ?? false, false);
			assert.strictEqual(runOf(built).verdict, "ok");
			assert.strictEqual(volume.text(DOC_PATH), emitted(Fixture));
			const checked = resultOf(yield* harness.callTool("schema_check", {}));
			assert.strictEqual(runOf(checked).verdict, "ok");
		}).pipe(Effect.scoped),
	);

	it.effect("schema_check and schema_validate are annotated read-only; schema_build isn't", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve();
			const tools = (yield* harness.listTools) as unknown as ReadonlyArray<{
				readonly name: string;
				readonly annotations?: { readonly readOnlyHint?: boolean };
			}>;
			const hint = (name: string) => tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint;
			assert.strictEqual(hint("schema_check"), true);
			assert.strictEqual(hint("schema_validate"), true);
			assert.strictEqual(hint("schema_build"), false);
		}).pipe(Effect.scoped),
	);

	it.effect("a drift result carries the full diff, uncapped", () =>
		Effect.gen(function* () {
			const fields = (prefix: string) =>
				Object.fromEntries(Array.from({ length: 800 }, (_, index) => [`${prefix}${index}`, Schema.String]));
			const { harness } = yield* serve({
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					[CONFIG_PATH]: "",
					[DOC_PATH]: emitted(Schema.Struct(fields("old"))),
				},
				config: defineConfig({
					name: "test",
					outputDir: "schemas",
					baseUrl: BASE,
					schemas: { app: { schema: Schema.Struct(fields("new")), published: true } },
				}),
			});
			const run = runOf(resultOf(yield* harness.callTool("schema_check", {})));
			assert.strictEqual(run.verdict, "drift");
			const unified = run.report.schemas[0]?.diff?.unified ?? "";
			assert.include(unified, '"old0"');
			assert.include(unified, '"new799"');
			const lines = run.report.schemas[0]?.diff?.hunks.flatMap((hunk) => hunk.lines) ?? [];
			assert.isAbove(lines.length, 1600);
		}).pipe(Effect.scoped),
	);

	it.effect("schema_validate returns valid false with located findings", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					[CONFIG_PATH]: "",
					[DOC_PATH]: emitted(Fixture),
					"/repo/data.json": `{\n\t"$schema": "${DOC_ID}",\n\t"name": 1\n}\n`,
				},
			});
			const result = resultOf(yield* harness.callTool("schema_validate", { payload: "data.json" }));
			assert.strictEqual(result.isError ?? false, false);
			const report = result.structuredContent as {
				readonly valid: boolean;
				readonly $ref: string;
				readonly findings: ReadonlyArray<{ readonly location?: { readonly line: number } }>;
			};
			assert.isFalse(report.valid);
			assert.strictEqual(report.$ref, DOC_ID);
			assert.strictEqual(report.findings[0]?.location?.line, 3);
		}).pipe(Effect.scoped),
	);

	it.effect("schema_validate takes a file-valued schema relative to the root, loading no config", () =>
		Effect.gen(function* () {
			const { harness, loads } = yield* serve({
				cwd: "/repo/packages/a",
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					"/repo/packages/a/.keep": "",
					[DOC_PATH]: emitted(Fixture),
					"/repo/data.json": '{ "name": "x" }',
				},
			});
			const result = resultOf(
				yield* harness.callTool("schema_validate", { payload: "data.json", schema: "schemas/app.json" }),
			);
			assert.strictEqual((result.structuredContent as { readonly valid: boolean }).valid, true);
			assert.deepStrictEqual(loads, []);
		}).pipe(Effect.scoped),
	);

	it.effect("a missing config is isError with a remediation", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({ seed: { [`${ROOT}/pnpm-workspace.yaml`]: "" } });
			for (const [tool, args] of [
				["schema_check", {}],
				["schema_build", {}],
				["schema_check", { config: "nope.config.ts" }],
			] as const) {
				const result = resultOf(yield* harness.callTool(tool, args));
				assert.isTrue(result.isError);
				assert.include(textOf(result), "No schemastore config found");
				assert.include(textOf(result), "schemastore.config.ts, or pass config");
			}
		}).pipe(Effect.scoped),
	);

	it.effect("a config that fails to load passes its reason through, the install line in it, and not its stack", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({
				importModule: () => Promise.reject(new Error("Cannot find module '@effected/plugin/schemastore'")),
			});
			const result = resultOf(yield* harness.callTool("schema_build", {}));
			assert.isTrue(result.isError);
			assert.include(textOf(result), "pnpm add -D @effected/plugin");
			assert.notInclude(textOf(result), "schema-tools.test.ts");
		}).pipe(Effect.scoped),
	);

	it.effect("force beside another drift is refused", () =>
		Effect.gen(function* () {
			const { harness, volume } = yield* serve();
			const result = resultOf(yield* harness.callTool("schema_build", { force: true, drift: "strict" }));
			assert.isTrue(result.isError);
			assert.include(textOf(result), "force");
			assert.isFalse(volume.has(DOC_PATH));
		}).pipe(Effect.scoped),
	);

	it.effect("a config path outside the root is refused, before it loads", () =>
		Effect.gen(function* () {
			const { harness, loads } = yield* serve({
				seed: { [`${ROOT}/pnpm-workspace.yaml`]: "", "/elsewhere/schemastore.config.ts": "" },
			});
			for (const config of ["/elsewhere/schemastore.config.ts", "../elsewhere/schemastore.config.ts"]) {
				for (const [tool, args] of [
					["schema_check", { config }],
					["schema_build", { config }],
					["schema_validate", { config, payload: "x.json", schema: DOC_ID }],
				] as const) {
					const result = resultOf(yield* harness.callTool(tool, args));
					assert.isTrue(result.isError, tool);
					assert.include(textOf(result), "outside the workspace root");
				}
			}
			assert.deepStrictEqual(loads, []);
		}).pipe(Effect.scoped),
	);

	it.effect("a relative config resolves against the root, not the server's directory", () =>
		Effect.gen(function* () {
			const { harness, loads } = yield* serve({
				cwd: "/repo/packages/a",
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					"/repo/packages/a/.keep": "",
					"/repo/lib/schemastore.config.ts": "",
				},
			});
			const result = resultOf(yield* harness.callTool("schema_check", { config: "lib/schemastore.config.ts" }));
			assert.strictEqual(result.isError ?? false, false);
			assert.deepStrictEqual(loads, ["/repo/lib/schemastore.config.ts"]);
		}).pipe(Effect.scoped),
	);

	it.effect("with no config given, discovery starts at the server's directory", () =>
		Effect.gen(function* () {
			const { harness, loads } = yield* serve({
				cwd: "/repo/packages/a",
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					[CONFIG_PATH]: "",
					"/repo/packages/a/schemastore.config.ts": "",
				},
			});
			yield* harness.callTool("schema_check", {});
			assert.deepStrictEqual(loads, ["/repo/packages/a/schemastore.config.ts"]);
		}).pipe(Effect.scoped),
	);

	it.effect("the root is the pnpm workspace, otherwise .git, otherwise the server's directory", () =>
		Effect.gen(function* () {
			const refused = (seed: MemoryFileSystemSeed, cwd: string, payload: string) =>
				Effect.gen(function* () {
					const { harness } = yield* serve({ seed, cwd });
					const result = resultOf(yield* harness.callTool("schema_validate", { payload }));
					return textOf(result).includes("outside the workspace root");
				});
			// A nearer `.git` does not beat the workspace.
			const both = { "/a/pnpm-workspace.yaml": "", "/a/b/.git/HEAD": "", "/a/b/c/.keep": "" };
			assert.isFalse(yield* refused(both, "/a/b/c", "/a/x.json"));
			assert.isTrue(yield* refused(both, "/a/b/c", "/x.json"));
			const git = { "/a/b/.git/HEAD": "", "/a/b/c/.keep": "" };
			assert.isFalse(yield* refused(git, "/a/b/c", "/a/b/x.json"));
			assert.isTrue(yield* refused(git, "/a/b/c", "/a/x.json"));
			const none = { "/a/b/c/.keep": "" };
			assert.isFalse(yield* refused(none, "/a/b/c", "/a/b/c/x.json"));
			assert.isTrue(yield* refused(none, "/a/b/c", "/a/b/x.json"));
		}).pipe(Effect.scoped),
	);

	it.effect("a payload path escaping through .. is refused, and a symlinked root still works", () =>
		Effect.gen(function* () {
			const seed: MemoryFileSystemSeed = {
				"/real/repo/pnpm-workspace.yaml": "",
				"/real/repo/schemas/app.json": emitted(Fixture),
				"/real/repo/data.json": '{ "name": "x" }',
				"/real/secret.json": "{}",
				"/link": MemoryFileSystem.symlink("/real/repo"),
				"/real/repo/out": MemoryFileSystem.symlink("/real"),
			};
			const { harness } = yield* serve({ seed, cwd: "/link" });
			const ok = resultOf(
				yield* harness.callTool("schema_validate", { payload: "data.json", schema: "schemas/app.json" }),
			);
			assert.strictEqual((ok.structuredContent as { readonly valid: boolean }).valid, true);
			for (const args of [
				{ payload: "../secret.json", schema: "schemas/app.json" },
				{ payload: "out/secret.json", schema: "schemas/app.json" },
				{ payload: "/real/secret.json", schema: "schemas/app.json" },
				{ payload: "data.json", schema: "../secret.json" },
				{ payload: "data.json", schema: "out/secret.json" },
				// Looks like a URL, but the engine resolves it as a path first, to /real/secret.json.
				{ payload: "data.json", schema: "https:/../../secret.json" },
			]) {
				const result = resultOf(yield* harness.callTool("schema_validate", args));
				assert.isTrue(result.isError, JSON.stringify(args));
				assert.include(textOf(result), "outside the workspace root", JSON.stringify(args));
			}
		}).pipe(Effect.scoped),
	);

	it.effect("a payload's own $schema is held to the root too, with a BOM in front of it", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					"/secret.json": "{}",
					"/repo/plain.json": '{ "$schema": "../secret.json" }',
					"/repo/bom.json": `${String.fromCharCode(0xfeff)}{ "$schema": "../secret.json" }`,
				},
			});
			for (const payload of ["plain.json", "bom.json"]) {
				const result = resultOf(yield* harness.callTool("schema_validate", { payload }));
				assert.isTrue(result.isError, payload);
				assert.include(textOf(result), "outside the workspace root", payload);
			}
		}).pipe(Effect.scoped),
	);

	it.effect("a payload with no $schema and no schema is refused with what to pass", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({
				seed: { [`${ROOT}/pnpm-workspace.yaml`]: "", "/repo/data.json": "{}" },
			});
			const result = resultOf(yield* harness.callTool("schema_validate", { payload: "data.json" }));
			assert.isTrue(result.isError);
			assert.include(textOf(result), "schema parameter");
			assert.notInclude(textOf(result), "--schema");
		}).pipe(Effect.scoped),
	);

	it.effect("a config writing outside the root still builds", () =>
		Effect.gen(function* () {
			const { harness, volume } = yield* serve({
				cwd: "/a/b/repo",
				seed: { "/a/b/repo/pnpm-workspace.yaml": "", "/a/b/repo/schemastore.config.ts": "" },
				config: defineConfig({
					name: "test",
					outputDir: "../../schemas",
					baseUrl: BASE,
					schemas: { app: { schema: Fixture } },
				}),
			});
			const result = resultOf(yield* harness.callTool("schema_build", {}));
			assert.strictEqual(result.isError ?? false, false);
			assert.strictEqual(runOf(result).verdict, "ok");
			assert.isTrue(volume.has("/a/schemas/app.json"));
		}).pipe(Effect.scoped),
	);

	it.effect("a version mismatch returns the warning in the result and still runs", () =>
		Effect.gen(function* () {
			const { harness, volume } = yield* serve({ config: stamped(configOf(Fixture), "9.9.9") });
			const built = resultOf(yield* harness.callTool("schema_build", {}));
			assert.strictEqual(built.isError ?? false, false);
			assert.include(runOf(built).versionMismatch?.message ?? "", "9.9.9");
			assert.isTrue(volume.has(DOC_PATH));
			const checked = resultOf(yield* harness.callTool("schema_check", {}));
			assert.include(runOf(checked).versionMismatch?.message ?? "", "9.9.9");
		}).pipe(Effect.scoped),
	);

	it.effect("a refusal after a warned mismatch carries the warning", () =>
		Effect.gen(function* () {
			const frozenMissing = defineConfig({
				name: "test",
				outputDir: "schemas",
				baseUrl: BASE,
				schemas: { app: { schema: Fixture, layout: "flat", versions: ["0.9", "1.0"] } },
			});
			const { harness } = yield* serve({ config: stamped(frozenMissing, "9.9.9") });
			const built = resultOf(yield* harness.callTool("schema_build", {}));
			assert.isTrue(built.isError);
			assert.include(textOf(built), "9.9.9");

			const unresolved = yield* serve({
				config: stamped(configOf(Fixture), "9.9.9"),
				seed: { [`${ROOT}/pnpm-workspace.yaml`]: "", [CONFIG_PATH]: "", "/repo/data.json": "{}" },
			});
			const validated = resultOf(
				yield* unresolved.harness.callTool("schema_validate", {
					payload: "data.json",
					schema: "https://example.com/unknown.json",
				}),
			);
			assert.isTrue(validated.isError);
			assert.include(textOf(validated), "9.9.9");
		}).pipe(Effect.scoped),
	);

	it.effect("concurrent schema_build calls leave the documents intact", () =>
		Effect.gen(function* () {
			const { harness, volume } = yield* serve();
			const results = yield* Effect.all([harness.callTool("schema_build", {}), harness.callTool("schema_build", {})], {
				concurrency: "unbounded",
			});
			for (const response of results) {
				const result = resultOf(response);
				assert.strictEqual(result.isError ?? false, false);
				assert.strictEqual(runOf(result).verdict, "ok");
			}
			const text = volume.text(DOC_PATH);
			assert.strictEqual(text, emitted(Fixture));
			assert.doesNotThrow(() => JSON.parse(text ?? ""));
		}).pipe(Effect.scoped),
	);

	// A real write truncates, then writes, with a turn of the event loop between. Without the lane, a check here answers
	// from the torn document: "stale", about a tree a build is finishing.
	it.live("a check waits for a build holding a torn document", () =>
		Effect.gen(function* () {
			const torn = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			let tore = false;
			const { harness } = yield* serve({
				faults: (base) => ({
					writeFileString: (path, text) => {
						if (path !== DOC_PATH || tore) return undefined;
						tore = true;
						return Effect.gen(function* () {
							yield* base.writeFileString(path, "");
							yield* Deferred.succeed(torn, undefined);
							yield* Deferred.await(release);
							return yield* base.writeFileString(path, text);
						});
					},
				}),
			});
			const build = yield* Effect.forkChild(harness.callTool("schema_build", {}));
			yield* Deferred.await(torn);
			const check = yield* Effect.forkChild(harness.callTool("schema_check", {}));
			yield* Effect.sleep("300 millis");
			yield* Deferred.succeed(release, undefined);
			assert.strictEqual(runOf(resultOf(yield* Fiber.join(build))).verdict, "ok");
			assert.strictEqual(runOf(resultOf(yield* Fiber.join(check))).verdict, "ok");
		}).pipe(Effect.scoped),
	);

	it.effect("a config still loading holds up no other call", () =>
		Effect.gen(function* () {
			const hung = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			let loads = 0;
			const { harness } = yield* serve({
				importModule: () => {
					loads += 1;
					return loads > 1
						? Promise.resolve({ default: configOf(Fixture) })
						: Effect.runPromise(
								Deferred.succeed(hung, undefined).pipe(
									Effect.andThen(Deferred.await(release)),
									Effect.as({ default: configOf(Fixture) }),
								),
							);
				},
			});
			const slow = yield* Effect.forkChild(harness.callTool("schema_check", {}));
			yield* Deferred.await(hung);
			const fast = resultOf(yield* harness.callTool("schema_check", {}));
			assert.strictEqual(runOf(fast).verdict, "stale");
			yield* Deferred.succeed(release, undefined);
			assert.strictEqual(runOf(resultOf(yield* Fiber.join(slow))).verdict, "stale");
		}).pipe(Effect.scoped),
	);

	it.effect("the tool list carries a cache hint on the stateless revision", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ [`${ROOT}/pnpm-workspace.yaml`]: "" });
			const services = yield* Layer.build(handle.layer);
			const harness = yield* McpHarness.make(ServerLayer({ cwd: ROOT }), {
				services,
				protocol: McpProtocol.v2026_07_28,
			});
			const response = yield* harness.request("tools/list", {});
			const { ttlMs } = response.result as { readonly ttlMs?: number };
			assert.strictEqual(ttlMs, 3_600_000);
		}).pipe(Effect.scoped),
	);

	it.effect("nothing reaches stdout outside the protocol", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({
				strictStdout: true,
				seed: {
					[`${ROOT}/pnpm-workspace.yaml`]: "",
					[CONFIG_PATH]: "",
					"/repo/data.json": `{ "$schema": "${DOC_ID}", "name": "x" }`,
				},
			});
			yield* harness.callTool("schema_build", {});
			yield* harness.callTool("schema_check", {});
			yield* harness.callTool("schema_validate", { payload: "data.json" });
			yield* harness.callTool("schema_check", { config: "/elsewhere.ts" });
			assert.deepStrictEqual(yield* harness.consoleLogSoFar, []);
		}).pipe(Effect.scoped),
	);
});
