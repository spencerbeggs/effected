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
	"a=(",
	"\n",
	"# \n",
	"((",
	"((a)",
	"(((a)b)",
	"((a<<b ",
	"$((a)",
	"`\\`",
	"{a,$(b)}",
	"x=($(a) ",
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
];

describe("hostile input", () => {
	for (const unit of UNITS) {
		it(`a megabyte of ${JSON.stringify(unit)} parses in linear time`, { timeout: 60_000 }, () => {
			const small = repeatTo(unit, MEGABYTE / 4);
			const large = repeatTo(unit, MEGABYTE);
			time(small); // warm up
			const quarter = time(small);
			const full = time(large);
			assert.strictEqual(full.script.source.length, MEGABYTE);
			// Linear growth is a ratio near 4; quadratic growth is near 16. The
			// floor keeps a sub-millisecond quarter run from producing a noisy ratio.
			const ratio = full.ms / Math.max(quarter.ms, 5);
			assert.isBelow(ratio, 10, `${JSON.stringify(unit)}: ${quarter.ms.toFixed(1)}ms -> ${full.ms.toFixed(1)}ms`);
			assert.isBelow(full.ms, 10_000);
		});
	}

	it("a heredoc line joined from a megabyte of continuations parses in linear time", { timeout: 60_000 }, () => {
		const small = `cat <<E\n${repeatTo("x\\\n", MEGABYTE / 4)}`;
		const large = `cat <<E\n${repeatTo("x\\\n", MEGABYTE)}`;
		time(small);
		const quarter = time(small);
		const full = time(large);
		assert.isBelow(full.ms / Math.max(quarter.ms, 5), 10);
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
