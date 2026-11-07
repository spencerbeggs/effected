import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { ShellWord, ShellWordPart } from "../src/index.js";
import {
	ShellCommandSubstitutionPart,
	ShellDiagnostic,
	ShellDoubleQuotedPart,
	ShellScript,
	ShellSyntax,
	ShellVariablePart,
} from "../src/index.js";

const words = (input: string): ReadonlyArray<ShellWord> => ShellSyntax.parse(input).segments.flatMap((s) => s.words);

const onlyWord = (input: string): ShellWord => {
	const all = words(input);
	assert.lengthOf(all, 1, `expected one word in ${JSON.stringify(input)}`);
	return all[0] as ShellWord;
};

const partOf = <K extends ShellWordPart["kind"]>(word: ShellWord, kind: K): Extract<ShellWordPart, { kind: K }> => {
	const part = word.parts.find((p) => p.kind === kind);
	if (part === undefined) assert.fail(`no ${kind} part in ${word.raw}`);
	return part as Extract<ShellWordPart, { kind: K }>;
};

describe("ShellSyntax.parse", () => {
	it("returns a ShellScript keeping the source", () => {
		const script = ShellSyntax.parse("ls -la");
		assert.instanceOf(script, ShellScript);
		assert.strictEqual(script.source, "ls -la");
		assert.lengthOf(script.diagnostics, 0);
	});

	it("records word, segment and part offsets into the source", () => {
		const source = "FOO=1 git commit -m 'x y' && ls";
		const script = ShellSyntax.parse(source);
		const [first, second] = script.segments;
		assert.isDefined(first);
		assert.isDefined(second);
		if (first === undefined || second === undefined) return;
		assert.strictEqual(source.slice(first.start, first.end), "FOO=1 git commit -m 'x y'");
		assert.strictEqual(source.slice(second.start, second.end), "ls");
		for (const word of first.words) assert.strictEqual(source.slice(word.start, word.end), word.raw);
		const quoted = first.words[3] as ShellWord;
		const part = quoted.parts[0];
		assert.strictEqual(part?.kind, "singleQuoted");
		assert.strictEqual(source.slice(part?.start, part?.end), "'x y'");
		const assignment = first.assignments[0];
		assert.strictEqual(assignment?.raw, "FOO=1");
		assert.strictEqual(source.slice(assignment?.value.start, assignment?.value.end), "1");
	});

	it("reports the joining operator on each segment, None after the last", () => {
		const script = ShellSyntax.parse("a; b & c | d |& e || f && g\nh");
		assert.deepStrictEqual(
			script.segments.map((s) => Option.getOrNull(s.operator)),
			[";", "&", "|", "|&", "||", "&&", "newline", null],
		);
	});

	it("distinguishes the case terminators", () => {
		const script = ShellSyntax.parse("case $x in a) one;; b) two;& c) three;;& esac");
		assert.deepStrictEqual(
			script.segments.map((s) => [s.words.map((w) => w.raw), Option.getOrNull(s.operator)]),
			[
				[["case", "$x", "in", "a"], null],
				[["one"], ";;"],
				[["b"], null],
				[["two"], ";&"],
				[["c"], null],
				[["three"], ";;&"],
				[["esac"], null],
			],
		);
	});

	it("drops empty segments and records a leading operator as EmptyCommand", () => {
		const script = ShellSyntax.parse("\n\n; ls ;\n");
		assert.lengthOf(script.segments, 1);
		assert.deepStrictEqual(
			script.diagnostics.map((d) => [d.code, d.offset, d.length]),
			[["EmptyCommand", 2, 1]],
		);
	});

	it("tracks parenthesis depth and clamps an unbalanced close", () => {
		const script = ShellSyntax.parse("( (a) b) c) d");
		assert.deepStrictEqual(
			script.segments.map((s) => [s.words.map((w) => w.raw), s.groupDepth]),
			[
				[["a"], 2],
				[["b"], 1],
				[["c"], 0],
				[["d"], 0],
			],
		);
	});
});

