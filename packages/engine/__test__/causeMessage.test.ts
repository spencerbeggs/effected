// The kit's one guarded cause-message read, exercised against the inputs that
// told the per-package variants apart: a cross-realm-like plain `{ message }`
// object (fails `instanceof Error`), an empty message, a thrown string, a
// nested chain joined nearest first without repeating spliced text, and a cycle.
// The module is copied verbatim from okf/conventions/error-standards.md into
// every package, so this suite is too.

import { assert, describe, it } from "@effect/vitest";
import { causeMessage } from "../src/internal/causeMessage.js";

describe("causeMessage", () => {
	it("reads an Error's message", () => {
		assert.strictEqual(causeMessage(new Error("boom")), "boom");
	});

	it("reads a plain { message } object, as a cross-realm Error presents", () => {
		const foreign = { name: "Error", message: "from another realm", stack: "Error: from another realm" };
		assert.isFalse(foreign instanceof Error);
		assert.strictEqual(causeMessage(foreign), "from another realm");
	});

	it("reads a thrown string", () => {
		assert.strictEqual(causeMessage("thrown text"), "thrown text");
	});

	it("treats an empty or whitespace-only message as none", () => {
		assert.isUndefined(causeMessage(new Error("")));
		assert.isUndefined(causeMessage(new Error("   ")));
		assert.isUndefined(causeMessage({ message: "" }));
		assert.isUndefined(causeMessage(""));
	});

	it("ignores a non-string message and a cause with none", () => {
		assert.isUndefined(causeMessage({ message: 42 }));
		assert.isUndefined(causeMessage({ code: "ENOENT" }));
		assert.isUndefined(causeMessage(42));
		assert.isUndefined(causeMessage(null));
		assert.isUndefined(causeMessage(undefined));
	});

	it("joins the cause chain's messages nearest first, so a driver's generic summary keeps the database's detail", () => {
		const inner = new Error("UNIQUE constraint failed: t.id");
		const outer = new Error("Failed to execute statement", { cause: inner });
		assert.strictEqual(causeMessage(outer), "Failed to execute statement: UNIQUE constraint failed: t.id");
	});

	it("walks through a plain-object link and a string leaf", () => {
		const outer = new Error("wrapper", { cause: { message: "middle", cause: "leaf" } });
		assert.strictEqual(causeMessage(outer), "wrapper: middle: leaf");
	});

	it("does not repeat a deeper message the nearer one already splices, so a composed remediation survives intact", () => {
		const spawn = new Error("spawn pnpm ENOENT");
		const fetch = new Error("fetching x failed: spawn pnpm ENOENT", { cause: spawn });
		const outer = new Error("x is not installed (fetching x failed: spawn pnpm ENOENT); run pnpm add --config x", {
			cause: fetch,
		});
		assert.strictEqual(causeMessage(outer), outer.message);
	});

	it("takes a deeper message that contains the nearer one instead of repeating it", () => {
		assert.strictEqual(causeMessage(new Error("boom", { cause: new Error("boom: detail") })), "boom: detail");
	});

	it("keeps the nearest message when the deeper nodes carry none", () => {
		const outer = new Error("specific enough", { cause: new Error("", { cause: { code: "EIO" } }) });
		assert.strictEqual(causeMessage(outer), "specific enough");
	});

	it("terminates on a cyclic chain and keeps a message it found", () => {
		const loop = new Error("looping");
		loop.cause = loop;
		assert.strictEqual(causeMessage(loop), "looping");
		const node: Record<string, unknown> = { name: "loop" };
		node.cause = node;
		assert.isUndefined(causeMessage(node));
	});

	it("stops reading past the depth bound", () => {
		let chain: unknown = new Error("too deep");
		for (let depth = 0; depth < 12; depth++) chain = new Error("", { cause: chain });
		assert.isUndefined(causeMessage(chain), "a message twelve links down is out of reach");
		let near: unknown = new Error("within reach");
		for (let depth = 0; depth < 6; depth++) near = new Error("", { cause: near });
		assert.strictEqual(causeMessage(near), "within reach");
	});

	it("never throws on a throwing `message` getter: that link has no text, the walk goes on", () => {
		const hostile = {
			get message(): string {
				throw new Error("hostile message");
			},
			cause: new Error("deeper"),
		};
		assert.strictEqual(causeMessage(hostile), "deeper");
		assert.strictEqual(
			causeMessage({
				get message(): string {
					throw new Error("hostile message");
				},
			}),
			undefined,
		);
	});

	it("never throws on a throwing `cause` getter: the walk ends with what it found", () => {
		const hostile = {
			message: "near",
			get cause(): unknown {
				throw new Error("hostile cause");
			},
		};
		assert.strictEqual(causeMessage(hostile), "near");
	});

	it("never throws on a throwing getter deep in the chain, keeping the text above it", () => {
		const bad = {
			get message(): string {
				throw new Error("hostile message");
			},
			get cause(): unknown {
				throw new Error("hostile cause");
			},
		};
		const outer = new Error("top", { cause: new Error("middle", { cause: bad }) });
		assert.strictEqual(causeMessage(outer), "top: middle");
	});

	it("never throws on a proxy whose `has` trap throws", () => {
		const proxy = new Proxy(
			{},
			{
				has() {
					throw new Error("hostile has");
				},
			},
		);
		assert.isUndefined(causeMessage(proxy));
	});
});
