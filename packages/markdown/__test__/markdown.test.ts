// The `Markdown` facade: the pure `parseResult` primitive, the `Effect`
// `parse` defined in terms of it, the options default, the `MarkdownFromString`
// codec, and the two invariants that hold for EVERY input — parse never
// throws, and every position is inside the source.
//
// The guard tests here assert MATERIALIZATION, not detection: that the
// engine's `GuardExceeded` carrier becomes a typed `MarkdownParseError`
// carrying a positioned diagnostic. Detection itself is covered by
// `hardening.test.ts` at the carrier layer.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { FastCheck as fc } from "effect/testing";
import { MAX_NESTING_DEPTH } from "../src/internal/limits.js";
import { Markdown, MarkdownParseError, MarkdownParseOptions } from "../src/Markdown.js";
import type { MarkdownNode } from "../src/MarkdownNode.js";
import { Paragraph, Root } from "../src/MarkdownNode.js";

/** An input nesting containers past the cap: the block pass's guard trip. */
const nestingBomb = `${">".repeat(MAX_NESTING_DEPTH + 44)} foo\n`;

/**
 * An input tripping the guard from the OTHER throw site — the inline pass's
 * emphasis materialization rather than the block pass's container stack.
 * Delimiters pair two at a time, so the run has to exceed twice the cap
 * before the nesting it would build does.
 */
const emphasisBomb = `${"*".repeat(2 * MAX_NESTING_DEPTH + 20)}a${"*".repeat(2 * MAX_NESTING_DEPTH + 20)}`;

/** Walk every node of a tree, children-first-agnostic, yielding each node. */
const walk = (node: MarkdownNode, visit: (n: MarkdownNode) => void): void => {
	visit(node);
	const children = (node as { readonly children?: ReadonlyArray<MarkdownNode> }).children;
	if (children !== undefined) {
		for (const child of children) {
			walk(child, visit);
		}
	}
};

describe("Markdown.parseResult", () => {
	it("succeeds with a Root tree", () => {
		const result = Markdown.parseResult("# Title\n\nBody *text*.\n");
		assert.isTrue(Result.isSuccess(result));
		if (Result.isFailure(result)) return;
		const root = result.success;
		assert.instanceOf(root, Root);
		assert.strictEqual(root.type, "root");
		assert.deepStrictEqual(
			root.children.map((child) => child.type),
			["heading", "paragraph"],
		);
	});

	it("succeeds on the empty document", () => {
		const result = Markdown.parseResult("");
		assert.isTrue(Result.isSuccess(result));
		if (Result.isFailure(result)) return;
		assert.deepStrictEqual(result.success.children, []);
	});

	it("materializes a tripped guard as a typed MarkdownParseError", () => {
		const result = Markdown.parseResult(nestingBomb);
		assert.isTrue(Result.isFailure(result));
		if (Result.isSuccess(result)) return;
		const error = result.failure;
		assert.instanceOf(error, MarkdownParseError);
		assert.strictEqual(error._tag, "MarkdownParseError");
		assert.strictEqual(error.diagnostic.code, "NestingDepthExceeded");
	});

	it("materializes an inline-pass guard trip the same way as a block-pass one", () => {
		// Same typed outcome from a different throw site: the facade must not
		// have learned only the block pass's shape of carrier.
		const result = Markdown.parseResult(emphasisBomb);
		assert.isTrue(Result.isFailure(result));
		if (Result.isSuccess(result)) return;
		assert.instanceOf(result.failure, MarkdownParseError);
		assert.strictEqual(result.failure.diagnostic.code, "NestingDepthExceeded");
	});

	it("derives the position of an inline-pass guard trip from its offset", () => {
		const result = Markdown.parseResult(`para\n\n${emphasisBomb}`);
		assert.isTrue(Result.isFailure(result));
		if (Result.isSuccess(result)) return;
		const { line, character, offset } = result.failure.diagnostic;
		// Third line (zero-based 2), and the offset accounts for the two
		// preceding lines while `character` is measured from the line start.
		assert.strictEqual(line, 2);
		assert.isAbove(character, 0);
		assert.strictEqual(offset, character + "para\n\n".length);
	});

	it("populates line and character on the guard diagnostic", () => {
		const result = Markdown.parseResult(`a\n\n${nestingBomb}`);
		assert.isTrue(Result.isFailure(result));
		if (Result.isSuccess(result)) return;
		const { offset, line, character } = result.failure.diagnostic;
		// Derived from the offset against the source, so the trip on line 3
		// (zero-based 2) reports there and not at the document start.
		assert.strictEqual(line, 2);
		assert.isAbove(character, 0);
		assert.isAbove(offset, 0);
	});

	it("names the code, position and message in the error message", () => {
		const result = Markdown.parseResult(nestingBomb);
		if (Result.isSuccess(result)) {
			assert.fail("expected the nesting bomb to fail");
			return;
		}
		assert.include(result.failure.message, "NestingDepthExceeded");
	});

	it("rethrows a non-carrier as a defect rather than converting it", () => {
		// The defect-passthrough invariant: only the engine's own carriers
		// become typed failures. A programmer error inside a construct — here
		// a plain Error thrown from the node constructor the block pass calls
		// — must escape untouched, never be laundered into MarkdownParseError.
		const original = Paragraph.make;
		const boom = new Error("boom: a programmer error, not a carrier");
		Object.defineProperty(Paragraph, "make", {
			configurable: true,
			writable: true,
			value: () => {
				throw boom;
			},
		});
		try {
			assert.throws(() => Markdown.parseResult("a paragraph\n"), /boom: a programmer error/);
		} finally {
			Object.defineProperty(Paragraph, "make", { configurable: true, writable: true, value: original });
		}
		// And the seam really is restored — otherwise the assertion above is vacuous.
		assert.isTrue(Result.isSuccess(Markdown.parseResult("a paragraph\n")));
	});
});

