// `MarkdownDocument`: the lossless unit — source, tree, materialized
// diagnostics and the definition index — plus the same parseResult/parse
// parity and guard-materialization contract the bare-tree facade holds.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { MAX_NESTING_DEPTH } from "../src/internal/limits.js";
import { MarkdownDiagnostic } from "../src/MarkdownDiagnostic.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { Definition, Root } from "../src/MarkdownNode.js";

const nestingBomb = `${">".repeat(MAX_NESTING_DEPTH + 44)} foo\n`;

const source = ["# Title", "", "See [ref][a] and [b].", "", '[a]: /a "A"', "[B]: /b", ""].join("\n");

describe("MarkdownDocument.parseResult", () => {
	it("retains the exact source it parsed", () => {
		const result = MarkdownDocument.parseResult(source);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isFailure(result)) return;
		assert.strictEqual(result.success.source, source);
	});

	it("carries the parsed Root tree", () => {
		const result = MarkdownDocument.parseResult(source);
		if (Result.isFailure(result)) {
			assert.fail("expected the document to parse");
			return;
		}
		assert.instanceOf(result.success.root, Root);
		assert.deepStrictEqual(
			result.success.root.children.map((child) => child.type),
			["heading", "paragraph", "definition", "definition"],
		);
	});

	it("indexes the link-reference definitions by case-folded label", () => {
		const result = MarkdownDocument.parseResult(source);
		if (Result.isFailure(result)) {
			assert.fail("expected the document to parse");
			return;
		}
		const { definitions } = result.success;
		// A real Map, not an object: link labels are attacker-controlled, so
		// the index must not be prototype-pollutable.
		assert.instanceOf(definitions, Map);
		assert.strictEqual(definitions.size, 2);
		for (const definition of definitions.values()) {
			assert.instanceOf(definition, Definition);
		}
		// Labels fold case, so `[a]` and `[B]` land under one normalized key each.
		const urls = [...definitions.values()].map((definition) => definition.url).sort();
		assert.deepStrictEqual(urls, ["/a", "/b"]);
	});

	it("keeps the definitions in the tree as well as the index", () => {
		const result = MarkdownDocument.parseResult(source);
		if (Result.isFailure(result)) {
			assert.fail("expected the document to parse");
			return;
		}
		const inTree = result.success.root.children.filter((child) => child.type === "definition");
		assert.strictEqual(inTree.length, 2);
	});

	it("reports no diagnostics, because P1 has no producers of them yet", () => {
		// Not a coverage gap: the engine's carrier array is empty for every
		// input the P1 parser accepts, since no construct emits a non-fatal
		// diagnostic yet (they arrive with unresolved link references and P3
		// frontmatter). The materialization path from carriers to this field
		// is exercised by `materializes the carriers it is given` below, which
		// does not depend on a producer existing.
		const result = MarkdownDocument.parseResult(source);
		if (Result.isFailure(result)) {
			assert.fail("expected the document to parse");
			return;
		}
		assert.deepStrictEqual(result.success.diagnostics, []);
	});

	it("materializes the carriers it is given, deriving line and character", () => {
		// The producers are absent, so drive the materialization directly:
		// this is the exact transformation `parseResult` applies to each
		// carrier, and it is what will light up when producers land.
		const text = "alpha\nbravo charlie\n";
		const diagnostic = MarkdownDiagnostic.fromRaw(text, {
			code: "NestingDepthExceeded",
			message: "synthetic carrier",
			offset: text.indexOf("charlie"),
			length: 7,
		});
		assert.strictEqual(diagnostic.line, 1);
		assert.strictEqual(diagnostic.character, "bravo ".length);
		assert.strictEqual(diagnostic.message, "synthetic carrier");
		assert.strictEqual(diagnostic.length, 7);
	});

	it("prototype pollution through a reference label leaves Object.prototype untouched", () => {
		const result = MarkdownDocument.parseResult('[__proto__]: /x "polluted"\n\n[__proto__]\n');
		if (Result.isFailure(result)) {
			assert.fail("expected the document to parse");
			return;
		}
		assert.isUndefined(Object.getOwnPropertyDescriptor(Object.prototype, "polluted"));
		assert.strictEqual(Object.prototype.constructor, Object);
		assert.strictEqual(result.success.definitions.size, 1);
	});

	it("materializes a tripped guard as a typed MarkdownParseError", () => {
		const result = MarkdownDocument.parseResult(nestingBomb);
		assert.isTrue(Result.isFailure(result));
		if (Result.isSuccess(result)) return;
		assert.strictEqual(result.failure._tag, "MarkdownParseError");
		assert.strictEqual(result.failure.diagnostic.code, "NestingDepthExceeded");
	});

	it("parses the empty document", () => {
		const result = MarkdownDocument.parseResult("");
		if (Result.isFailure(result)) {
			assert.fail("expected the empty document to parse");
			return;
		}
		assert.strictEqual(result.success.source, "");
		assert.deepStrictEqual(result.success.root.children, []);
		assert.strictEqual(result.success.definitions.size, 0);
	});
});

describe("MarkdownDocument.parse", () => {
	it.effect("agrees with parseResult on the success channel", () =>
		Effect.gen(function* () {
			const viaEffect = yield* MarkdownDocument.parse(source);
			const viaResult = MarkdownDocument.parseResult(source);
			if (Result.isFailure(viaResult)) {
				assert.fail("expected the document to parse");
				return;
			}
			assert.deepStrictEqual(viaEffect, viaResult.success);
		}),
	);

	it.effect("agrees with parseResult on the failure channel", () =>
		Effect.gen(function* () {
			const viaEffect = yield* Effect.result(MarkdownDocument.parse(nestingBomb));
			const viaResult = MarkdownDocument.parseResult(nestingBomb);
			assert.isTrue(Result.isFailure(viaEffect));
			assert.isTrue(Result.isFailure(viaResult));
			if (Result.isSuccess(viaEffect) || Result.isSuccess(viaResult)) return;
			assert.deepStrictEqual(viaEffect.failure, viaResult.failure);
		}),
	);

	it.effect("honors an explicit commonmark dialect the same as the default", () =>
		Effect.gen(function* () {
			const implicit = yield* MarkdownDocument.parse(source);
			const explicit = yield* MarkdownDocument.parse(source, { dialect: "commonmark" });
			assert.deepStrictEqual(explicit, implicit);
		}),
	);
});

describe("MarkdownDocument schema", () => {
	it("round-trips a parsed document through its own schema", () => {
		const result = MarkdownDocument.parseResult(source);
		if (Result.isFailure(result)) {
			assert.fail("expected the document to parse");
			return;
		}
		const encoded = Schema.encodeUnknownSync(MarkdownDocument)(result.success);
		const decoded = Schema.decodeUnknownSync(MarkdownDocument)(encoded);
		assert.strictEqual(decoded.source, result.success.source);
		assert.strictEqual(decoded.definitions.size, result.success.definitions.size);
		assert.deepStrictEqual(
			decoded.root.children.map((child) => child.type),
			result.success.root.children.map((child) => child.type),
		);
	});
});
