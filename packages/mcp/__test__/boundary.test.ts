import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("mcp boundary", () => {
	layer(NodeServices.layer)((it) => {
		it.effect("the scanner still flags and spares what its shipped fixtures say (positive control)", () =>
			Effect.sync(() => assert.deepStrictEqual(SourceBoundary.verifyFixtures(), [])),
		);

		it.effect(
			"no source file reads process, imports a node:, platform or kit module, or writes to stdout or the console, outside the ./node licence",
			() =>
				Effect.gen(function* () {
					const scan = yield* SourceBoundary.scan({
						root: SRC,
						rules: [
							"process",
							"node:process",
							"stdout-write",
							"console",
							{ forbidImports: ["node:*", "@effect/platform*", "@effected/cli", "@effected/workspaces"] },
						],
						// The ./node subpath's one licence: StdioCapture imports node:async_hooks (the capture context)
						// and node:stream (StdioCapture.nullWritable). Its host is
						// structural, so it reads no `process` and the other rules hold there too.
						allowRules: { forbidImports: ["StdioCapture.ts"] },
					});
					assert.include(scan.files, "McpStdio.ts", "the scan read the real tree");
					assert.include(scan.files, "StdioCapture.ts", "the scan read the ./node module");
					assert.isAbove(scan.files.length, 2);
					assert.deepStrictEqual(scan.allowed, []);
					assert.deepStrictEqual(scan.violations, []);
					assert.deepStrictEqual(
						scan.waived.map((offence) => `${offence.file} ${offence.rule} ${offence.detail}`),
						["StdioCapture.ts forbidImports node:async_hooks", "StdioCapture.ts forbidImports node:stream"],
						"the licence waives exactly these two imports",
					);
				}),
		);
	});
});
