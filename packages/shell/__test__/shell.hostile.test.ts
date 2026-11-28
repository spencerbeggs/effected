// Hostile input: the parse must return for every string, never throw, and
// stay linear in the input length. Nesting depth lives on explicit stacks, so
// a megabyte of openers is one pass, not a stack overflow or a quadratic scan.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Arbitrary, Option, Schema } from "effect";
import type { ShellScript, ShellWord } from "../src/index.js";
import { ShellSyntax } from "../src/index.js";

const MEGABYTE = 1 << 20;

const repeatTo = (unit: string, length: number): string =>
	unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

/** The size growth is measured to: 64 KiB, from a quarter of that. */
const MEASURED = MEGABYTE / 16;

/**
 * The growth ratio of a parse from `build(MEASURED / 4)` to `build(MEASURED)`, as `Growth.measure` times it: linear
 * is near 4, quadratic near 16. Each size is the fastest of five CPU-time samples, a sample shorter than 5 ms is a
 * batch of repeats, so a fast parse is measured on real work and not on timer noise, and a ratio of 10 or more is
 * measured again, up to three rounds, so one pause cannot fail a linear parse, while a quadratic one fails every
 * round. `full.script` is the parse of the whole megabyte, for the units that read it.
 *
 * Growth is measured to 64 KiB, not to the megabyte the unit parses: a quadratic scan reads 16x at any size, and a
 * short parse is repeated until it can be timed. To a quarter megabyte every unit read 3.7x to 4.7x on macOS, but
 * the worst of the 86 read 8.6x on a Linux runner, against the bound of 10. Past about a megabyte the
 * memory a parse holds starts to cost more than the parse. `$((` read 4.2x from a quarter megabyte to one and 7.6x
 * to 11.6x from one to four on macOS, and 11.9x from a quarter megabyte to one on a Linux runner, while it kept an
 * object per unit live; #1387 found the same for `((`. Neither does now, but the scanner's typed arrays are external
 * memory, for which V8 requests collections at a rate linear in the input. The fastest of five samples misses them
 * at the smaller size and cannot at the larger, so `$((` from a quarter megabyte to one still read 5.8x to 9.2x on
 * macOS, where repeated parses cost 3.95x from one megabyte to four (#1429). A ratio taken across a megabyte
 * measures when the collector ran.
 *
 * The ratio is the whole bound: no unit asserts an absolute time. A ceiling of 10 s of CPU on the full run measured the
 * machine, not the parse. CPU time here is the process's, GC helper threads included (about 1.4x the wall time of a
 * parse here), V8 coverage roughly doubles it again, and CI runners differ by about 1.7x for the same commit, so a
 * megabyte of `a;` that takes 1.6 s of CPU locally took 14.7 s on a slow runner while its ratio stayed linear. The
 * 60 s test timeout is the absolute backstop.
 */
const measure = (
	build: (length: number) => string,
): {
	readonly full: { readonly script: ShellScript };
	readonly ratio: number;
	readonly detail: string;
	readonly length: number;
} => {
	const { ratio, detail } = Growth.measure(
		(size) => {
			const input = build(size);
			return () => ShellSyntax.parse(input);
		},
		{ from: MEASURED / 4, bound: 10 },
	);
	return { full: { script: ShellSyntax.parse(build(MEGABYTE)) }, ratio, detail, length: MEGABYTE };
};