describe("word parts", () => {
	it("decodes ANSI-C escapes into the literal", () => {
		const word = onlyWord("$'a\\tb\\n\\x41\\u00e9\\U0001F600\\cA\\101\\e\\q'");
		assert.strictEqual(Option.getOrThrow(word.literal), "a\tb\nAé\u{1F600}\x01A\x1b\\q");
		assert.strictEqual(partOf(word, "ansiC").raw, word.raw);
	});

	it("ends an ANSI-C string at a NUL escape, as bash does", () => {
		assert.strictEqual(Option.getOrThrow(onlyWord("$'ab\\0cd'").literal), "ab");
		assert.strictEqual(Option.getOrThrow(onlyWord("$'ab\\x00cd'").literal), "ab");
	});

	it("keeps an out-of-range \\U escape and reports it rather than throwing", () => {
		const script = ShellSyntax.parse("echo $'\\U00110000'");
		const word = script.segments[0]?.words[1] as ShellWord;
		assert.strictEqual(Option.getOrThrow(word.literal), "\\U00110000");
		assert.deepStrictEqual(
			script.diagnostics.map((d) => [d.code, d.offset, d.length]),
			[["InvalidAnsiCEscape", 7, 10]],
		);
	});

	it("keeps an escape with no digits as written", () => {
		assert.strictEqual(Option.getOrThrow(onlyWord("$'\\xg\\u\\c'").literal), "\\xg\\u\\c");
	});

	it("marks double-quoted expansions and keeps their text in the value", () => {
		const word = onlyWord(`"pre $X \${Y:-z} $(cmd a) $((1 + 2)) \`b\` \\$lit post"`);
		const part = partOf(word, "doubleQuoted");
		assert.instanceOf(part, ShellDoubleQuotedPart);
		assert.strictEqual(part.value, `pre $X \${Y:-z} $(cmd a) $((1 + 2)) \`b\` $lit post`);
		assert.deepStrictEqual(
			part.expansions.map((e) => [e.kind, e.raw]),
			[
				["variable", "$X"],
				["variable", `\${Y:-z}`],
				["commandSubstitution", "$(cmd a)"],
				["arithmetic", "$((1 + 2))"],
				["commandSubstitution", "`b`"],
			],
		);
		assert.isTrue(Option.isNone(word.literal));
	});

	it('reads $"…" as a localized double-quoted string', () => {
		const word = onlyWord('$"hello"');
		const part = partOf(word, "doubleQuoted");
		assert.isTrue(part.localized);
		assert.strictEqual(Option.getOrThrow(word.literal), "hello");
	});

	it("does not treat $' or $\" as special inside double quotes", () => {
		assert.strictEqual(Option.getOrThrow(onlyWord("\"a$'b'\"").literal), "a$'b'");
	});

	it("records variable expressions opaquely", () => {
		const braced = partOf(onlyWord(`\${x:-default}`), "variable");
		assert.instanceOf(braced, ShellVariablePart);
		assert.isTrue(braced.braced);
		assert.strictEqual(braced.expression, "x:-default");
		const plain = partOf(onlyWord("$HOME_DIR/x"), "variable");
		assert.isFalse(plain.braced);
		assert.strictEqual(plain.expression, "HOME_DIR");
		assert.strictEqual(partOf(onlyWord("$10"), "variable").expression, "1");
	});

	it("lists the substitutions inside a braced expansion and arithmetic", () => {
		const variable = partOf(onlyWord(`\${x:-"$(a)"\`b\`}`), "variable");
		assert.deepStrictEqual(
			variable.substitutions.map((s) => [s.kind === "commandSubstitution" ? s.style : s.direction, s.body]),
			[
				["dollar", "a"],
				["backtick", "b"],
			],
		);
		const arithmetic = partOf(onlyWord("$(( $(c) + 1 ))"), "arithmetic");
		assert.strictEqual(arithmetic.body, " $(c) + 1 ");
		assert.deepStrictEqual(
			arithmetic.substitutions.map((s) => s.body),
			["c"],
		);
	});

	it("tells $( (subshell) ) from arithmetic", () => {
		const word = onlyWord("$((cd x; ls) | wc)");
		const part = partOf(word, "commandSubstitution");
		assert.instanceOf(part, ShellCommandSubstitutionPart);
		assert.strictEqual(part.body, "(cd x; ls) | wc");
	});

	it("finds the end of a nested substitution through quotes, comments and heredocs", () => {
		const word = onlyWord("$(echo ')' \"$(echo ')')\" # a ) in a comment\ncat <<E\n) not a closer\nE\n)");
		const part = partOf(word, "commandSubstitution");
		assert.strictEqual(part.end, word.end);
		assert.strictEqual(word.raw.at(-1), ")");
	});

	it("records process substitutions joined to a word", () => {
		const script = ShellSyntax.parse("diff <(ls a) >(tee b)");
		const [, left, right] = script.segments[0]?.words ?? [];
		assert.strictEqual(left?.parts[0]?.kind, "processSubstitution");
		const leftPart = left?.parts[0];
		const rightPart = right?.parts[0];
		if (leftPart?.kind !== "processSubstitution" || rightPart?.kind !== "processSubstitution") {
			assert.fail("expected process substitutions");
		}
		assert.strictEqual(leftPart.direction, "<");
		assert.strictEqual(leftPart.body, "ls a");
		assert.strictEqual(rightPart.direction, ">");
		assert.lengthOf(script.segments[0]?.redirections ?? [], 0);
	});

	it("marks globs, bracket expressions and literal brackets", () => {
		assert.deepStrictEqual(
			onlyWord("a*b?[!x]c").parts.map((p) => [p.kind, p.raw]),
			[
				["bare", "a"],
				["glob", "*"],
				["bare", "b"],
				["glob", "?[!x]"],
				["bare", "c"],
			],
		);
		assert.strictEqual(Option.getOrThrow(onlyWord("[").literal), "[");
		// An unclosed bracket is literal in argument position. In command
		// position bash reads `NAME[` as an unclosed subscript to the end of
		// the input and rejects it, so the word is opaque with a diagnostic.
		assert.strictEqual(Option.getOrThrow((words("echo a[b")[1] as ShellWord).literal), "a[b");
		assert.isTrue(Option.isNone(onlyWord("a[b").literal));
		assert.deepStrictEqual(
			ShellSyntax.parse("a[b").diagnostics.map((d) => d.code),
			["UnterminatedSubscript"],
		);
		assert.strictEqual(Option.getOrThrow(onlyWord("'*'").literal), "*");
	});

	it("marks brace expansion only when a comma or .. sits inside the braces", () => {
		assert.deepStrictEqual(
			onlyWord('pre{a,"b c"}post').parts.map((p) => [p.kind, p.raw]),
			[
				["bare", "pre"],
				["brace", '{a,"b c"}'],
				["bare", "post"],
			],
		);
		assert.strictEqual(onlyWord("{1..3}").parts[0]?.kind, "brace");
		assert.strictEqual(Option.getOrThrow(onlyWord("{}").literal), "{}");
		assert.strictEqual(Option.getOrThrow(onlyWord("{a}").literal), "{a}");
		assert.strictEqual(Option.getOrThrow(onlyWord("a\\,{b}").literal), "a,{b}");
		assert.strictEqual(Option.getOrThrow(onlyWord("{a\\,b}").literal), "{a,b}");
		assert.deepStrictEqual(
			onlyWord("{a{b,c}d}").parts.map((p) => [p.kind, p.raw]),
			[
				["bare", "{a"],
				["brace", "{b,c}"],
				["bare", "d}"],
			],
		);
	});

	it("marks a tilde prefix only where bash expands it", () => {
		assert.deepStrictEqual(
			onlyWord("~/x").parts.map((p) => p.kind),
			["tilde", "bare"],
		);
		assert.strictEqual(partOf(onlyWord("~bob/x"), "tilde").user, "bob");
		assert.strictEqual(Option.getOrThrow(onlyWord("a~/x").literal), "a~/x");
		assert.strictEqual(Option.getOrThrow(onlyWord("--prefix=~/x").literal), "--prefix=~/x");
		assert.strictEqual(Option.getOrThrow(onlyWord("'~'/x").literal), "~/x");
		assert.strictEqual(Option.getOrThrow(onlyWord('~"bob"').literal), "~bob");
	});

	it("lexes an assignment value without globbing or brace expansion, with tilde after : ", () => {
		const assignment = ShellSyntax.parse("X=*.ts Y={a,b} P=~/a:~/b:c~ ls").segments[0]?.assignments ?? [];
		assert.deepStrictEqual(
			assignment.map((a) => [a.name, a.value.parts.map((p) => p.kind)]),
			[
				["X", ["bare"]],
				["Y", ["bare"]],
				["P", ["tilde", "bare", "tilde", "bare"]],
			],
		);
		assert.strictEqual(Option.getOrThrow(assignment[0]?.value.literal ?? Option.none()), "*.ts");
	});

	it("reads array, indexed, appending and empty assignments", () => {
		const segment = ShellSyntax.parse("arr=(a 'b c') a[$i]=1 X+=more E= cmd").segments[0];
		assert.deepStrictEqual(
			segment?.assignments.map((a) => [a.name, a.append, a.value.raw, a.value.parts.map((p) => p.kind)]),
			[
				["arr", false, "(a 'b c')", ["opaque"]],
				["a[$i]", false, "1", ["bare"]],
				["X", true, "more", ["bare"]],
				["E", false, "", []],
			],
		);
		assert.strictEqual(Option.getOrThrow(segment?.assignments[3]?.value.literal ?? Option.none()), "");
		assert.deepStrictEqual(
			segment?.words.map((w) => w.raw),
			["cmd"],
		);
	});

	it("treats NAME=value after the command as an argument", () => {
		const segment = ShellSyntax.parse("make CC=gcc").segments[0];
		assert.lengthOf(segment?.assignments ?? [], 0);
		assert.deepStrictEqual(
			segment?.words.map((w) => Option.getOrNull(w.literal)),
			["make", "CC=gcc"],
		);
	});

	it("does not read a quoted name as an assignment", () => {
		const segment = ShellSyntax.parse('"FOO"=1 cmd').segments[0];
		assert.lengthOf(segment?.assignments ?? [], 0);
		assert.strictEqual(Option.getOrThrow(segment?.words[0]?.literal ?? Option.none()), "FOO=1");
	});

	it("keeps a carriage return inside a word when it does not start a CRLF", () => {
		assert.strictEqual(Option.getOrThrow(onlyWord("a\rb").literal), "a\rb");
	});
});

