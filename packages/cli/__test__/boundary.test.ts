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
		// (CliLogger.ts:104); the scanner has no scope analysis, so that one
		// file is allowed, and the unallowed scan proves the allowance is both
		// needed and the only one.
		it.effect("only CliLogger.ts names console, and it is the only allowance", () =>
			Effect.gen(function* () {
				const unallowed = yield* SourceBoundary.scan({ root: SRC, rules: ["console-write"] });
				assert.deepStrictEqual([...new Set(unallowed.offences.map((offence) => offence.file))], ["CliLogger.ts"]);
				const allowed = yield* SourceBoundary.scan({ root: SRC, rules: ["console-write"], allow: ["CliLogger.ts"] });
				assert.deepStrictEqual(allowed.allowed, ["CliLogger.ts"]);
				assert.deepStrictEqual(allowed.violations, []);
			}),
		);
	});
});