// Each unit is a construct whose naive handling is quadratic or recursive:
// openers that never close, quotes that pair up, brackets with no `]`, braces
// with no `}`, pending heredocs, and very many small segments.
const UNITS: ReadonlyArray<string> = [
	'"',
	"'",
	"$(",
	"${",
	"$((",
	"`",
	"<(",
	'"$(',
	"(",
	")",
	"[",
	"{",
	"{a,",
	"\\",
	"$'",
	"<<a ",
	"a;",
	"a&&",
	"x ",
	"> ",
	"~",
	// No `a=(` unit: repeating it leaves the first array unterminated, so the
	// parse stops at once. The one-array tests below hold a megabyte of keys and
	// of substitutions in a single array instead.
	"\n",
	"# \n",
	"((",
	"((a)",
	"(((a)b)",
	"((a<<b ",
	"$((a)",
	"`\\`",
	"{a,$(b)}",
	// No `x=($(a) ` unit, for the same reason: see "one array holding a
	// megabyte of substitutions" below.
	"env -- ",
	"[[ ",
	"$[",
	"$[a<<b ",
	"a[",
	"a[1<<b]=x ",
	"x[ ",
	"$(a[",
	"a\\\n[",
	"$\\\n[",
	"(\\\n(",
	"\\\n",
	"$\\\n",
	"a\\\n",
	"<\\\n<",
	"<<\\\n-a ",
	"$(a\\\n[",
	"$(\\\n#",
	"time -p ",
	"time -- ",
	"coproc C ",
	"function f ",
	"a[$(x)]=1 ",
	"[[ a ]] then ",
	"<<$( ",
	"<<$[ ",
	"<<`",
	"$(<<$( ",
	"<<$'",
	"<<a\na\\\n",
	"$(a[1<<b] ",
	"$( a ",
	// A quoted run inside an expansion is read twice: to match, then for openers.
	"${'",
	`"\${x:-'$(a)'}" `,
	"$(('",
	"$(('$(a)' ",
	"$['",
	"a['$(a)']=1 ",
	// No unit covers an array key: repeating `x=(['$(a)']=1 ` closes nothing,
	// so the parse stops at the second `x=(` after a few characters. The
	// one-array test below holds a megabyte of keys in a single array instead.
	// An array key is a matched pair across blanks; an unclosed one runs to the end.
	"x=([ ",
	"${$'",
	// An ANSI-C run inside an expansion is decoded before its opener check.
	`"\${x:-$'\\x24' `,
	// A quoted run ending in \$ is checked against the character after it.
	`"\${x:-$'$'(a)} `,
	"a['$'(a)]=1 ",
	// A literal or escaped `$` reaching an expansion through a `"…"` run or a backslash.
	`"\${x:-"$"(a)} `,
	"a[\\$\\(a\\)]=1 ",
	`"\${x:-\\$(a)} `,
	// A bare `$` before an escaped `(` in a re-read frame, and `$$` in double quotes.
	"a[$\\(a\\)]=1 ",
	`"\${x:-"$$"} `,
	// A wrapper's value word is checked for splitting.
	"env -u $v ",
	// A quoted run in a double-quoted `${…}` is read a third time, as POSIX mode would.
	`"\${x:-'}'} `,
	`"\${x:-'\${y:-"a"}'} `,
	"env --u ",
	"sudo --c ",
	// An assignment builtin's array argument, its subscripted name matched
	// through quotes, the token read on after its `)`, and a name whose `[`
	// never matches before an `=(`.
	"declare x=(a)# ",
	'declare y["]"]=(a)b ',
	"declare y[[[=( ",
];