describe("Markdown.parse", () => {
	it.effect("succeeds with the same tree parseResult returns", () =>
		Effect.gen(function* () {
			const source = "# Title\n\n- a\n- b\n\n[x]: /u\n";
			const viaEffect = yield* Markdown.parse(source);
			const viaResult = Markdown.parseResult(source);
			assert.isTrue(Result.isSuccess(viaResult));
			if (Result.isFailure(viaResult)) return;
			assert.deepStrictEqual(viaEffect, viaResult.success);
		}),
	);

	it.effect("fails with the same error parseResult fails with", () =>
		Effect.gen(function* () {
			const viaEffect = yield* Effect.result(Markdown.parse(nestingBomb));
			const viaResult = Markdown.parseResult(nestingBomb);
			assert.isTrue(Result.isFailure(viaEffect));
			assert.isTrue(Result.isFailure(viaResult));
			if (Result.isSuccess(viaEffect) || Result.isSuccess(viaResult)) return;
			assert.deepStrictEqual(viaEffect.failure, viaResult.failure);
		}),
	);

	it.effect("surfaces a non-carrier throw as a defect, not a typed failure", () =>
		Effect.gen(function* () {
			const original = Paragraph.make;
			Object.defineProperty(Paragraph, "make", {
				configurable: true,
				writable: true,
				value: () => {
					throw new Error("boom: a programmer error, not a carrier");
				},
			});
			const exit = yield* Effect.exit(Markdown.parse("a paragraph\n"));
			Object.defineProperty(Paragraph, "make", { configurable: true, writable: true, value: original });
			assert.isTrue(exit._tag === "Failure");
			if (exit._tag !== "Failure") return;
			// A die, not a typed fail: no MarkdownParseError anywhere in the cause.
			const rendered = String(exit.cause);
			assert.include(rendered, "boom: a programmer error");
			assert.notInclude(rendered, "MarkdownParseError");
		}),
	);
});

describe("MarkdownParseOptions", () => {
	// A construct only the gfm dialect parses: under commonmark the tildes
	// stay literal text, under gfm they become a `delete` node.
	const gfmMarker = "~~struck~~\n";

	const firstChildTypes = (result: Result.Result<Root, MarkdownParseError>): ReadonlyArray<string> => {
		if (Result.isFailure(result)) {
			assert.fail("expected the parse to succeed");
		}
		const paragraph = result.success.children[0];
		assert.instanceOf(paragraph, Paragraph);
		return paragraph.children.map((child) => child.type);
	};

	it("defaults the dialect to gfm when options are omitted", () => {
		const implicit = Markdown.parseResult(gfmMarker);
		const explicit = Markdown.parseResult(gfmMarker, MarkdownParseOptions.make({ dialect: "gfm" }));
		const empty = Markdown.parseResult(gfmMarker, MarkdownParseOptions.make({}));
		assert.deepStrictEqual(firstChildTypes(implicit), ["delete"]);
		if (Result.isFailure(implicit) || Result.isFailure(explicit) || Result.isFailure(empty)) {
			assert.fail("expected every options form to parse");
			return;
		}
		assert.deepStrictEqual(explicit.success, implicit.success);
		assert.deepStrictEqual(empty.success, implicit.success);
	});

	it("honors an explicit commonmark dialect by disabling every extension", () => {
		const commonmark = Markdown.parseResult(gfmMarker, MarkdownParseOptions.make({ dialect: "commonmark" }));
		assert.deepStrictEqual(firstChildTypes(commonmark), ["text"]);
	});

	it("admits both dialect literals and rejects anything else, typed", () => {
		const decode = Schema.decodeUnknownResult(MarkdownParseOptions);
		assert.isTrue(Result.isSuccess(decode({ dialect: "gfm" })));
		assert.isTrue(Result.isSuccess(decode({ dialect: "commonmark" })));
		assert.isTrue(Result.isFailure(decode({ dialect: "markdown-extra" })));
	});
});

