/**
 * Test-shaped probe — it.effect + assert.* for Effect-typed probes, plain it
 * for sync ones; discovered as the "scratchpad" vitest project (local only,
 * never CI). Disposable — reset reseeds it.
 *
 * Run from the repo root:
 *   pnpm exec vitest run --project scratchpad --coverage.enabled=false
 * (without the flag the repo's global coverage thresholds fail any
 * project-scoped run), or via the vitest-agent MCP run_tests tool — there,
 * read the Tests line, not the exit code.
 */
import { assert, describe, it } from "@effect/vitest";
import { SemVer } from "@effected/semver";
import { Effect, Result } from "effect";
import { assertSuccess } from "./utils/assert-result.js";

describe("probe", () => {
	it.effect("settles a semantics question with typed evidence", () =>
		Effect.gen(function* () {
			const version = yield* SemVer.parse("1.2.3-beta.1");
			assert.strictEqual(version.minor, 2);
			assert.deepStrictEqual([...version.prerelease], ["beta", 1]);
		}),
	);

	it("unwraps Results through the utils helpers, never raw access", () => {
		assert.strictEqual(assertSuccess(Result.succeed(1)), 1);
	});
});
