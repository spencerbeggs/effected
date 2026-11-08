// `action_init` in process, over a pinned memfs volume rooted at `/repo` by its `pnpm-workspace.yaml`.
import { assert, describe, it } from "@effect/vitest";
import { McpHarness } from "@effected/mcp-kit/testing";
import type { MemoryFileSystemSeed, MemoryFileSystemVolume } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { SERVER_INSTRUCTIONS, ServerLayer } from "../../src/server.js";

const ROOT = "/repo";
const ACTION = "/repo/actions/greet";
const MANIFEST = JSON.stringify({ name: "@acme/greet", description: "Greets someone", type: "module" });
const PLANNED = ["effected.toml", "action.yml", "src/main.ts", "src/program.ts", "tsconfig.json"];

interface ToolResult {
	readonly isError?: boolean;
	readonly structuredContent?: {
		readonly written?: ReadonlyArray<string>;
		readonly overwritten?: ReadonlyArray<string>;
		readonly missingDependencies?: ReadonlyArray<string>;
	};
	readonly content?: ReadonlyArray<{ readonly text?: string }>;
}

const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;
const textOf = (result: ToolResult): string => result.content?.map((part) => part.text ?? "").join("") ?? "";

const serving = <A, E>(
	files: MemoryFileSystemSeed,
	use: (harness: McpHarness, volume: MemoryFileSystemVolume) => Effect.Effect<A, E>,
) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle({ [`${ROOT}/pnpm-workspace.yaml`]: "packages: []\n", ...files });
		const services = yield* Layer.build(Layer.mergeAll(handle.layer, Path.layer));
		const harness = yield* McpHarness.make(ServerLayer({ cwd: ROOT }), { services });
		yield* harness.initialize;
		return yield* use(harness, handle.volume);
	}).pipe(Effect.scoped);

describe("action_init", () => {
	it.effect("is listed as a writing tool, and the instructions name it", () =>
		serving({}, (harness) =>
			Effect.gen(function* () {
				const tool = (yield* harness.listTools).find((candidate) => candidate.name === "action_init") as unknown as {
					readonly outputSchema?: unknown;
					readonly annotations?: { readonly readOnlyHint?: boolean };
				};
				assert.include(JSON.stringify(tool.outputSchema ?? {}), '"written"');
				assert.strictEqual(tool.annotations?.readOnlyHint, false);
				assert.include(SERVER_INSTRUCTIONS, "action_init");
			}),
		),
	);

	it.effect("scaffolds a package directory under the root and names the dependencies to add", () =>
		serving({ [`${ACTION}/package.json`]: MANIFEST }, (harness, volume) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_init", { cwd: "actions/greet" }));
				assert.notStrictEqual(result.isError, true, textOf(result));
				assert.deepStrictEqual(result.structuredContent?.written, PLANNED);
				assert.include(result.structuredContent?.missingDependencies ?? [], "@effected/github-actions");
				for (const file of PLANNED) assert.isTrue(volume.has(`${ACTION}/${file}`), file);
				assert.include(volume.text(`${ACTION}/action.yml`) ?? "", 'name: "greet"');
			}),
		),
	);

	it.effect("refuses an existing file, writing nothing, and force replaces it", () =>
		serving({ [`${ACTION}/package.json`]: MANIFEST, [`${ACTION}/action.yml`]: "keep\n" }, (harness, volume) =>
			Effect.gen(function* () {
				const refused = resultOf(yield* harness.callTool("action_init", { cwd: "actions/greet" }));
				assert.isTrue(refused.isError);
				assert.include(textOf(refused), "action.yml");
				assert.include(textOf(refused), "force: true");
				assert.isFalse(volume.has(`${ACTION}/effected.toml`));

				const forced = resultOf(yield* harness.callTool("action_init", { cwd: "actions/greet", force: true }));
				assert.notStrictEqual(forced.isError, true, textOf(forced));
				assert.deepStrictEqual(forced.structuredContent?.overwritten, ["action.yml"]);
			}),
		),
	);

	it.effect("refuses a directory outside the workspace root", () =>
		serving({}, (harness) =>
			Effect.gen(function* () {
				const result = resultOf(yield* harness.callTool("action_init", { cwd: "../elsewhere" }));
				assert.isTrue(result.isError);
				assert.include(textOf(result), "outside the workspace root");
			}),
		),
	);

	it.effect("refuses a directory with no package.json, and a description found nowhere", () =>
		serving({ [`${ACTION}/package.json`]: JSON.stringify({ name: "x" }) }, (harness) =>
			Effect.gen(function* () {
				const bare = resultOf(yield* harness.callTool("action_init", { name: "a", description: "b" }));
				assert.isTrue(bare.isError);
				assert.include(textOf(bare), "package.json");

				const undescribed = resultOf(yield* harness.callTool("action_init", { cwd: "actions/greet" }));
				assert.isTrue(undescribed.isError);
				assert.include(textOf(undescribed), "Pass description");
			}),
		),
	);

	// A committed link in an unreviewed checkout must not carry a write past the workspace root.
	const links: ReadonlyArray<readonly [string, MemoryFileSystemSeed, Record<string, unknown>, string]> = [
		[
			"a dangling effected.toml link to outside the root",
			{ [`${ACTION}/effected.toml`]: MemoryFileSystem.symlink("/outside/escaped.toml") },
			{},
			"effected.toml (symlink)",
		],
		[
			"force over a link to an outside file",
			{
				[`${ACTION}/tsconfig.json`]: MemoryFileSystem.symlink("/outside/precious.json"),
				"/outside/precious.json": "precious\n",
			},
			{ force: true },
			"tsconfig.json (symlink)",
		],
		["a symlinked src/", { [`${ACTION}/src`]: MemoryFileSystem.symlink("/outside") }, { force: true }, "src (symlink)"],
	];
	for (const [label, seed, args, named] of links) {
		it.effect(`refuses ${label}, writing nothing outside the root`, () =>
			serving({ [`${ACTION}/package.json`]: MANIFEST, "/outside/.keep": "", ...seed }, (harness, volume) =>
				Effect.gen(function* () {
					const result = resultOf(yield* harness.callTool("action_init", { cwd: "actions/greet", ...args }));
					assert.isTrue(result.isError);
					assert.include(textOf(result), named);
					assert.include(textOf(result), "never replaces a symbolic link");
					assert.isFalse(volume.has("/outside/escaped.toml"));
					assert.sameMembers(
						[...(volume.readDirectory("/outside") ?? [])],
						[".keep", ...("/outside/precious.json" in seed ? ["precious.json"] : [])],
					);
					if ("/outside/precious.json" in seed) assert.strictEqual(volume.text("/outside/precious.json"), "precious\n");
					assert.isFalse(volume.has(`${ACTION}/action.yml`));
				}),
			),
		);
	}
});
