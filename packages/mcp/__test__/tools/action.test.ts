// `action_build` in process, over real temporary directories because rolldown bundles on the real disk.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { McpHarness } from "@effected/mcp-kit/testing";
import { Effect, Layer } from "effect";
import { SERVER_INSTRUCTIONS, ServerLayer } from "../../src/server.js";
import { actionBuild } from "../../src/tools/action.js";

const GOOD: Readonly<Record<string, string>> = {
	"package.json": JSON.stringify({ name: "action", version: "1.0.0" }),
	"effected.toml": '[action.entries]\nmain = "src/main.ts"\n',
	"action.yml":
		"name: test\ndescription: d\nruns:\n  using: node24\n  main: dist/main.js\nbranding:\n  icon: zap\n  color: blue\n",
	"src/main.ts": 'console.log("main");\n',
};

/** Every file under `directory` with its content, so a before and after comparison sees any write. */
const treeOf = (directory: string): Readonly<Record<string, string>> =>
	Object.fromEntries(
		readdirSync(directory, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const full = join(entry.parentPath, entry.name);
				return [full.slice(directory.length + 1), readFileSync(full, "utf8")];
			})
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	);

interface ToolResult {
	readonly isError?: boolean;
	readonly structuredContent?: {
		readonly verdict?: string;
		readonly result?: {
			readonly drift?: ReadonlyArray<{ readonly target?: string; readonly kind?: string; readonly path?: string }>;
			readonly persisted?: boolean;
			readonly validation?: { readonly errors?: ReadonlyArray<{ readonly code?: string }> };
			readonly build?: { readonly entries?: ReadonlyArray<{ readonly error?: string }> };
		};
	};
	readonly content?: ReadonlyArray<{ readonly text?: string }>;
}

const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;
const textOf = (result: ToolResult): string => result.content?.map((part) => part.text ?? "").join("") ?? "";

const Live = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** A server rooted at a temporary directory holding `files`, with `pnpm-workspace.yaml` making it the root. */
const serving = <A, E>(
	files: Readonly<Record<string, string | null>>,
	use: (harness: McpHarness, cwd: string) => Effect.Effect<A, E>,
) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const cwd = mkdtempSync(join(tmpdir(), "effected-action-mcp-"));
			for (const [name, source] of Object.entries(files)) {
				if (source === null) continue;
				mkdirSync(dirname(join(cwd, name)), { recursive: true });
				writeFileSync(join(cwd, name), source);
			}
			return cwd;
		}),
		(cwd) =>
			Effect.gen(function* () {
				const services = yield* Layer.build(Live);
				const harness = yield* McpHarness.make(ServerLayer({ cwd }), { services });
				yield* harness.initialize;
				return yield* use(harness, cwd);
			}).pipe(Effect.scoped),
		(cwd) => Effect.sync(() => rmSync(cwd, { recursive: true, force: true })),
	);

