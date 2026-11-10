import { fileURLToPath } from "node:url";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { McpHarness } from "@effected/mcp-kit/testing";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ServerLayer } from "../src/server.js";

// Real filesystem and real jiti: an injected importer proves nothing about the server's most likely bug, a long-lived
// process answering from the config it loaded first.
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const TIMEOUT = 60_000;
const MODULES = fileURLToPath(new URL("../node_modules", import.meta.url));

interface ToolResult {
	readonly isError?: boolean;
	readonly content?: ReadonlyArray<{ readonly text?: string }>;
	readonly structuredContent?: { readonly verdict?: string };
}

const project = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const made = yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "mcp-reload-" }), (dir) =>
		fs.remove(dir, { recursive: true }).pipe(Effect.ignore),
	);
	// A temp directory's own path can run through a link (macOS's /var), which containment resolves.
	yield* fs.symlink(MODULES, path.join(made, "node_modules"));
	yield* fs.writeFileString(path.join(made, "pnpm-workspace.yaml"), "");
	const write = (name: string, text: string) => fs.writeFileString(path.join(made, name), text);
	const read = (name: string) => fs.readFileString(path.join(made, name));
	return { dir: made, write, read };
});

const CONFIG = `import { defineConfig } from "@effected/schemastore";
import { Shape } from "./shape.ts";
export default defineConfig({
	name: "demo",
	outputDir: "schemas",
	baseUrl: "https://example.com/s",
	schemas: { app: { schema: Shape } },
});
`;

const shape = (field: string) => `import { Schema } from "effect";
export const Shape = Schema.Struct({ ${field}: Schema.String });
`;

// Several slices and a merged catalog, so one build writes several files. The lane and the atomic replace are each
// pinned deterministically in schema-tools.test.ts ("a check waits for a build holding a half-landed tree") and in the
// engine's and schemastore's failed-rename tests; a real disk cannot be made to tear on cue, so this test proves the
// real-disk, real-jiti path end to end and stays small. At 30 slices of 400 fields it neither caught a removed lane nor a
// non-atomic write, and its eight builds ran past the 60 s timeout on a slow CI runner.
const MANY = 6;
const manyConfig = (field: string) => `import { defineConfig } from "@effected/schemastore";
import { Schema } from "effect";
const fields = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["${field}" + i, Schema.String]));
const entries = Array.from({ length: ${MANY} }, (_, i) => [
	"s" + i,
	{ schema: Schema.Struct(fields), catalog: { description: "s" + i, fileMatch: ["s" + i + ".json"] } },
]);
export default defineConfig({
	name: "demo",
	outputDir: "schemas",
	baseUrl: "https://example.com/s",
	schemas: Object.fromEntries(entries),
});
`;

const call = (harness: McpHarness, name: string, args: unknown = {}) =>
	Effect.map(harness.callTool(name, args), (response) => response.result as ToolResult);

const serve = (dir: string) =>
	Effect.gen(function* () {
		const harness = yield* McpHarness.make(ServerLayer({ cwd: dir }).pipe(Layer.provide(Platform)));
		yield* harness.initialize;
		return harness;
	});

describe("schema tools over real jiti", () => {
	it.live(
		"editing a schema between two schema_check calls changes the answer",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", CONFIG);
				yield* write("shape.ts", shape("name"));
				const harness = yield* serve(dir);
				const built = yield* call(harness, "schema_build");
				assert.strictEqual(built.structuredContent?.verdict, "ok");
				assert.strictEqual((yield* call(harness, "schema_check")).structuredContent?.verdict, "ok");
				yield* write("shape.ts", shape("renamed"));
				const after = yield* call(harness, "schema_check");
				assert.notStrictEqual(after.isError, true);
				assert.notStrictEqual(after.structuredContent?.verdict, "ok");
			}).pipe(Effect.scoped, Effect.provide(Platform)),
		TIMEOUT,
	);

	it.live(
		"a relative config path and a temp root reached through a link both resolve",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", CONFIG);
				yield* write("shape.ts", shape("name"));
				const harness = yield* serve(dir);
				const result = yield* call(harness, "schema_check", { config: "schemastore.config.ts" });
				assert.notStrictEqual(result.isError, true);
			}).pipe(Effect.scoped, Effect.provide(Platform)),
		TIMEOUT,
	);

	it.live(
		"concurrent builds over a real disk each answer ok and land the edited config",
		() =>
			Effect.gen(function* () {
				const { dir, write, read } = yield* project;
				const harness = yield* serve(dir);
				for (const round of ["one", "two"]) {
					yield* write("schemastore.config.ts", manyConfig(round));
					const builds = yield* Effect.all(
						Array.from({ length: 4 }, () => call(harness, "schema_build")),
						{ concurrency: "unbounded" },
					);
					// Every queued build reloads the edited config through real jiti and answers "ok" over the real disk.
					for (const result of builds) {
						assert.notStrictEqual(result.isError, true, JSON.stringify(result.content));
						assert.strictEqual(result.structuredContent?.verdict, "ok", round);
					}
					const document = JSON.parse(yield* read("schemas/s0.json")) as { readonly properties: object };
					assert.property(document.properties, `${round}0`);
					assert.strictEqual((yield* call(harness, "schema_check")).structuredContent?.verdict, "ok", round);
				}
			}).pipe(Effect.scoped, Effect.provide(Platform)),
		TIMEOUT,
	);
});
