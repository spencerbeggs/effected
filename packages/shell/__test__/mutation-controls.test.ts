// Mutation controls in the hardening-a-parser-port style: every operator and
// every quoting rule is pinned by a pair (or set) of inputs that differ in
// exactly the character the rule is about, and must parse differently. A rule
// that no input could falsify would show up here as two identical rows.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { ShellSyntax } from "../src/index.js";

const shape = (input: string): ReadonlyArray<readonly [ReadonlyArray<string | null>, string | null]> =>
	ShellSyntax.parse(input).segments.map(
		(segment) => [segment.words.map((w) => Option.getOrNull(w.literal)), Option.getOrNull(segment.operator)] as const,
	);

const literalOf = (input: string): string | null => {
	const [segment] = ShellSyntax.parse(input).segments;
	const [word] = segment?.words ?? [];
	return word === undefined ? null : Option.getOrNull(word.literal);
};

describe("each control operator splits only when unquoted and unescaped", () => {
	const operators: ReadonlyArray<readonly [string, string]> = [
		["&&", "&&"],
		["||", "||"],
		[";", ";"],
		[";;", ";;"],
		[";&", ";&"],
		[";;&", ";;&"],
		["|", "|"],
		["|&", "|&"],
		["&", "&"],
		["\n", "newline"],
	];
	for (const [text, operator] of operators) {
		it(JSON.stringify(text), () => {
			assert.deepStrictEqual(shape(`a ${text} b`), [
				[["a"], operator],
				[["b"], null],
			]);
			assert.deepStrictEqual(shape(`a '${text}' b`), [[["a", text, "b"], null]]);
			assert.deepStrictEqual(shape(`a "${text}" b`), [[["a", text, "b"], null]]);
			const escaped = [...text].map((ch) => `\\${ch}`).join("");
			// An escaped newline is a line continuation: it disappears.
			const words = text === "\n" ? ["a", "b"] : ["a", text, "b"];
			assert.deepStrictEqual(shape(`a ${escaped} b`), [[words, null]]);
		});
	}

	it("an escaped newline joins the words around it into one segment", () => {
		assert.deepStrictEqual(shape("a\\\nb"), [[["ab"], null]]);
		assert.deepStrictEqual(shape("a\nb"), [
			[["a"], "newline"],
			[["b"], null],
		]);
	});

	it("a CRLF is a line break, a lone CR is not", () => {
		assert.deepStrictEqual(shape("a\r\nb"), [
			[["a"], "newline"],
			[["b"], null],
		]);
		assert.deepStrictEqual(shape("a\rb"), [[["a\rb"], null]]);
	});

	it("parentheses split segments only when unquoted", () => {
		assert.deepStrictEqual(shape("(a) b"), [
			[["a"], null],
			[["b"], null],
		]);
		assert.deepStrictEqual(shape("'(a)' b"), [[["(a)", "b"], null]]);
		assert.deepStrictEqual(shape("\\(a\\) b"), [[["(a)", "b"], null]]);
	});
});

describe("each redirection operator is a redirection only when unquoted", () => {
	const operators = [">", ">>", ">|", ">&", "<", "<>", "<&", "<<<", "&>", "&>>"] as const;
	for (const operator of operators) {
		it(operator, () => {
			const plain = ShellSyntax.parse(`a ${operator} t`).segments[0];
			assert.deepStrictEqual(
				plain?.redirections.map((r) => r.operator),
				[operator],
			);
			assert.deepStrictEqual(
				plain?.words.map((w) => w.raw),
				["a"],
			);
			const quoted = ShellSyntax.parse(`a '${operator}' t`).segments[0];
			assert.lengthOf(quoted?.redirections ?? [], 0);
			assert.deepStrictEqual(
				quoted?.words.map((w) => Option.getOrNull(w.literal)),
				["a", operator, "t"],
			);
		});
	}

	it("a digit prefix is an fd only when it touches the operator", () => {
		assert.deepStrictEqual(
			ShellSyntax.parse("a 2>t").segments[0]?.redirections.map((r) => Option.getOrNull(r.fd)),
			[2],
		);
		const spaced = ShellSyntax.parse("a 2 >t").segments[0];
		assert.deepStrictEqual(
			spaced?.redirections.map((r) => Option.getOrNull(r.fd)),
			[null],
		);
		assert.deepStrictEqual(
			spaced?.words.map((w) => w.raw),
			["a", "2"],
		);
	});

	it("<< is a heredoc and <<< is not", () => {
		assert.lengthOf(ShellSyntax.parse("a <<E\nE").segments[0]?.heredocs ?? [], 1);
		assert.lengthOf(ShellSyntax.parse("a <<<E\nE").segments[0]?.heredocs ?? [], 0);
	});
});

