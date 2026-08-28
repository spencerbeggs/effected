import { assert, describe, it } from "@effect/vitest";
import { createScanner } from "../src/internal/scanner.js";

describe("createScanner", () => {
	it("does not duplicate the buffered prefix when an unterminated string ends with a trailing backslash", () => {
		const scanner = createScanner('"abc\\');
		assert.strictEqual(scanner.scan(), "String");
		assert.strictEqual(scanner.getTokenValue(), "abc");
		assert.strictEqual(scanner.getTokenError(), "UnexpectedEndOfString");
	});

	it("recovers an empty value for an unterminated string containing only a trailing backslash", () => {
		const scanner = createScanner('"\\');
		assert.strictEqual(scanner.scan(), "String");
		assert.strictEqual(scanner.getTokenValue(), "");
		assert.strictEqual(scanner.getTokenError(), "UnexpectedEndOfString");
	});

	it("preserves prior decoded escapes when a later trailing backslash terminates the string", () => {
		const scanner = createScanner('"a\\nb\\');
		assert.strictEqual(scanner.scan(), "String");
		assert.strictEqual(scanner.getTokenValue(), "a\nb");
		assert.strictEqual(scanner.getTokenError(), "UnexpectedEndOfString");
	});
});
