// How resolving an address grows on a long run of trailing slashes. `address.test.ts` holds what it resolves to.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { resolveAddress } from "../src/internal/address.js";

describe("resolveAddress on a long run of trailing slashes", () => {
	it("strips the run in time linear in its length", () => {
		Growth.assertOrder(
			(count) => {
				const endpoint = `https://x.example/p${"/".repeat(count)}`;
				return () => resolveAddress({ bucket: "b", region: "auto", endpoint });
			},
			{ from: 12_500, order: 1 },
		);
	});
});
