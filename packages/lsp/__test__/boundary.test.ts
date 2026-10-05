import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("lsp boundary", () => {
	layer(NodeServices.layer)((it) => {
		it.effect("the scanner still flags and spares what its shipped fixtures say (positive control)", () =>
			Effect.sync(() => assert.deepStrictEqual(SourceBoundary.verifyFixtures(), [])),
		);

		it.effect(
			"no source file reads process, writes to stdout or the console, or imports a node:, platform or kit module",
			() =>
				Effect.gen(function* () {
					const scan = yield* SourceBoundary.scan({
						root: SRC,
						rules: [
							"process",
							"node:process",
							"stdout-write",
							"console",
							{ forbidImports: ["node:*", "@effect/platform*", "@effected/*"] },
						],
					});
					assert.include(scan.files, "LspProbe.ts", "the scan read the real tree");
					assert.isAbove(scan.files.length, 2);
					assert.deepStrictEqual(scan.allowed, []);
					assert.deepStrictEqual(scan.violations, []);
				}),
		);
	});
});
