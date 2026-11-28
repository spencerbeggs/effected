// Structural invariants over random shell-dense strings: the parse is total and
// every span it reports tiles the source. Split from the hostile file so its run
// count reads Depth: the ordinary count on every run, ten times that at full depth.

import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Schema } from "effect";
import type { ShellWord } from "../src/index.js";
import { ShellSyntax } from "../src/index.js";

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
		arbitrary: { runs: Depth.pick({ sample: 3_000, full: 30_000 }), size: 64 },
	});
});