describe("Markdown.MarkdownFromString", () => {
	const decode = Schema.decodeUnknownEffect(Markdown.MarkdownFromString);
	const encode = Schema.encodeEffect(Markdown.MarkdownFromString);

	it.effect("decodes markdown source into a Root", () =>
		Effect.gen(function* () {
			const root = yield* decode("para *em*\n");
			assert.instanceOf(root, Root);
			assert.deepStrictEqual(
				root.children.map((child) => child.type),
				["paragraph"],
			);
		}),
	);

	it.effect("fails to decode a non-string", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(decode(42));
			assert.isTrue(Result.isFailure(result));
		}),
	);

	it.effect("fails to encode until stringify lands in P4", () =>
		Effect.gen(function* () {
			const root = yield* decode("para\n");
			const result = yield* Effect.result(encode(root));
			assert.isTrue(Result.isFailure(result));
			if (Result.isSuccess(result)) return;
			assert.include(String(result.failure), "stringify");
		}),
	);
});

describe("Markdown parse invariants", () => {
	/**
	 * Unicode-hostile text: lone surrogates (unpaired halves that break naive
	 * code-point scanning), U+0000 (preprocessed to U+FFFD), every line
	 * terminator form, the markdown punctuation set, and full-plane unicode
	 * via the `binary` unit, which emits astral code points.
	 */
	const hostileText = fc.array(
		fc.oneof(
			fc.constantFrom("\u0000", "\uD800", "\uDFFF", "\uFFFD", "\r\n", "\r", "\n", "\t", " "),
			fc.constantFrom("#", "*", "_", "`", ">", "-", "[", "]", "(", ")", "!", "\\", "~", "<", "&", "|"),
			fc.string({ maxLength: 8 }),
			fc.string({ unit: "binary", maxLength: 8 }),
		),
		{ maxLength: 40 },
	);

	it("never throws, whatever the input", () => {
		fc.assert(
			fc.property(hostileText, (parts) => {
				const text = parts.join("");
				const result = Markdown.parseResult(text);
				// Failure is legal (a guard trip); a throw is not.
				return Result.isSuccess(result) || Result.isFailure(result);
			}),
			{ numRuns: 250 },
		);
	});

	it("never throws on a large input", () => {
		const large = "para *em* [ref][a] `code`\n\n".repeat(20_000);
		assert.isAbove(large.length, 500_000);
		const result = Markdown.parseResult(large);
		assert.isTrue(Result.isSuccess(result));
	});

	it("keeps every node position inside the source", () => {
		fc.assert(
			fc.property(hostileText, (parts) => {
				const text = parts.join("");
				const result = Markdown.parseResult(text);
				if (Result.isFailure(result)) return true;
				let ok = true;
				walk(result.success, (node) => {
					const { start, end } = node.position;
					if (!(start.offset >= 0 && start.offset <= end.offset && end.offset <= text.length)) {
						ok = false;
					}
				});
				return ok;
			}),
			{ numRuns: 250 },
		);
	});

	it("keeps every node position inside the source for a realistic document", () => {
		const source = [
			"# Title",
			"",
			"Body with *em*, **strong**, `code`, <https://example.com> and [ref][a].",
			"",
			"> quoted",
			"> - a",
			"> - b",
			"",
			"```ts",
			"const x = 1;",
			"```",
			"",
			'[a]: /url "title"',
			"",
		].join("\n");
		const result = Markdown.parseResult(source);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isFailure(result)) return;
		let count = 0;
		walk(result.success, (node) => {
			count++;
			const { start, end } = node.position;
			assert.isAtLeast(start.offset, 0);
			assert.isAtMost(start.offset, end.offset);
			assert.isAtMost(end.offset, source.length);
		});
		// Guard against a silently-empty walk.
		assert.isAbove(count, 15);
	});
});
