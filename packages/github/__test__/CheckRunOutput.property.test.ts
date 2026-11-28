import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Schema } from "effect";
import { CheckRunOutput } from "../src/CheckRun.js";

describe("CheckRunOutput byte budgeting, generated", () => {
	/** The cut the Buffer implementation makes, which `resources2.test.ts` pins case by case. */
	const bufferCap = (value: string): string => {
		if (Buffer.byteLength(value, "utf8") <= CheckRunOutput.LIMIT_BYTES) return value;
		const budget = CheckRunOutput.LIMIT_BYTES - Buffer.byteLength(CheckRunOutput.NOTICE, "utf8");
		let cut = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
		while (cut.endsWith("�")) cut = cut.slice(0, -1);
		return `${cut}${CheckRunOutput.NOTICE}`;
	};

	// Every scalar value — the whole plane minus the surrogate block, so the
	// cut can land inside any multi-byte sequence or pair without the input
	// itself carrying broken halves. Generated as code points rather than a
	// string because the native string generator stays in printable ASCII;
	// `size` lifts the length scale to the 40 000 cap so the input actually
	// crosses the 65 535-byte budget.
	const ScalarValue = Schema.Union([
		Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xd7ff })),
		Schema.Int.check(Schema.isBetween({ minimum: 0xe000, maximum: 0x10ffff })),
	]);
	const binaryText = Arbitrary.schema(Schema.Array(ScalarValue).check(Schema.isMaxLength(40_000))).pipe(
		Arbitrary.map((codePoints) => codePoints.map((codePoint) => String.fromCodePoint(codePoint)).join("")),
	);

	it.prop(
		"stays valid UTF-8 within budget for any input",
		[binaryText],
		([summary]) => {
			const cut = CheckRunOutput.make({ title: "t", summary }).truncated().summary;
			const withinBudget = Buffer.byteLength(cut, "utf8") <= CheckRunOutput.LIMIT_BYTES;
			// Round-tripping through UTF-8 is lossless exactly when nothing is broken
			// beyond what the input already contained.
			const noNewDamage = (cut.match(/�/g) ?? []).length <= (summary.match(/�/g) ?? []).length + 1;
			return withinBudget && noNewDamage && cut === bufferCap(summary);
		},
		// `size: 40_000` is load-bearing: at 20_000 no run ever crosses the
		// 65 535-byte budget (0/100 probed), at 40_000 about one in five does.
		// That makes each run expensive — ~0.7s for 100 locally, past the 5s
		// default under coverage on a CI runner — so the run count is halved and
		// the timeout raised rather than the domain shrunk.
		{ arbitrary: { size: 40_000, runs: Depth.pick({ sample: 20, full: 50 }) }, timeout: 30_000 },
	);
});