describe("action_build", () => {
	const nested = (files: Readonly<Record<string, string>>): Readonly<Record<string, string>> => ({
		"package.json": JSON.stringify({ name: "root", private: true }),
		"pnpm-workspace.yaml": 'packages:\n  - "actions/*"\n',
		...Object.fromEntries(Object.entries(files).map(([name, source]) => [`actions/one/${name}`, source])),
	});
	const WORKSPACE_LOCAL = nested({
		...GOOD,
		"effected.toml":
			'[action.entries]\nmain = "src/main.ts"\n[action.persistLocal]\nbase = "workspace"\ndist = false\n',
	});

	it("action_build takes no watch parameter", () => {
		// The MCP tools stay one-shot: a watch belongs to the CLI, whose process a person or agent can interrupt.
		assert.isFalse("watch" in actionBuild.parametersSchema.fields);
	});

	it.live("is listed with its output schema and its annotations, and the instructions name it", () =>
		serving(GOOD, (harness) =>
			Effect.gen(function* () {
				const tool = (yield* harness.listTools).find((candidate) => candidate.name === "action_build") as unknown as {
					readonly outputSchema?: unknown;
					readonly annotations?: { readonly readOnlyHint?: boolean };
				};
				assert.include(JSON.stringify(tool.outputSchema ?? {}), '"verdict"');
				assert.strictEqual(tool.annotations?.readOnlyHint, false);
				assert.include(SERVER_INSTRUCTIONS, "action_build");
			}),
		),
	);

	it("takes a check parameter", () => {
		assert.isTrue("check" in actionBuild.parametersSchema.fields);
	});

	it.live("check: true on a never-persisted action is a failed verdict listing the drift, and writes nothing", () =>
		serving(GOOD, (harness, cwd) =>
			Effect.gen(function* () {
				const before = treeOf(cwd);
				const result = resultOf(yield* harness.callTool("action_build", { check: true }));
				assert.notStrictEqual(result.isError, true, textOf(result));
				assert.strictEqual(result.structuredContent?.verdict, "failed");
				assert.isAbove(result.structuredContent?.result?.drift?.length ?? 0, 0);
				assert.deepStrictEqual(treeOf(cwd), before);
			}),
		),
	);

	it.live("check: true over stale committed output reports it changed and leaves every output file as it was", () =>
		serving(
			{
				...GOOD,
				"dist/main.js": "stale dist\n",
				".github/actions/local/action.yml": GOOD["action.yml"] ?? "",
				".github/actions/local/dist/main.js": "stale persisted\n",
				".github/actions/local/dist/extra.js": "extra\n",
			},
			(harness, cwd) =>
				Effect.gen(function* () {
					const before = treeOf(cwd);
					const result = resultOf(yield* harness.callTool("action_build", { check: true }));
					assert.notStrictEqual(result.isError, true, textOf(result));
					assert.strictEqual(result.structuredContent?.verdict, "failed");
					const drift = (result.structuredContent?.result?.drift ?? []).map((entry) => `${entry.kind} ${entry.path}`);
					assert.include(drift, "changed dist/main.js");
					assert.include(drift, "extra dist/extra.js");
					assert.deepStrictEqual(treeOf(cwd), before);
				}),
		),
	);

	it.live("check: true ignores persist: false and is ok once the build is persisted", () =>
		serving(GOOD, (harness) =>
			Effect.gen(function* () {
				yield* harness.callTool("action_build", { persist: true });
				const result = resultOf(yield* harness.callTool("action_build", { check: true, persist: false }));
				assert.strictEqual(result.structuredContent?.verdict, "ok", textOf(result));
				assert.deepStrictEqual(result.structuredContent?.result?.drift, []);
			}),
		),
	);

	it.live("check: true with persistLocal disabled is a refusal", () =>
		serving(
			{ ...GOOD, "effected.toml": '[action.entries]\nmain = "src/main.ts"\n[action.persistLocal]\nenabled = false\n' },
			(harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", { check: true }));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "nothing to check");
				}),
		),
	);

	it.live("dist = false without persist is a refusal telling the caller to pass persist: true", () =>
		serving(WORKSPACE_LOCAL, (harness) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_build", { cwd: "actions/one" }));
				assert.isTrue(result.isError);
				assert.include(textOf(result), "persist: true");
			}),
		),
	);

	it.live("dist = false with persistLocal disabled tells the caller to set enabled or dist, not the path", () =>
		serving(
			nested({
				...GOOD,
				"effected.toml":
					'[action.entries]\nmain = "src/main.ts"\n[action.persistLocal]\nenabled = false\ndist = false\nbase = "workspace"\n',
			}),
			(harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", { cwd: "actions/one", persist: true }));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "enabled = true");
					assert.notInclude(textOf(result), "persistLocal] path");
				}),
		),
	);

	it.live("an unusable persist path is a refusal naming the reason and the config key", () =>
		serving(
			nested({
				...GOOD,
				"effected.toml":
					'[action.entries]\nmain = "src/main.ts"\n[action.persistLocal]\npath = "../../../outside"\nbase = "workspace"\n',
			}),
			(harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", { cwd: "actions/one", persist: true }));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "outside-workspace");
					assert.include(textOf(result), "[action.persistLocal] path");
				}),
		),
	);

	it.live("builds without persisting by default, from the server's directory", () =>
		serving(GOOD, (harness, cwd) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_build", {}));
				assert.notStrictEqual(result.isError, true, textOf(result));
				assert.strictEqual(result.structuredContent?.verdict, "ok");
				assert.isFalse(result.structuredContent?.result?.persisted);
				assert.include(readdirSync(join(cwd, "dist")), "main.js");
				assert.sameMembers(readdirSync(cwd), ["action.yml", "dist", "effected.toml", "package.json", "src"]);
			}),
		),
	);

	it.live("persist: true writes the local action directory and the act template", () =>
		serving(GOOD, (harness, cwd) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_build", { persist: true }));
				assert.notStrictEqual(result.isError, true, textOf(result));
				assert.isTrue(result.structuredContent?.result?.persisted);
				assert.include(readdirSync(join(cwd, ".github/actions/local/dist")), "main.js");
				assert.include(readdirSync(cwd), ".actrc");
				assert.include(readdirSync(join(cwd, ".github/workflows")), "act-test.yml");
			}),
		),
	);

	it.live("names what persist writes in the tool and parameter descriptions", () =>
		serving(GOOD, (harness) =>
			Effect.gen(function* () {
				const tool = (yield* harness.listTools).find((candidate) => candidate.name === "action_build");
				const described = JSON.stringify(tool ?? {});
				for (const file of [".github/actions/local", ".actrc", ".github/workflows/act-test.yml"]) {
					assert.include(described, file);
				}
				assert.include(described, "Omitted, false");
			}),
		),
	);

	it.live("refuses an unreadable package.json, saying what to check", () =>
		serving({ ...GOOD, "package.json": null, "package.json/not-a-file": "" }, (harness, cwd) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_build", {}));
				assert.isTrue(result.isError);
				assert.include(textOf(result), `Check that ${join(cwd, "package.json")}`);
			}),
		),
	);

	it.live("takes persist and validate, and a cwd under the root", () =>
		serving(
			Object.fromEntries(
				Object.entries({ ...GOOD, "action.yml": "name: [unclosed\n" }).map(([k, v]) => [`sub/${k}`, v]),
			),
			(harness, cwd) =>
				Effect.gen(function* () {
					const result = resultOf(
						yield* harness.callTool("action_build", { cwd: "sub", validate: false, persist: false }),
					);
					assert.notStrictEqual(result.isError, true, textOf(result));
					assert.strictEqual(result.structuredContent?.verdict, "ok");
					assert.isFalse(result.structuredContent?.result?.persisted);
					assert.include(readdirSync(join(cwd, "sub/dist")), "main.js");
				}),
		),
	);

	it.live("answers a failed verdict as a result, with what failed", () =>
		serving({ ...GOOD, "src/main.ts": 'throw new TypeError("broken at load");\n' }, (harness) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_build", {}));
				assert.notStrictEqual(result.isError, true, textOf(result));
				assert.strictEqual(result.structuredContent?.verdict, "failed");
				assert.include(result.structuredContent?.result?.build?.entries?.[0]?.error ?? "", "broken at load");
			}),
		),
	);

	it.live("refuses a directory with no [action] table, naming the file to change", () =>
		serving({ ...GOOD, "effected.toml": "" }, (harness, cwd) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_build", {}));
				assert.isTrue(result.isError);
				assert.include(textOf(result), "[action]");
				assert.include(textOf(result), join(cwd, "effected.toml"));
			}),
		),
	);

	it.live("refuses a config it cannot read, a non-package, and a path outside the root", () =>
		Effect.gen(function* () {
			yield* serving({ ...GOOD, "effected.toml": "[action.build]\nwhat = 1\n" }, (harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", {}));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "action.build.what");
				}),
			);
			yield* serving({ ...GOOD, "package.json": null }, (harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", {}));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "not a package");
				}),
			);
			yield* serving(GOOD, (harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", { cwd: "/" }));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "outside the workspace root");
				}),
			);
		}),
	);

	it.live("refuses what the builder cannot get past, naming the path", () =>
		serving(
			{ ...GOOD, "action.yml": GOOD["action.yml"]?.replace("dist/main.js", "dist/elsewhere.js") ?? null },
			(harness) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_build", { persist: true }));
					assert.isTrue(result.isError);
					assert.include(textOf(result), "dist/elsewhere.js");
				}),
		),
	);
});