describe("hostile input", () => {
	for (const unit of UNITS) {
		it(`a megabyte of ${JSON.stringify(unit)} parses in linear time`, { timeout: 60_000 }, () => {
			const { full, ratio, detail, length } = measure((size) => repeatTo(unit, size));
			assert.strictEqual(full.script.source.length, length);
			assert.isBelow(ratio, 10, `${JSON.stringify(unit)}: ${detail}`);
		});
	}

	it("one array holding a megabyte of blank-holding keys parses in linear time", { timeout: 60_000 }, () => {
		const build = (length: number): string => `x=(${repeatTo("[ '$(a)' ]=1 ", length)})`;
		const { ratio } = measure(build);
		assert.isBelow(ratio, 10);
	});

	it("one array holding a megabyte of substitutions parses in linear time", { timeout: 60_000 }, () => {
		const { full, ratio } = measure((length) => `x=(${repeatTo("$(a) ", length)})`);
		assert.deepStrictEqual(full.script.diagnostics, []);
		assert.isBelow(ratio, 10);
	});

	it("a heredoc line joined from a megabyte of continuations parses in linear time", { timeout: 60_000 }, () => {
		const { ratio } = measure((length) => `cat <<E\n${repeatTo("x\\\n", length)}`);
		assert.isBelow(ratio, 10);
	});

	it("one megabyte-long quoted run inside a braced expansion is checked for openers in linear time", {
		timeout: 60_000,
	}, () => {
		const build = (length: number): string => `echo "\${x:-'${repeatTo("a$ ", length)}'}"`;
		const { full, ratio } = measure(build);
		// A quoted `$` in the run is reported once, whatever follows it.
		assert.deepStrictEqual(
			full.script.diagnostics.map((d) => d.code),
			["QuotedSubstitutionInExpansion"],
		);
		assert.isBelow(ratio, 10);
	});

	it("one megabyte-long ANSI-C run of escaped openers inside a braced expansion is decoded in linear time", {
		timeout: 60_000,
	}, () => {
		const build = (length: number): string => `echo "\${x:-$'${repeatTo("\\x24", length)}'}"`;
		const { full, ratio } = measure(build);
		assert.deepStrictEqual(
			full.script.diagnostics.map((d) => d.code),
			["QuotedSubstitutionInExpansion"],
		);
		assert.isBelow(ratio, 10);
	});

	it("one megabyte-long double-quoted run of literal $ inside a braced expansion is checked in linear time", {
		timeout: 60_000,
	}, () => {
		const build = (length: number): string => `echo "\${x:-"${repeatTo("$ ", length)}"}"`;
		const { full, ratio } = measure(build);
		assert.deepStrictEqual(
			full.script.diagnostics.map((d) => d.code),
			["QuotedSubstitutionInExpansion"],
		);
		assert.isBelow(ratio, 10);
	});

	it("one megabyte-long quoted run of openers is read as POSIX mode would in linear time", {
		timeout: 60_000,
	}, () => {
		// Every `${` stays open, so the reader's stack grows with the run.
		const build = (length: number): string => `echo "\${x:-'${repeatTo('${"', length)}'}"`;
		const { full, ratio } = measure(build);
		assert.deepStrictEqual(
			full.script.diagnostics.map((d) => d.code),
			["QuotedSubstitutionInExpansion", "QuotedCloserInExpansion"],
		);
		assert.isBelow(ratio, 10);
	});

	it("a megabyte of $( is one opaque word with one diagnostic", () => {
		const script = ShellSyntax.parse(repeatTo("$(", MEGABYTE));
		assert.lengthOf(script.segments, 1);
		assert.deepStrictEqual(
			script.segments[0]?.words.map((w) => w.parts.map((p) => [p.kind, p.start, p.end])),
			[[["opaque", 0, MEGABYTE]]],
		);
		assert.deepStrictEqual(
			script.diagnostics.map((d) => d.code),
			["UnterminatedCommandSubstitution"],
		);
	});

	it('a megabyte of " pairs into empty double-quoted parts of one word', () => {
		const script = ShellSyntax.parse(repeatTo('"', MEGABYTE));
		const [word] = script.segments[0]?.words ?? [];
		assert.strictEqual(word?.parts.length, MEGABYTE / 2);
		assert.strictEqual(Option.getOrNull(word?.literal ?? Option.none()), "");
		assert.lengthOf(script.diagnostics, 0);
	});

	it("deeply nested closed substitutions still resolve", () => {
		const depth = 100_000;
		const input = `echo ${"$(".repeat(depth)}x${")".repeat(depth)} done`;
		const script = ShellSyntax.parse(input);
		assert.deepStrictEqual(
			script.segments[0]?.words.map((w) => w.parts[0]?.kind),
			["bare", "commandSubstitution", "bare"],
		);
		assert.lengthOf(script.diagnostics, 0);
	});

	it("200,000 words come back in order", () => {
		const count = 200_000;
		const script = ShellSyntax.parse("x ".repeat(count));
		const words = script.segments[0]?.words ?? [];
		assert.strictEqual(words.length, count);
		assert.strictEqual(words[count - 1]?.start, 2 * (count - 1));
	});

	it("a megabyte of { has no brace part and a matching } still pairs", () => {
		const open = ShellSyntax.parse(repeatTo("{", MEGABYTE));
		assert.deepStrictEqual(
			open.segments[0]?.words[0]?.parts.map((p) => p.kind),
			["bare"],
		);
		const closed = ShellSyntax.parse(`${"{".repeat(1000)}a,b${"}".repeat(1000)}`);
		assert.deepStrictEqual(
			closed.segments[0]?.words[0]?.parts.map((p) => p.kind),
			["bare", "brace", "bare"],
		);
	});
});

