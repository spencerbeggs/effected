// `relativeTo` without a `Path` trims the caller's root of trailing separators. An unanchored `/[\\/]+$/` retries
// from every separator in a run that is not at the end, which is quadratic on a long run inside the root: 200,000
// separators took tens of seconds. `displayPath.test.ts` holds what the trim returns.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Option } from "effect";
import { relativeTo } from "../src/internal/displayPath.js";

describe("relativeTo without Path", () => {
	it("trims a root holding a long separator run in time linear in the run", () => {
		Growth.assertOrder(
			(count) => {
				const root = `a${"/".repeat(count)}b`;
				const file = `${root}/x.ts`;
				return () => relativeTo(root, Option.none())(file);
			},
			{ from: 50_000, order: 1 },
		);
	});
});
