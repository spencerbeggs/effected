import { assert, describe, it } from "@effect/vitest";
import { Duration } from "effect";
import { Doc, Fmt, Render } from "../src/index.js";

describe("Fmt.duration", () => {
	const cases: ReadonlyArray<readonly [number, string]> = [
		[0, "0ms"],
		[250, "250ms"],
		[999, "999ms"],
		[1000, "1s"],
		[1049, "1s"], // 1.049s rounds to 1.0, and a trailing .0 is dropped
		[1050, "1.1s"], // 1.050s rounds half up to 1.1
		[1200, "1.2s"],
		[2000, "2s"],
		[59_949, "59.9s"],
		[59_999, "1m"], // rounds up to a whole minute rather than printing "60s"
		[60_000, "1m"],
		[63_000, "1m 3s"],
		[120_000, "2m"],
		[3_599_999, "1h"], // rounds up to a whole hour rather than printing "60m"
		[3_600_000, "1h"],
		[3_660_000, "1h 1m"],
		[5_400_000, "1h 30m"],
		[7_200_000, "2h"],
		[7_260_000, "2h 1m"],
		[86_400_000, "24h"], // no days unit: hours keep counting
	];
	for (const [ms, expected] of cases) {
		it(`${ms}ms => ${expected}`, () => {
			assert.strictEqual(Fmt.duration(ms), expected);
		});
	}

	it("clamps a negative or non-finite input to 0ms", () => {
		assert.strictEqual(Fmt.duration(-5), "0ms");
		assert.strictEqual(Fmt.duration(Number.NaN), "0ms");
		assert.strictEqual(Fmt.duration(Number.POSITIVE_INFINITY), "0ms");
	});

	it("a fractional millisecond that rounds to 1000 is a second, not 1000ms", () => {
		assert.strictEqual(Fmt.duration(999.6), "1s");
	});

	it("a number is milliseconds used as given, never rounded through a Duration's nanoseconds", () => {
		// Duration rounds 999.4999999ms to 999_499_999.9 → 999_500_000ns, which would round up to "1s".
		assert.strictEqual(Fmt.duration(999.4999999), "999ms");
		assert.strictEqual(Fmt.duration(59_949.4999999), "59.9s");
	});

	it("accepts any Duration.Input", () => {
		assert.strictEqual(Fmt.duration(Duration.seconds(63)), "1m 3s");
		assert.strictEqual(Fmt.duration(Duration.millis(250)), "250ms");
		assert.strictEqual(Fmt.duration("2 seconds"), "2s");
		assert.strictEqual(Fmt.duration({ minutes: 1, seconds: 3 }), "1m 3s");
		assert.strictEqual(Fmt.duration([1, 500_000_000]), "1.5s");
		assert.strictEqual(Fmt.duration(1_500_000_000n), "1.5s"); // a bigint is nanoseconds
	});

	it("an infinite, negative or invalid Duration.Input is 0ms and never throws", () => {
		assert.strictEqual(Fmt.duration(Duration.infinity), "0ms");
		assert.strictEqual(Fmt.duration("-5 seconds"), "0ms");
		assert.strictEqual(Fmt.duration({ seconds: -3 }), "0ms");
		assert.strictEqual(Fmt.duration("bogus" as unknown as Duration.Input), "0ms");
	});
});

describe("Fmt.percent", () => {
	it("formats a ratio with one digit by default and drops a trailing zero decimal", () => {
		assert.strictEqual(Fmt.percent(0), "0%");
		assert.strictEqual(Fmt.percent(1), "100%");
		assert.strictEqual(Fmt.percent(0.8333), "83.3%");
		assert.strictEqual(Fmt.percent(0.5), "50%");
	});

	it("takes digits", () => {
		assert.strictEqual(Fmt.percent(0.8333, { digits: 0 }), "83%");
		assert.strictEqual(Fmt.percent(0.83333, { digits: 2 }), "83.33%");
		assert.strictEqual(Fmt.percent(0.5, { digits: 3 }), "50%");
	});

	it("never prints a negative zero", () => {
		assert.strictEqual(Fmt.percent(-0.00001), "0%");
	});
});

describe("Fmt.plural", () => {
	it("pluralises by count, with an irregular plural when given", () => {
		assert.strictEqual(Fmt.plural(0, "test"), "0 tests");
		assert.strictEqual(Fmt.plural(1, "test"), "1 test");
		assert.strictEqual(Fmt.plural(2, "test"), "2 tests");
		assert.strictEqual(Fmt.plural(1, "child", "children"), "1 child");
		assert.strictEqual(Fmt.plural(3, "child", "children"), "3 children");
	});
});

describe("Fmt.width", () => {
	it("measures display width", () => {
		assert.strictEqual(Fmt.width("hello"), 5);
		assert.strictEqual(Fmt.width("日本語"), 6);
		assert.strictEqual(Fmt.width("\x1b[31mred\x1b[0m"), 3);
	});
});