describe("redirections", () => {
	it("reads every operator and fd prefix", () => {
		const script = ShellSyntax.parse("c >a >>b >|c >&2 <d <>e <&3 <<<f &>g &>>h 2>i 10<j");
		assert.deepStrictEqual(
			script.segments[0]?.redirections.map((r) => [
				Option.getOrNull(r.fd),
				r.operator,
				r.target.kind === "word" ? r.target.raw : "heredoc",
			]),
			[
				[null, ">", "a"],
				[null, ">>", "b"],
				[null, ">|", "c"],
				[null, ">&", "2"],
				[null, "<", "d"],
				[null, "<>", "e"],
				[null, "<&", "3"],
				[null, "<<<", "f"],
				[null, "&>", "g"],
				[null, "&>>", "h"],
				[2, ">", "i"],
				[10, "<", "j"],
			],
		);
		assert.deepStrictEqual(
			script.segments[0]?.words.map((w) => w.raw),
			["c"],
		);
	});

	it("does not read a digit inside a word, or an over-long run of digits, as an fd", () => {
		const script = ShellSyntax.parse("a2>x 1234567890>y");
		const segment = script.segments[0];
		assert.deepStrictEqual(
			segment?.words.map((w) => w.raw),
			["a2", "1234567890"],
		);
		assert.deepStrictEqual(
			segment?.redirections.map((r) => Option.getOrNull(r.fd)),
			[null, null],
		);
	});

	it("records a missing target as a zero-width opaque word and a diagnostic", () => {
		const script = ShellSyntax.parse("echo hi > | cat");
		const redirection = script.segments[0]?.redirections[0];
		assert.strictEqual(redirection?.target.kind, "word");
		if (redirection?.target.kind !== "word") return;
		assert.deepStrictEqual(
			redirection.target.parts.map((p) => [p.kind, p.start, p.end]),
			[["opaque", 9, 9]],
		);
		assert.isTrue(Option.isNone(redirection.target.literal));
		assert.deepStrictEqual(
			script.diagnostics.map((d) => [d.code, d.offset, d.length]),
			[["MissingRedirectionTarget", 8, 1]],
		);
		assert.lengthOf(script.segments, 2);
	});

	it("does not read a comment as a redirection target", () => {
		const script = ShellSyntax.parse("echo > #x");
		assert.deepStrictEqual(
			script.diagnostics.map((d) => d.code),
			["MissingRedirectionTarget"],
		);
		assert.deepStrictEqual(
			script.comments.map((c) => c.text),
			["x"],
		);
	});
});

