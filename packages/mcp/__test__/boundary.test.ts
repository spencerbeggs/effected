import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("mcp source boundary", () => {
	layer(NodeServices.layer)((it) => {
		it.effect("the scanner still flags and spares what its shipped fixtures say (positive control)", () =>
			Effect.sync(() => assert.deepStrictEqual(SourceBoundary.verifyFixtures(), [])),
		);

		it.effect("no Exclusive lane body in src calls Effect.promise or Effect.runPromise", () =>
			Effect.gen(function* () {
				const scan = yield* SourceBoundary.scan({ root: SRC, rules: [{ promiseInExclusive: {} }] });
				assert.include(scan.files, "tools/schema.ts", "the scan read the real tree");
				assert.deepStrictEqual(scan.violations, []);
			}),
		);
	});
});