describe("Fmt.truncate", () => {
	it("cuts ASCII to the width with an ellipsis, result width <= width", () => {
		assert.strictEqual(Fmt.truncate("hello world", 8), "hello w…");
		assert.strictEqual(Fmt.width(Fmt.truncate("hello world", 8)), 8);
	});

	it("returns text that already fits unchanged", () => {
		assert.strictEqual(Fmt.truncate("hello", 5), "hello");
		assert.strictEqual(Fmt.truncate("hello", 10), "hello");
		assert.strictEqual(Fmt.truncate("", 3), "");
	});

	it("never produces half a wide character: CJK at an odd budget", () => {
		// "日本語" is 6 wide. Width 4 leaves 3 after the 1-wide ellipsis: one wide char (2) fits, a second (4) does not.
		const out = Fmt.truncate("日本語", 4);
		assert.strictEqual(out, "日…");
		assert.isAtMost(Fmt.width(out), 4);
		assert.strictEqual(Fmt.truncate("日本語日本語", 5), "日本…");
	});

	it("never splits an emoji ZWJ family", () => {
		const family = "👨‍👩‍👧";
		assert.strictEqual(Fmt.width(family), 2);
		// Room for the ellipsis and one column: the 2-wide family does not fit, so it is dropped whole.
		assert.strictEqual(Fmt.truncate(`${family}${family}`, 3), `${family}…`);
		assert.strictEqual(Fmt.truncate(`${family}${family}`, 2), "…");
		assert.strictEqual(Fmt.truncate(`a${family}`, 2), "a…");
	});

	it("truncates ANSI-coloured input as plain text: the escapes are dropped, never cut in half", () => {
		const out = Fmt.truncate("\x1b[31mhello world\x1b[39m", 8);
		assert.strictEqual(out, "hello w…");
		assert.notInclude(out, "\x1b");
	});

	it("leaves ANSI-coloured input that already fits untouched", () => {
		const coloured = "\x1b[31mhi\x1b[39m";
		assert.strictEqual(Fmt.truncate(coloured, 5), coloured);
	});

	it("takes a custom ellipsis, counted by width", () => {
		assert.strictEqual(Fmt.truncate("hello world", 8, { ellipsis: "..." }), "hello...");
		assert.strictEqual(Fmt.truncate("hello world", 8, { ellipsis: "" }), "hello wo");
	});

	it("drops the ellipsis when it cannot fit, and gives an empty string for a width of 0 or less", () => {
		assert.strictEqual(Fmt.truncate("hello", 2, { ellipsis: "..." }), "he");
		assert.strictEqual(Fmt.truncate("hello", 0), "");
		assert.strictEqual(Fmt.truncate("hello", -3), "");
	});
});

describe("Fmt.percent scale", () => {
	it("scale 100 takes a 0 to 100 number as it is", () => {
		assert.strictEqual(Fmt.percent(83.3, { scale: 100 }), "83.3%");
		assert.strictEqual(Fmt.percent(100, { scale: 100 }), "100%");
		assert.strictEqual(Fmt.percent(0, { scale: 100 }), "0%");
		assert.strictEqual(Fmt.percent(50, { scale: 100 }), "50%");
	});

	it("scale 1 and an omitted scale are the ratio, exactly as before", () => {
		for (const n of [0, 0.5, 0.8333, 1, 0.12345]) {
			assert.strictEqual(Fmt.percent(n, { scale: 1 }), Fmt.percent(n));
		}
	});

	it("scale 100 agrees with the ratio form on the same number divided by 100", () => {
		for (const n of [0, 12.5, 33.333, 83.3, 99.95, 100]) {
			assert.strictEqual(Fmt.percent(n, { scale: 100 }), Fmt.percent(n / 100), String(n));
		}
	});

	it("digits compose with scale, and a value rounding to zero is 0%, never -0%", () => {
		assert.strictEqual(Fmt.percent(83.333, { scale: 100, digits: 2 }), "83.33%");
		assert.strictEqual(Fmt.percent(83.3, { scale: 100, digits: 0 }), "83%");
		assert.strictEqual(Fmt.percent(-0.001, { scale: 100, digits: 0 }), "0%");
	});
});

describe("Fmt.sanitize", () => {
	it("removes escapes and controls, turns a tab into a space, and keeps line breaks", () => {
		assert.strictEqual(Fmt.sanitize("a\u001b[31mb\u001b[39m\tc\u0007\u009b\nd\r\ne"), "ab c\nd\r\ne");
	});

	it("is what the renderers use: plain text of a paragraph is the sanitized text", () => {
		const ctx = Render.contextOf({ audience: "agent" });
		for (const hostile of ["x\u001b]8;;https://evil\u0007y", "a\u0000b\u007fc", "tab\there", "\u001b[2Jclear"]) {
			assert.strictEqual(Render.plain([Doc.paragraph(hostile)], ctx), Fmt.sanitize(hostile));
		}
	});
});