describe("diagnostics", () => {
	it("derives a message from the code", () => {
		const [diagnostic] = ShellSyntax.parse("echo 'x").diagnostics;
		assert.instanceOf(diagnostic, ShellDiagnostic);
		assert.strictEqual(diagnostic?.message, "single-quoted string is not closed");
		assert.strictEqual(diagnostic?.offset, 5);
		assert.strictEqual(diagnostic?.length, 2);
	});

	it("covers every unterminated construct with an opaque part to the end", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["a 'b", "UnterminatedSingleQuote"],
			['a "b', "UnterminatedDoubleQuote"],
			["a $'b", "UnterminatedAnsiCQuote"],
			["a $(b", "UnterminatedCommandSubstitution"],
			["a $((b", "UnterminatedArithmetic"],
			["a $((b) c", "UnterminatedCommandSubstitution"],
			["((b", "UnterminatedArithmetic"],
			["a $[b", "UnterminatedArithmetic"],
			["a[b c", "UnterminatedSubscript"],
			["a `b", "UnterminatedBacktick"],
			["a <(b", "UnterminatedProcessSubstitution"],
			["a ${b", "UnterminatedParameterExpansion"],
			["x=(a b", "UnterminatedArrayAssignment"],
		];
		for (const [input, code] of cases) {
			const script = ShellSyntax.parse(input);
			assert.deepStrictEqual(
				script.diagnostics.map((d) => d.code),
				[code],
				input,
			);
			const segment = script.segments[0];
			const last = segment?.words.at(-1) ?? segment?.assignments.at(-1)?.value;
			const part = last?.parts.at(-1);
			assert.strictEqual(part?.kind, "opaque", input);
			assert.strictEqual(part?.end, input.length, input);
		}
	});
});

describe("ShellSyntax.parseEffect", () => {
	it.effect("succeeds with the same script as parse", () =>
		Effect.gen(function* () {
			const script = yield* ShellSyntax.parseEffect("git add -A && git commit");
			assert.deepStrictEqual(script, ShellSyntax.parse("git add -A && git commit"));
		}),
	);

	it.effect("succeeds on input parse cannot finish, with its diagnostics", () =>
		Effect.gen(function* () {
			const script = yield* ShellSyntax.parseEffect('echo "unterminated $(');
			assert.isAbove(script.diagnostics.length, 0);
		}),
	);
});
