// ErrorText: any value as error text, never throwing. The cause-chain walk itself is pinned by
// causeMessage.test.ts (the kit-wide suite every copy carries); this file pins the public surface.
import { assert, describe, it } from "@effect/vitest";
import { ErrorText } from "../src/index.js";

describe("ErrorText.describe", () => {
	it("keeps strings and stringifies other primitives", () => {
		assert.strictEqual(ErrorText.describe("x"), "x");
		assert.strictEqual(ErrorText.describe(3), "3");
		assert.strictEqual(ErrorText.describe(false), "false");
		assert.strictEqual(ErrorText.describe(10n), "10");
		assert.strictEqual(ErrorText.describe(Symbol("s")), "Symbol(s)");
		assert.strictEqual(ErrorText.describe(undefined), "undefined");
		assert.strictEqual(ErrorText.describe(null), "null");
	});

	it("is the message of anything with a string message, without instanceof Error", () => {
		assert.strictEqual(ErrorText.describe(new Error("boom")), "boom");
		assert.strictEqual(ErrorText.describe({ message: "plain" }), "plain");
		assert.strictEqual(ErrorText.describe(new Error("")), "");
	});

	it("is JSON for a plain object or array", () => {
		assert.strictEqual(ErrorText.describe({ a: 1 }), '{"a":1}');
		assert.strictEqual(ErrorText.describe([1, 2]), "[1,2]");
	});

	it("never throws: a cycle, a bigint field, a throwing getter, a value with no prototype", () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		assert.strictEqual(ErrorText.describe(cycle), "[object Object]");
		assert.strictEqual(ErrorText.describe({ n: 1n }), "[object Object]");
		const getter = Object.defineProperty({}, "message", {
			get() {
				throw new Error("no");
			},
		});
		assert.strictEqual(ErrorText.describe(getter), "{}");
		const hostile = Object.create(null) as object;
		Object.defineProperty(hostile, "toJSON", {
			value: () => {
				throw new Error("no");
			},
		});
		assert.strictEqual(ErrorText.describe(hostile), "[unprintable value]");
	});
});

describe("ErrorText.causeMessage", () => {
	it("joins the chain nearest first, skipping text already spliced", () => {
		const driver = new Error("SQLITE_BUSY: database is locked");
		const outer = new Error("Failed to execute statement", {
			cause: new Error("Failed to execute statement", { cause: driver }),
		});
		assert.strictEqual(ErrorText.causeMessage(outer), "Failed to execute statement: SQLITE_BUSY: database is locked");
		assert.strictEqual(ErrorText.causeMessage({}), undefined);
		assert.strictEqual(ErrorText.causeMessage("thrown"), "thrown");
	});
});

describe("ErrorText.of", () => {
	it("is the cause chain's text when it has one", () => {
		const outer = new Error("load failed", { cause: new Error("ENOENT: no such file") });
		assert.strictEqual(ErrorText.of(outer), "load failed: ENOENT: no such file");
		assert.strictEqual(ErrorText.of("thrown"), "thrown");
	});

	it("falls back to describe when nothing along the chain has a message", () => {
		assert.strictEqual(ErrorText.of({ code: 7 }), '{"code":7}');
		assert.strictEqual(ErrorText.of(42), "42");
		assert.strictEqual(ErrorText.of(undefined), "undefined");
		assert.strictEqual(ErrorText.of(new Error("")), "");
	});

	it("is exactly causeMessage ?? describe, and never throws", () => {
		const throwingMessage = Object.defineProperty({}, "message", {
			get() {
				throw new Error("no");
			},
		});
		const noPrototype = Object.create(null) as object;
		for (const value of [throwingMessage, noPrototype, { message: "  " }, new Error("x", { cause: 1 })]) {
			assert.strictEqual(
				ErrorText.of(value),
				ErrorText.causeMessage(value) ?? ErrorText.describe(value),
				ErrorText.describe(value),
			);
		}
		assert.strictEqual(ErrorText.of(throwingMessage), "{}");
		assert.strictEqual(ErrorText.of(noPrototype), "{}");
	});
});
