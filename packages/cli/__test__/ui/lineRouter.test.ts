// The pure half of CliUi.routeStream: no stream, a recording printer and a recording write.
import { assert, describe, it } from "@effect/vitest";
import type { LineRouterOptions } from "../../src/ui/internal/lineRouter.js";
import { makeLineRouter } from "../../src/ui/internal/lineRouter.js";

const harness = (overrides: Partial<LineRouterOptions> & { readonly accept?: boolean } = {}) => {
	const printed: Array<string> = [];
	const written: Array<string> = [];
	let accept = overrides.accept ?? true;
	const router = makeLineRouter({
		stream: "stderr",
		printer: (stream, line) => {
			assert.strictEqual(stream, "stderr");
			if (accept) printed.push(line);
			return accept;
		},
		write: (chunk) => written.push(chunk),
		maxHeld: 8192,
		carriageReturn: "keep",
		...overrides,
	});
	return {
		router,
		printed,
		written,
		text: () => written.join(""),
		setAccept: (value: boolean) => {
			accept = value;
		},
	};
};

describe("lineRouter", () => {
	it("offers each complete line to the printer and holds the rest", () => {
		const h = harness();
		h.router.take("one\ntw");
		h.router.take("o\nthree");
		assert.deepStrictEqual(h.printed, ["one", "two"]);
		assert.deepStrictEqual(h.written, []);
		h.router.flush();
		assert.deepStrictEqual(h.printed, ["one", "two", "three"]);
	});

	it("writes a line the printer declines to the original, with its line break", () => {
		const h = harness({ accept: false });
		h.router.take("a\nb\n");
		assert.deepStrictEqual(h.printed, []);
		assert.strictEqual(h.text(), "a\nb\n");
	});

	it("decodes UTF-8 split across two writes", () => {
		const h = harness();
		const bytes = new TextEncoder().encode("日本\n");
		h.router.take(bytes.slice(0, 4));
		h.router.take(bytes.slice(4));
		assert.deepStrictEqual(h.printed, ["日本"]);
	});

	it("passes an escape-only write straight through, as written, when nothing is held", () => {
		const h = harness();
		h.router.take("\u001b[?25l");
		assert.deepStrictEqual(h.written, ["\u001b[?25l"]);
		assert.deepStrictEqual(h.printed, []);
	});

	it("holds an escape-only write that arrives mid-line with the line", () => {
		const h = harness();
		h.router.take("abc");
		h.router.take("\u001b[31m");
		h.router.take("d\n");
		assert.deepStrictEqual(h.printed, ["abc\u001b[31md"]);
		assert.deepStrictEqual(h.written, []);
	});

	it("offers held text past maxHeld as a line of its own, and holds text of exactly maxHeld", () => {
		const past = harness({ maxHeld: 4 });
		past.router.take("abcde");
		assert.deepStrictEqual(past.printed, ["abcde"], "one past the cap is offered");
		const at = harness({ maxHeld: 4 });
		at.router.take("abcd");
		assert.deepStrictEqual(at.printed, [], "exactly the cap is still held");
		at.router.take("\n");
		assert.deepStrictEqual(at.printed, ["abcd"]);
	});

	it("accumulates writes with no line break across the cap, and offers them once as one line", () => {
		const h = harness({ maxHeld: 4 });
		h.router.take("ab");
		h.router.take("cd");
		assert.deepStrictEqual(h.printed, [], "four held characters are the cap, not past it");
		h.router.take("e");
		assert.deepStrictEqual(h.printed, ["abcde"]);
		h.router.take("f\n");
		assert.deepStrictEqual(h.printed, ["abcde", "f"], "the hold starts afresh after the cap");
	});

	it("text that does not start with an escape is held as a line, even when an escape follows", () => {
		const h = harness();
		h.router.take("x\u001b[0m");
		assert.deepStrictEqual(h.written, []);
		h.router.take("\n");
		assert.deepStrictEqual(h.printed, ["x\u001b[0m"]);
	});

	it("an escape-only write that ends in half a character writes only the escape, and the character arrives once", () => {
		const h = harness();
		const kanji = new TextEncoder().encode("日");
		const hide = new TextEncoder().encode("\u001b[?25l");
		h.router.take(new Uint8Array([...hide, ...kanji.slice(0, 1)]));
		assert.strictEqual(h.text(), "\u001b[?25l", "no raw lead byte reaches the original");
		h.router.take(new Uint8Array([...kanji.slice(1), 0x0a]));
		assert.deepStrictEqual(h.printed, ["日"]);
		assert.strictEqual(h.text(), "\u001b[?25l");
	});

	it("with routing off, a character split across two writes reaches the original once and whole", () => {
		const h = harness();
		h.router.route(false);
		const bytes = new TextEncoder().encode("日本\n");
		h.router.take(bytes.slice(0, 4));
		h.router.take(bytes.slice(4));
		assert.strictEqual(h.text(), "日本\n");
		assert.notInclude(h.text(), "\uFFFD");
	});

	it("flush drains the decoder: a partial character at the end is offered as U+FFFD, never kept for later", () => {
		const h = harness();
		const kanji = new TextEncoder().encode("日");
		h.router.take(new Uint8Array([0x61, 0x62, ...kanji.slice(0, 2)]));
		h.router.flush();
		assert.deepStrictEqual(h.printed, ["ab\uFFFD"]);
		h.router.take(new Uint8Array([...kanji.slice(2), 0x0a]));
		assert.deepStrictEqual(h.printed, ["ab\uFFFD", "\uFFFD"], "the orphaned tail is not glued onto a character");
	});

	it("drops a CRLF's carriage return for the printer but writes the original line as it came", () => {
		const h = harness();
		h.router.take("a\r\n");
		assert.deepStrictEqual(h.printed, ["a"]);
		h.setAccept(false);
		h.router.take("b\r\n");
		assert.strictEqual(h.text(), "b\r\n");
	});

	it("keeps an inner carriage return by default, and keeps only the last segment under `last`", () => {
		const keep = harness();
		keep.router.take("10%\r50%\r100%\n");
		assert.deepStrictEqual(keep.printed, ["10%\r50%\r100%"]);
		const last = harness({ carriageReturn: "last" });
		last.router.take("10%\r50%\r100%\n");
		assert.deepStrictEqual(last.printed, ["100%"]);
	});

	it("route(false) writes the held text to the original and passes later writes through as written", () => {
		const h = harness();
		h.router.take("held");
		h.router.route(false);
		assert.strictEqual(h.text(), "held");
		h.router.take("x\ny\n");
		assert.strictEqual(h.text(), "heldx\ny\n");
		assert.deepStrictEqual(h.printed, []);
		h.router.route(true);
		h.router.take("z\n");
		assert.deepStrictEqual(h.printed, ["z"]);
	});

	it("flush writes the held text to the original when the printer declines it", () => {
		const h = harness({ accept: false });
		h.router.take("tail");
		h.router.flush();
		assert.strictEqual(h.text(), "tail");
		h.router.flush();
		assert.strictEqual(h.text(), "tail", "a second flush writes nothing");
	});

	it("taps every piece of text, decoded, before routing", () => {
		const seen: Array<string> = [];
		const h = harness({ onText: (text) => seen.push(text) });
		h.router.take(new TextEncoder().encode("a\n"));
		h.router.take("\u001b[2J");
		assert.deepStrictEqual(seen, ["a\n", "\u001b[2J"]);
	});
});
