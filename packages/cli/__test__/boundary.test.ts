import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("cli boundary", () => {
	layer(NodeServices.layer)((it) => {
		it.effect("the scanner still flags and spares what its shipped fixtures say (positive control)", () =>
			Effect.sync(() => assert.deepStrictEqual(SourceBoundary.verifyFixtures(), [])),
		);

		it.effect(
			"no source file reads process, writes to stdout, or imports node:, a platform package, mcp or engine",
			() =>
				Effect.gen(function* () {
					const scan = yield* SourceBoundary.scan({
						root: SRC,
						rules: [
							"process",
							"node:process",
							"stdout-write",
							{ forbidImports: ["node:*", "@effect/platform*", "@effected/mcp", "@effected/engine"] },
						],
					});
					assert.include(scan.files, "CliRuntime.ts", "the scan read the real tree");
					assert.deepStrictEqual(scan.violations, []);
				}),
		);

		// CliLogger binds a LOCAL `console` to core's Console service
		// (CliLogger.ts:104); the scanner has no scope analysis, so the console
		// rule is waived for that one file. The waiver is visible in `waived`,
		// which proves it is both needed and the only one, while every other
		// rule still holds CliLogger.ts.
		it.effect("only CliLogger.ts names console, and only the console rule is waived there", () =>
			Effect.gen(function* () {
				const scan = yield* SourceBoundary.scan({
					root: SRC,
					rules: ["process", "stdout-write", "console"],
					allowRules: { console: ["CliLogger.ts"] },
				});
				assert.include(scan.files, "CliLogger.ts", "the scan read the real tree");
				assert.deepStrictEqual(scan.allowed, []);
				assert.deepStrictEqual(scan.violations, []);
				assert.isNotEmpty(scan.waived, "the waiver still waives something");
				assert.deepStrictEqual(
					[...new Set(scan.waived.map((offence) => `${offence.file} ${offence.rule}`))],
					["CliLogger.ts console"],
				);
			}),
		);
	});
});
