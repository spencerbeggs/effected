// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/message-suppressor.test.ts on 2026-11-06
import { assert, describe, it } from "@effect/vitest";
import { createMessageSuppressor } from "../../src/meta/message-suppressor.js";

describe("createMessageSuppressor", () => {
	it("matches by messageId and regex pattern (AND)", () => {
		const s = createMessageSuppressor([{ messageId: "ae-forgotten-export", pattern: "_base" }]);
		assert.strictEqual(s.matches("ae-forgotten-export", 'The symbol "Foo_base" needs to be exported'), true);
		assert.strictEqual(s.matches("ae-forgotten-export", 'The symbol "Foo" needs to be exported'), false);
		assert.strictEqual(s.matches("ae-other", "Foo_base"), false);
	});

	it("falls back to substring when the pattern is not a valid regex", () => {
		const s = createMessageSuppressor([{ messageId: "x", pattern: "a[b" }]);
		assert.strictEqual(s.matches("x", "literal a[b here"), true);
		assert.strictEqual(s.matches("x", "no match"), false);
	});

	it("matches on messageId alone when no pattern is given", () => {
		const s = createMessageSuppressor([{ messageId: "ae-forgotten-export" }]);
		assert.strictEqual(s.matches("ae-forgotten-export", "anything"), true);
	});

	it("matches a pattern with no messageId across every id", () => {
		const s = createMessageSuppressor([{ pattern: "_base" }]);
		assert.strictEqual(s.matches("ae-forgotten-export", "Foo_base"), true);
		assert.strictEqual(s.matches("ae-other", "Foo_base"), true);
		assert.strictEqual(s.matches("ae-forgotten-export", "Foo"), false);
	});

	it("matches nothing for a rule with neither a messageId nor a pattern", () => {
		const s = createMessageSuppressor([{}]);
		assert.strictEqual(s.matches("ae-forgotten-export", "anything"), false);
	});
});
