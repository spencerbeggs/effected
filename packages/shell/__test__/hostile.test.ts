// Hostile input: the parse must return for every string, never throw, and
// stay linear in the input length. Nesting depth lives on explicit stacks, so
// a megabyte of openers is one pass, not a stack overflow or a quadratic scan.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Option, Schema } from "effect";
import type { ShellScript, ShellWord } from "../src/index.js";
import { ShellSyntax } from "../src/index.js";

const MEGABYTE = 1 << 20;

const repeatTo = (unit: string, length: number): string =>
	unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

const time = (input: string): { readonly ms: number; readonly script: ShellScript } => {
	const started = performance.now();
	const script = ShellSyntax.parse(input);
	return { ms: performance.now() - started, script };
};

type Timing = ReturnType<typeof time>;

/**
 * The growth ratio of a parse from `build(quarterLength)` to
 * `build(4 * quarterLength)`: linear is near 4, quadratic near 16. The quarter
 * size starts at a quarter megabyte and doubles, up to 4 MB, until its run
 * takes 5 ms, so a fast parse is measured on real work rather than on timer
 * noise: under 5 ms a quadratic parse can read as linear. Each size is timed
 * once after a warm-up. A ratio of 10 or more is timed again, up to three
 * samples, keeping the fastest run of each size, so one pause in the full run
 * cannot fail a linear parse, while a quadratic one fails every sample.
 */
const measure = (
	build: (length: number) => string,
): { readonly quarter: Timing; readonly full: Timing; readonly ratio: number; readonly length: number } => {
	let quarterLength = MEGABYTE / 4;
	let small = build(quarterLength);
	time(small); // warm up
	let quarter = time(small);
	while (quarter.ms < 5 && quarterLength < 4 * MEGABYTE) {
		quarterLength *= 2;
		small = build(quarterLength);
		time(small);
		quarter = time(small);
	}
	const large = build(quarterLength * 4);
	let full = time(large);
	let ratio = full.ms / Math.max(quarter.ms, 5);
	for (let sample = 1; sample < 3 && ratio >= 10; sample += 1) {
		const again = time(small);
		const fullAgain = time(large);
		if (again.ms < quarter.ms) quarter = again;
		if (fullAgain.ms < full.ms) full = fullAgain;
		ratio = full.ms / Math.max(quarter.ms, 5);
	}
	return { quarter, full, ratio, length: quarterLength * 4 };
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
];

describe("hostile input", () => {
	for (const unit of UNITS) {
		it(`a megabyte of ${JSON.stringify(unit)} parses in linear time`, { timeout: 60_000 }, () => {
			const { quarter, full, ratio, length } = measure((size) => repeatTo(unit, size));
			assert.strictEqual(full.script.source.length, length);
			assert.isBelow(ratio, 10, `${JSON.stringify(unit)}: ${quarter.ms.toFixed(1)}ms -> ${full.ms.toFixed(1)}ms`);
			assert.isBelow(full.ms, 10_000);
		});
	}

	it("one array holding a megabyte of blank-holding keys parses in linear time", { timeout: 60_000 }, () => {
		const build = (length: number): string => `x=(${repeatTo("[ '$(a)' ]=1 ", length)})`;
		const { full, ratio } = measure(build);
		assert.isBelow(ratio, 10);
		assert.isBelow(full.ms, 10_000);
	});

	it("one array holding a megabyte of substitutions parses in linear time", { timeout: 60_000 }, () => {
		const { full, ratio } = measure((length) => `x=(${repeatTo("$(a) ", length)})`);
		assert.deepStrictEqual(full.script.diagnostics, []);
		assert.isBelow(ratio, 10);
		assert.isBelow(full.ms, 10_000);
	});

	it("a heredoc line joined from a megabyte of continuations parses in linear time", { timeout: 60_000 }, () => {
		const { full, ratio } = measure((length) => `cat <<E\n${repeatTo("x\\\n", length)}`);
		assert.isBelow(ratio, 10);
		assert.isBelow(full.ms, 10_000);
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
		assert.isBelow(full.ms, 10_000);
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
		assert.isBelow(full.ms, 10_000);
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
		assert.isBelow(full.ms, 10_000);
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
		assert.isBelow(full.ms, 10_000);
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