describe("each quoting rule decides whether a word is literal", () => {
	const rows: ReadonlyArray<readonly [string, string, string | null]> = [
		["single quotes keep $ literal", "'$X'", "$X"],
		["double quotes expand $", '"$X"', null],
		["bare $ expands", "$X", null],
		["an escaped $ is literal", "\\$X", "$X"],
		["an escaped $ in double quotes is literal", '"\\$X"', "$X"],
		["single quotes keep * literal", "'*'", "*"],
		["double quotes keep * literal", '"*"', "*"],
		["a bare * globs", "*", null],
		["an escaped * is literal", "\\*", "*"],
		["a bare ? globs", "a?", null],
		["a closed bracket globs", "[ab]", null],
		["an unclosed bracket is literal", "[ab", "[ab"],
		["single-quoted braces are literal", "'{a,b}'", "{a,b}"],
		["bare braces with a comma expand", "{a,b}", null],
		["an escaped comma does not expand", "{a\\,b}", "{a,b}"],
		["a quoted comma does not expand", '{a",b"}', "{a,b}"],
		["bare braces with .. expand", "{1..3}", null],
		["bare braces without a separator are literal", "{ab}", "{ab}"],
		["a quoted tilde is literal", "'~'/x", "~/x"],
		["a leading bare tilde expands", "~/x", null],
		["an escaped tilde is literal", "\\~/x", "~/x"],
		["a tilde mid-word is literal", "a~/x", "a~/x"],
		["single-quoted $(…) is literal", "'$(x)'", "$(x)"],
		["bare $(…) is a substitution", "$(x)", null],
		["single-quoted backticks are literal", "'`x`'", "`x`"],
		["bare backticks are a substitution", "`x`", null],
		["an escaped backtick is literal", "\\`x\\`", "`x`"],
		["ANSI-C quotes decode escapes", "$'a\\nb'", "a\nb"],
		["single quotes keep escapes", "'a\\nb'", "a\\nb"],
		["double quotes keep unknown escapes", '"a\\nb"', "a\\nb"],
		["double quotes unescape a quote", '"a\\"b"', 'a"b'],
		["single quotes do not unescape a quote", "'a\\'b", "a\\b"],
		["a bare backslash escapes the next character", "a\\ b", "a b"],
		["a quoted backslash is literal", "'a\\ b'", "a\\ b"],
		['$"…" is a quoted string', '$"a b"', "a b"],
		["a lone $ is literal", "$", "$"],
		["$ before a non-name is literal", "$%", "$%"],
		["$ before a digit expands", "$1", null],
		["$ before a special parameter expands", "$?", null],
	];
	for (const [name, input, expected] of rows) {
		it(name, () => {
			assert.strictEqual(literalOf(input), expected, input);
		});
	}
});

