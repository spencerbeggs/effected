// How resolving a subpath grows with the number of pattern keys. `PackageExports.test.ts` holds what it resolves to.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { PackageExports } from "../src/index.js";

describe("PackageExports.resolveResult over thousands of pattern keys", () => {
	// Each key is matched by a scan, with no regex to backtrack: 4x the keys is about 4x the work.
	it("resolves by scan, in time linear in the keys", () => {
		Growth.assertOrder(
			(count) => {
				const exports: Record<string, string> = {};
				for (let index = 0; index < count; index++) exports[`./p${index}/*${"a".repeat(30)}`] = `./d${index}/*.js`;
				exports["./*"] = "./fallback/*.js";
				const subpath = `./${"a".repeat(5000)}`;
				return () => PackageExports.resolveResult({ exports }, subpath);
			},
			{ from: 5_000, order: 1 },
		);
	});
});
