import { assert, describe, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import {
	InvalidData,
	JournalClosed,
	JournalNotFound,
	JournalResync,
	LineSlice,
	MalformedLine,
	TerminalViolation,
	UnknownEvent,
	UnserializableData,
} from "../src/index.js";

/**
 * Every error's `message` getter is exercised.
 *
 * Not a coverage exercise. A `message` getter is the one piece of an error that
 * runs at the moment something has already gone wrong — usually inside a
 * reporter — so a throw there converts a legible failure into an unreadable
 * one. This branch paid for that shape once already, when a test-runner SDK
 * crashed recording an error and made a failing test impossible to read.
 */

const slice = new LineSlice({ offset: 12, end: 20, length: 7, text: '{"a":1}', terminated: true });

/** A real `SchemaError`, obtained the way the package obtains one. */
const schemaError = (() => {
	const decoded = Schema.decodeUnknownResult(Schema.Struct({ n: Schema.Number }))({ n: "no" });
	assert.isTrue(Result.isFailure(decoded));
	return (decoded as Extract<typeof decoded, { readonly _tag: "Failure" }>).failure;
})();

describe("error messages render", () => {
	it("MalformedLine", () => {
		assert.include(new MalformedLine({ line: slice }).message, "12");
	});

	it("UnknownEvent", () => {
		assert.include(new UnknownEvent({ line: slice, event: "ghost", known: ["a"] }).message, "ghost");
	});

	it("InvalidData", () => {
		const error = new InvalidData({ line: slice, event: Option.some("noted"), error: schemaError });
		assert.include(error.message, "noted");
	});

	it("InvalidData with no event names the envelope", () => {
		const error = new InvalidData({ line: slice, event: Option.none(), error: schemaError });
		assert.include(error.message, "envelope");
	});

	it("UnserializableData", () => {
		const error = new UnserializableData({ event: "noted", cause: new TypeError("boom") });
		assert.include(error.message, "noted");
	});

	it("TerminalViolation", () => {
		assert.include(new TerminalViolation({ event: "noted", terminal: "ended" }).message, "ended");
	});

	it("JournalClosed", () => {
		assert.include(new JournalClosed({ event: "noted" }).message, "closed");
	});

	it("JournalNotFound", () => {
		assert.include(new JournalNotFound({ path: "/tmp/j.jsonl" }).message, "/tmp/j.jsonl");
	});

	it("JournalResync", () => {
		const error = new JournalResync({ path: "/tmp/j.jsonl", reason: "truncated", expected: 90, actual: 10 });
		assert.include(error.message, "truncated");
	});
});

describe("UnserializableData renders a CIRCULAR cause safely", () => {
	const circular = (): unknown => {
		const node: Record<string, unknown> = { name: "loop" };
		node.self = node;
		return node;
	};

	it("returns without throwing", () => {
		// The cause here is, by construction, the very value that could not be
		// serialized. Rendering it is the plausible "better diagnostics" change,
		// and it would reintroduce a throw inside an error's own accessor — at the
		// exact moment a reporter is trying to print the failure.
		const error = new UnserializableData({ event: "noted", cause: circular() });
		let threw: unknown;
		let rendered = "";
		try {
			rendered = error.message;
		} catch (caught) {
			threw = caught;
		}
		assert.isUndefined(threw, `message must not throw, but threw: ${String(threw)}`);
		assert.isString(rendered);
	});

	it("does NOT include the cause", () => {
		const error = new UnserializableData({ event: "noted", cause: circular() });
		assert.notInclude(error.message, "loop", "the cyclic cause is not rendered into the message");
		assert.include(error.message, "noted", "but the event tag still is");
	});
});