describe("each structural rule is shown to matter", () => {
	it("a # starts a comment only at a word start", () => {
		const commented = ShellSyntax.parse("a #b");
		assert.deepStrictEqual(
			commented.comments.map((c) => c.text),
			["b"],
		);
		const word = ShellSyntax.parse("a#b");
		assert.lengthOf(word.comments, 0);
		assert.strictEqual(literalOf("a#b"), "a#b");
		assert.lengthOf(ShellSyntax.parse("a '#b'").comments, 0);
	});

	it("NAME=value is an assignment only before the command name", () => {
		const before = ShellSyntax.parse("A=1 cmd").segments[0];
		const after = ShellSyntax.parse("cmd A=1").segments[0];
		assert.lengthOf(before?.assignments ?? [], 1);
		assert.lengthOf(after?.assignments ?? [], 0);
		assert.lengthOf(ShellSyntax.parse("'A'=1 cmd").segments[0]?.assignments ?? [], 0);
		assert.lengthOf(ShellSyntax.parse("A\\=1 cmd").segments[0]?.assignments ?? [], 0);
	});

	it("a quoted heredoc delimiter makes the body literal", () => {
		const unquoted = ShellSyntax.parse("cat <<E\n$(x)\nE").segments[0]?.heredocs[0];
		const quoted = ShellSyntax.parse("cat <<'E'\n$(x)\nE").segments[0]?.heredocs[0];
		assert.lengthOf(unquoted?.expansions ?? [], 1);
		assert.lengthOf(quoted?.expansions ?? [], 0);
	});

	it("<<- strips leading tabs before matching the delimiter, << does not", () => {
		assert.strictEqual(ShellSyntax.parse("cat <<-E\nx\n\tE\nE").segments[0]?.heredocs[0]?.body, "x\n");
		assert.strictEqual(ShellSyntax.parse("cat <<E\nx\n\tE\nE").segments[0]?.heredocs[0]?.body, "x\n\tE\n");
	});

	it("$(( … )) is arithmetic and $( ( … ) ) is a substitution", () => {
		assert.strictEqual(ShellSyntax.parse("$((1))").segments[0]?.words[0]?.parts[0]?.kind, "arithmetic");
		assert.strictEqual(ShellSyntax.parse("$( (1) )").segments[0]?.words[0]?.parts[0]?.kind, "commandSubstitution");
	});

	it("$[ … ] is arithmetic, [ … ] after a lone $ or none is a word", () => {
		const parts = (input: string) => ShellSyntax.parse(input).segments[0]?.words[1]?.parts.map((p) => p.kind);
		assert.deepStrictEqual(parts("echo $[1<<2]"), ["arithmetic"]);
		assert.lengthOf(ShellSyntax.parse("echo $[1<<2]").segments[0]?.redirections ?? [], 0);
		// One character less, and the `<<` is a heredoc redirection.
		assert.lengthOf(ShellSyntax.parse("echo [1<<2]").segments[0]?.redirections ?? [], 1);
		assert.lengthOf(ShellSyntax.parse("echo $ [1<<2]").segments[0]?.redirections ?? [], 1);
	});

	it("a NAME[ subscript is a matched pair only in command position and right after an unquoted name", () => {
		const redirections = (input: string): number => ShellSyntax.parse(input).segments[0]?.redirections.length ?? -1;
		assert.strictEqual(redirections("a[1<<2]=x"), 0);
		assert.strictEqual(redirections("a[1<<2]"), 0);
		assert.strictEqual(redirections("echo a[1<<2]"), 1);
		assert.strictEqual(redirections("'a'[1<<2]"), 1);
		assert.strictEqual(redirections("a\\[1<<2]"), 1);
		assert.strictEqual(redirections("a[1]b[1<<2]"), 1);
	});

	it("< touching ( is a process substitution, < before a space is a redirection", () => {
		const process = ShellSyntax.parse("a <(b)").segments[0];
		const redirect = ShellSyntax.parse("a < (b)").segments[0];
		assert.strictEqual(process?.words[1]?.parts[0]?.kind, "processSubstitution");
		assert.lengthOf(process?.redirections ?? [], 0);
		assert.lengthOf(redirect?.redirections ?? [], 1);
	});
});
