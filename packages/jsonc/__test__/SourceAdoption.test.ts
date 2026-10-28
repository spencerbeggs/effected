// `@effected/source` adoption: `JsoncParseErrorDetail` positions come from one
// `LineIndex` per parse under the `"unicode"` rule, and the class satisfies
// `SourceLocation` structurally (but not `SourceDiagnostic`: no `message`).

import { assert, describe, it } from "@effect/vitest";
import type { SourceDiagnostic, SourceLocation } from "@effected/source";
import { Result } from "effect";
import { JsoncParseErrorDetail } from "../src/index.js";
import { Jsonc, toDetails } from "../src/Jsonc.js";

const LS = String.fromCodePoint(0x2028);
const PS = String.fromCodePoint(0x2029);

describe("JsoncParseErrorDetail positions (LineIndex, unicode rule)", () => {
	it("reads an offset at the \\n of a \\r\\n as the end of its line, never character -1", () => {
		// No parse reaches this offset (the scanner consumes \r\n as one
		// token), so the materializer is driven directly. Before adoption the
		// hand-rolled loop answered { line: 1, character: -1 } here.
		const [detail] = toDetails("a\r\nb", [{ code: "InvalidSymbol", offset: 2, length: 0 }]);
		assert.isDefined(detail);
		assert.strictEqual(detail?.line, 0);
		assert.strictEqual(detail?.character, 1);
	});

	it("still counts U+2028 and U+2029 as line breaks, for jsonc-parser parity", () => {
		const details = toDetails(`a${LS}b${PS}c`, [
			{ code: "InvalidSymbol", offset: 2, length: 1 },
			{ code: "InvalidSymbol", offset: 4, length: 1 },
		]);
		assert.deepStrictEqual(
			details.map((d) => [d.line, d.character]),
			[
				[1, 0],
				[2, 0],
			],
		);
	});

	it("positions a real parse error after a separator on the next line", () => {
		const result = Jsonc.parseResult(`[1,${LS}x]`);
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			const error = result.failure.errors.find((e) => e.offset === 4);
			assert.isDefined(error);
			assert.strictEqual(error?.line, 1);
			assert.strictEqual(error?.character, 0);
		} else {
			assert.fail("expected a parse failure");
		}
	});

	it("materializes no details for no errors", () => {
		assert.deepStrictEqual(toDetails("{}", []), []);
	});
});

describe("JsoncParseErrorDetail satisfies @effected/source shapes", () => {
	it("is assignable to SourceLocation, and not to SourceDiagnostic", () => {
		const detail = JsoncParseErrorDetail.make({ code: "InvalidSymbol", offset: 3, length: 1, line: 0, character: 3 });
		const location: SourceLocation = detail;
		// @ts-expect-error -- no `message` field, so not a SourceDiagnostic.
		const diagnostic: SourceDiagnostic = detail;
		assert.strictEqual(location.offset, 3);
		assert.isDefined(diagnostic);
	});
});
