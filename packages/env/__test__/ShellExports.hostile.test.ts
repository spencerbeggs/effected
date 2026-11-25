// How parsing a file of exports grows with its length. `ShellExports.test.ts` holds what it parses to.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { ShellExports } from "../src/ShellExports.js";

const file = (count: number): string =>
	ShellExports.format(
		Object.fromEntries(Array.from({ length: count }, (_, k) => [`VAR_${k}`, `value ${k} it's $'x'`])),
	);

describe("ShellExports.parseResult on a long file", () => {
	it("grows linearly: four times the text takes well under sixteen times as long", () => {
		// Linear is about 4x; quadratic would be about 16x.
		const { ratio, detail } = Growth.measure(
			(count) => {
				const text = file(count);
				return () => ShellExports.parseResult(text);
			},
			{ from: 10_000, bound: 8 },
		);
		assert.isBelow(ratio, 8, detail);
	});
});