describe("Fmt.pad", () => {
	it("pads by display width, not by length", () => {
		assert.strictEqual(Fmt.pad("日本", 6), "日本  ");
		assert.strictEqual(Fmt.pad("\u001b[31mab\u001b[39m", 4), "\u001b[31mab\u001b[39m  ");
		assert.strictEqual(Fmt.width(Fmt.pad("👍x", 5)), 5);
	});

	it("aligns right and center, the odd column on the right", () => {
		assert.strictEqual(Fmt.pad("ab", 5, { align: "right" }), "   ab");
		assert.strictEqual(Fmt.pad("ab", 5, { align: "center" }), " ab  ");
		assert.strictEqual(Fmt.pad("ab", 5, { align: "left" }), "ab   ");
	});

	it("returns text at or over the width unchanged", () => {
		assert.strictEqual(Fmt.pad("abcdef", 3), "abcdef");
		assert.strictEqual(Fmt.pad("abc", 3), "abc");
	});

	it("uses a one-column fill and falls back to a space for any other", () => {
		assert.strictEqual(Fmt.pad("a", 3, { fill: "." }), "a..");
		assert.strictEqual(Fmt.pad("a", 3, { fill: "日" }), "a  ");
		assert.strictEqual(Fmt.pad("a", 3, { fill: "ab" }), "a  ");
		assert.strictEqual(Fmt.pad("a", 3, { fill: "\u001b[31m." }), "a  ");
		assert.strictEqual(Fmt.pad("a", 3, { fill: "" }), "a  ");
	});

	it("pads nothing for a width that is not finite, and never throws", () => {
		assert.strictEqual(Fmt.pad("a", Number.NaN), "a");
		assert.strictEqual(Fmt.pad("a", Number.POSITIVE_INFINITY), "a");
		assert.strictEqual(Fmt.pad("a", 2.9), "a ");
	});
});

describe("Fmt.stripAnsi", () => {
	it("removes CSI, OSC 8 by BEL and by ST, strings and two-byte escapes", () => {
		assert.strictEqual(Fmt.stripAnsi("\u001b[1;31mred\u001b[0m"), "red");
		assert.strictEqual(Fmt.stripAnsi("\u001b]8;;https://x.test\u0007link\u001b]8;;\u0007"), "link");
		assert.strictEqual(Fmt.stripAnsi("\u001b]8;;https://x.test\u001b\\link\u001b]8;;\u001b\\"), "link");
		assert.strictEqual(Fmt.stripAnsi("\u001bc\u001b7a\u001b8\u001b(Bb\u001b=c"), "abc");
		assert.strictEqual(Fmt.stripAnsi("\u001bPq#0\u001b\\x"), "x");
	});

	it("keeps a lone ESC and other control characters", () => {
		assert.strictEqual(Fmt.stripAnsi("a\u001b"), "a\u001b");
		assert.strictEqual(Fmt.stripAnsi("lone\u001bescape"), "lone\u001bescape", "ESC e is not a sequence it strips");
		assert.strictEqual(Fmt.stripAnsi("cut \u001b[12;"), "cut \u001b[12;", "an unterminated CSI keeps its bytes");
		assert.strictEqual(Fmt.stripAnsi("a\rb\u0007"), "a\rb\u0007");
	});

	it("keeps the text after a stray ESC before a space, a quote, a dollar or a hash, and strips the nF sequences terminals use", () => {
		assert.strictEqual(Fmt.sanitize("\u001b hello \u001b'quoted'"), " hello 'quoted'");
		assert.strictEqual(Fmt.sanitize("\u001b$5 and \u001b#1 issue"), "$5 and #1 issue");
		assert.strictEqual(Fmt.stripAnsi("\u001b(Ba\u001b)0b\u001b$Bc\u001b$(Cd\u001b#8e\u001b Ff"), "abcdef");
	});

	it("strips an unterminated million-character sequence in linear time (no catastrophic backtracking)", () => {
		const long = "a".repeat(1_000_000);
		for (const input of [
			`\u001b]${long}`,
			`\u001bP${long}`,
			`\u001b[${"1;".repeat(500_000)}`,
			"\u001b ".repeat(500_000),
		]) {
			const started = performance.now();
			Fmt.stripAnsi(input);
			// Linear inputs strip in a few milliseconds; a quadratic regex would take minutes. The bound leaves room for a
			// loaded machine.
			assert.isBelow(performance.now() - started, 500);
		}
	});

	it("is the strip sanitize starts from: a two-byte escape leaves nothing behind", () => {
		assert.strictEqual(Fmt.sanitize("\u001bcabc"), "abc");
		assert.strictEqual(Fmt.width("\u001bcabc"), 3);
		assert.strictEqual(Fmt.truncate("\u001b7abcdef", 4), "abc…");
	});
});