describe("structural invariants over random shell-dense strings", () => {
	// Every character the lexer branches on, so random strings hit quotes,
	// expansions, operators, redirections, heredocs and brace/glob syntax.
	const ALPHABET = [
		"a",
		"1",
		" ",
		"\t",
		"\n",
		"\r",
		"\\",
		"'",
		'"',
		"`",
		"$",
		"(",
		")",
		"{",
		"}",
		"[",
		"]",
		",",
		".",
		"*",
		"?",
		"~",
		"/",
		":",
		"=",
		"+",
		"-",
		"#",
		";",
		"&",
		"|",
		"<",
		">",
		"!",
		"@",
		"é",
		"\uD83D",
	];
	const shellish = Arbitrary.array(Arbitrary.schema(Schema.Literals(ALPHABET)), { maxLength: 64 }).pipe(
		Arbitrary.map((chars) => chars.join("")),
	);

	const wordTiles = (source: string, word: ShellWord): boolean => {
		if (word.raw !== source.slice(word.start, word.end)) return false;
		if (word.parts.length === 0) return word.start === word.end;
		let cursor = word.start;
		for (const part of word.parts) {
			if (part.start !== cursor || part.end < part.start) return false;
			if (part.raw !== source.slice(part.start, part.end)) return false;
			cursor = part.end;
		}
		return cursor === word.end;
	};

	const holds = (source: string): boolean => {
		const script = ShellSyntax.parse(source);
		let previousEnd = 0;
		for (const segment of script.segments) {
			if (segment.start < previousEnd || segment.end < segment.start || segment.end > source.length) return false;
			previousEnd = segment.end;
			const words = [
				...segment.words,
				...segment.assignments.map((a) => a.value),
				...segment.redirections.flatMap((r) => (r.target.kind === "word" ? [r.target] : [])),
			];
			for (const word of words) {
				if (word.start < segment.start || word.end > segment.end || !wordTiles(source, word)) return false;
			}
			for (const heredoc of segment.heredocs) {
				if (heredoc.body !== source.slice(heredoc.start, heredoc.end)) return false;
			}
		}
		for (const diagnostic of script.diagnostics) {
			if (diagnostic.offset < 0 || diagnostic.offset + diagnostic.length > source.length) return false;
		}
		for (const substitution of script.substitutions()) {
			const slice = source.slice(substitution.bodyStart, substitution.bodyEnd);
			// A backtick body is the slice after escape removal, so it differs
			// only when the slice holds a backslash.
			const backtick = substitution.kind === "commandSubstitution" && substitution.style === "backtick";
			if (backtick ? substitution.body !== slice && !slice.includes("\\") : substitution.body !== slice) return false;
			// A nested parse must be total too.
			ShellSyntax.parse(substitution.body);
		}
		script.commands();
		return true;
	};

	it.prop("parse is total and every span tiles the source", [shellish], ([source]) => holds(source), {
		arbitrary: { runs: 3000, size: 64 },
	});
});