describe("Fmt.isEscapeOnly", () => {
	it("is true for text made only of escape sequences", () => {
		assert.isTrue(Fmt.isEscapeOnly("\u001b[?25l"));
		assert.isTrue(Fmt.isEscapeOnly("\u001b[2J\u001b[3J\u001b[H"));
		assert.isTrue(Fmt.isEscapeOnly("\u001bc"));
	});

	it("is false for empty text, text with content, and bare controls", () => {
		assert.isFalse(Fmt.isEscapeOnly(""));
		assert.isFalse(Fmt.isEscapeOnly("\u001b[31mx"));
		assert.isFalse(Fmt.isEscapeOnly("\r"));
		assert.isFalse(Fmt.isEscapeOnly("\u0007"));
		assert.isFalse(Fmt.isEscapeOnly("\u001b"));
	});
});

describe("Fmt.ranges", () => {
	const cases: ReadonlyArray<readonly [ReadonlyArray<number>, string]> = [
		[[], ""],
		[[42], "42"],
		[[1, 2, 3, 5, 10, 11, 12], "1-3,5,10-12"],
		[[5, 3, 2, 1, 3], "1-3,5"],
		[[1, 3, 5], "1,3,5"],
		[[1, 2], "1-2"],
		[[-2, -1, 0, 2], "-2-0,2"],
		[[1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2], "1-2"],
	];
	for (const [input, expected] of cases) {
		it(`${JSON.stringify(input)} is ${JSON.stringify(expected)}`, () => {
			assert.strictEqual(Fmt.ranges(input), expected);
		});
	}

	it("takes any iterable", () => {
		assert.strictEqual(Fmt.ranges(new Set([3, 1, 2])), "1-3");
	});
});

describe("Fmt.describe", () => {
	it("keeps strings and stringifies other primitives", () => {
		assert.strictEqual(Fmt.describe("x"), "x");
		assert.strictEqual(Fmt.describe(3), "3");
		assert.strictEqual(Fmt.describe(false), "false");
		assert.strictEqual(Fmt.describe(10n), "10");
		assert.strictEqual(Fmt.describe(Symbol("s")), "Symbol(s)");
		assert.strictEqual(Fmt.describe(undefined), "undefined");
		assert.strictEqual(Fmt.describe(null), "null");
	});

	it("is the message of anything with a string message", () => {
		assert.strictEqual(Fmt.describe(new Error("boom")), "boom");
		assert.strictEqual(Fmt.describe({ message: "plain" }), "plain");
	});

	it("is JSON for a plain object or array", () => {
		assert.strictEqual(Fmt.describe({ a: 1 }), '{"a":1}');
		assert.strictEqual(Fmt.describe([1, 2]), "[1,2]");
	});

	it("never throws: a cycle, a bigint field, a throwing getter, a hostile toString", () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		assert.strictEqual(Fmt.describe(cycle), "[object Object]");
		assert.strictEqual(Fmt.describe({ n: 1n }), "[object Object]");
		const getter = Object.defineProperty({}, "message", {
			get() {
				throw new Error("no");
			},
		});
		assert.strictEqual(Fmt.describe(getter), "{}");
		const hostile = Object.create(null) as object;
		Object.defineProperty(hostile, "toJSON", {
			value: () => {
				throw new Error("no");
			},
		});
		assert.strictEqual(Fmt.describe(hostile), "[unprintable value]");
	});
});

describe("Fmt.causeMessage", () => {
	it("joins the chain nearest first, skipping text already spliced", () => {
		const driver = new Error("SQLITE_BUSY: database is locked");
		const outer = new Error("Failed to execute statement", {
			cause: new Error("Failed to execute statement", { cause: driver }),
		});
		assert.strictEqual(Fmt.causeMessage(outer), "Failed to execute statement: SQLITE_BUSY: database is locked");
		assert.strictEqual(Fmt.causeMessage({}), undefined);
		assert.strictEqual(Fmt.causeMessage("thrown"), "thrown");
	});

	it("never throws: a throwing message getter is no answer, a throwing cause getter keeps the text found", () => {
		const throwingMessage = Object.defineProperty({}, "message", {
			get() {
				throw new Error("no");
			},
		});
		const throwingCause = Object.defineProperty({ message: "outer" }, "cause", {
			get() {
				throw new Error("no");
			},
		});
		assert.strictEqual(Fmt.causeMessage(throwingMessage), undefined);
		assert.strictEqual(Fmt.causeMessage(throwingCause), "outer");
		assert.strictEqual(Fmt.causeMessage(throwingMessage) ?? Fmt.describe(throwingMessage), "{}");
	});
});
