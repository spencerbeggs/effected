// Every command string here once hid a command bash runs (each checked with
// GNU bash 5.3 by running it with `touch ran` in place of `git commit`). Each
// group is pinned against a control that differs in the one token the rule is
// about, so a fix that over-corrects shows up as a failing control.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { ShellCommand, ShellScript, ShellWord } from "../src/index.js";
import { ShellSyntax } from "../src/index.js";

const baseName = (name: string): string => name.slice(name.lastIndexOf("/") + 1);

/** Every command name the script runs, through every substitution, depth-first. */
const allNames = (script: ShellScript, depth = 0): ReadonlyArray<string | null> => [
	...script.commands().map((command) => Option.getOrNull(command.name)),
	...(depth < 16
		? script.substitutions().flatMap((part) => allNames(ShellSyntax.parse(part.body), depth + 1))
		: ["<too deep>"]),
];

const names = (input: string): ReadonlyArray<string | null> => allNames(ShellSyntax.parse(input));

const codes = (input: string): ReadonlyArray<string> => ShellSyntax.parse(input).diagnostics.map((d) => d.code);

const resolve = (input: string): { readonly name: string | null; readonly wrappers: ReadonlyArray<string> } => {
	const [command] = ShellSyntax.parse(input).commands();
	return { name: Option.getOrNull(command?.name ?? Option.none()), wrappers: command?.wrappers ?? [] };
};

describe("(( … )) is arithmetic, where << is a shift and opens no heredoc", () => {
	const hidden: ReadonlyArray<string> = [
		"(( x = 1 << 2 ))\ngit commit -m x\n2\n",
		"(( x = 1 << 2 ))\ngit commit -m x",
		"((x<<1)); git commit -m x\n1\n",
		"if (( 1 << 0 )); then git commit -m x; fi\n0\n",
		"while (( 1 << 0 )) do git commit -m x; done\n0\n",
		"f() (( x << 2 ))\ngit commit -m x\n2\n",
		"echo $(( 1 << 2\n))\ngit commit -m x\n2\n",
		"x=$( (( 1 << 2 ))\ngit commit -m x\n2\n)",
		// The nested scanner must not read a heredoc either, or it swallows the `)`.
		"x=$( (( 1 << 2 ))\n)\ngit commit -m x\n2\n",
		`echo \${y:-$(( 1 << 2\n))}\ngit commit -m x\n2\n`,
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			assert.deepStrictEqual(codes(input), []);
		});
	}

	it("control: << outside arithmetic still opens a heredoc that holds the next lines", () => {
		assert.notInclude(names("cat << 2\ngit commit -m x\n2\n"), "git");
		// `let` takes ordinary words, so bash reads this `<<` as a heredoc too.
		assert.notInclude(names("let x=1<<2\ngit commit -m x\n2\n"), "git");
		assert.deepStrictEqual(
			ShellSyntax.parse("cat << 2\ngit commit -m x\n2\n").segments[0]?.heredocs.map((h) => h.body),
			["git commit -m x\n"],
		);
	});

	it("records the arithmetic command as one word with an arithmetic part", () => {
		const [segment] = ShellSyntax.parse("(( x = 1 << 2 ))").segments;
		const part = segment?.words[0]?.parts[0];
		assert.strictEqual(part?.kind, "arithmetic");
		if (part?.kind === "arithmetic") {
			assert.isTrue(part.command);
			assert.strictEqual(part.body, " x = 1 << 2 ");
		} else {
			assert.fail("expected an arithmetic part");
		}
		const expansion = ShellSyntax.parse("echo $((1 << 2))").segments[0]?.words[1]?.parts[0];
		assert.isTrue(expansion?.kind === "arithmetic" && !expansion.command);
		// It runs no command, but bash evaluates it, so it names itself `((`.
		const [command] = ShellSyntax.parse("(( x > 1 ))").commands();
		assert.isTrue(command !== undefined && Option.getOrNull(command.name) === "((" && command.args.length === 0);
	});

	it("lists the substitutions inside an arithmetic command", () => {
		assert.deepStrictEqual(
			ShellSyntax.parse("(( x[$(git commit)] + `a` ))")
				.substitutions()
				.map((s) => s.body),
			["git commit", "a"],
		);
	});

	it("((cmd) ) is two subshells, not arithmetic", () => {
		assert.include(names("((git commit -m x) )"), "git");
		assert.include(names("((cd x; git commit) && true)"), "git");
		assert.include(names("$((git commit) )"), "git");
		// Fully arithmetic: bash evaluates the words as an expression and runs nothing.
		assert.notInclude(names("((git commit))"), "git");
	});

	it("an unterminated (( is opaque to the end with a diagnostic", () => {
		assert.deepStrictEqual(codes("(( 1 << 2\ngit commit"), ["UnterminatedArithmetic"]);
	});
});

describe("$[ … ] is legacy arithmetic, where << is a shift and opens no heredoc", () => {
	// bash reads `$[` to its matching `]` (nested brackets, quotes and
	// substitutions included) and runs every one of these `git` lines.
	const hidden: ReadonlyArray<string> = [
		"echo $[1<<2]\ngit commit -m x\n2]\n",
		"echo $[1 << 2]\ngit commit -m x\n2]\n",
		"echo $[ [1] << 2 ]\ngit commit -m x\n2 ]\n",
		`echo \${x:-$[1<<2]}\ngit commit -m x\n2]}\n`,
		// The nested scanner reads `$[` too, or its heredoc swallows the `)`
		// that closes the substitution, and the `git` line after it.
		"x=$(echo $[1<<2]\ngit commit -m x\n2]\n)",
		"x=$(echo $[1<<2]\n)\ngit commit -m x\n2]\n",
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			assert.deepStrictEqual(codes(input), []);
		});
	}

	it("control: without the $, [1<<2] is a word and << a heredoc, at top level and nested", () => {
		// bash runs neither `git` line: the heredoc `2]` holds it.
		assert.notInclude(names("echo [1<<2]\ngit commit -m x\n2]\n"), "git");
		assert.notInclude(names("x=$(echo [1<<2]\ngit commit -m x\n2]\n)"), "git");
		assert.notInclude(names("x=$(echo $ [1<<2]\ngit commit -m x\n2]\n)"), "git");
		assert.notInclude(names("x=$(echo [1<<2]\n)\ngit commit -m x\n2]\n"), "git");
		// Inside double quotes `<` is inert either way.
		assert.include(names('echo "$[1<<2]"\ngit commit -m x'), "git");
	});

	it("records $[ … ] as an arithmetic expansion with its substitutions", () => {
		const part = ShellSyntax.parse("echo $[1 << $(git commit)]").segments[0]?.words[1]?.parts[0];
		if (part?.kind === "arithmetic") {
			assert.isFalse(part.command);
			assert.strictEqual(part.raw, "$[1 << $(git commit)]");
			assert.strictEqual(part.body, "1 << $(git commit)");
			assert.deepStrictEqual(
				part.substitutions.map((s) => s.body),
				["git commit"],
			);
		} else {
			assert.fail("expected an arithmetic part");
		}
		assert.isTrue(Option.isNone(ShellSyntax.parse("echo $[1]").segments[0]?.words[1]?.literal ?? Option.some("")));
		assert.include(names("x=$(echo $[ $(git commit -m x) ])"), "git");
	});

	it("an unterminated $[ is opaque to the end with a diagnostic, as bash rejects it", () => {
		assert.deepStrictEqual(codes("echo $[1\ngit commit -m x"), ["UnterminatedArithmetic"]);
	});
});

describe("a command-position NAME[ … ] subscript is a matched pair, where << is no heredoc", () => {
	// bash reads the subscript of a word that starts `NAME[` in command
	// position as a matched pair, spaces, `<<`, `#` and newlines included,
	// with or without a following `=`, and runs every one of these `git` lines.
	const hidden: ReadonlyArray<string> = [
		"a[1<<2]=x\ngit commit -m x\n2]=x\n",
		"a[1<<2]+=x\ngit commit -m x\n2]+=x\n",
		"a[1 << 2]=x\ngit commit -m x\n2]=x\n",
		"FOO=1 a[1<<2]=x\ngit commit -m x\n2]=x\n",
		"a[x<<2]=1 true\ngit commit -m x\n2]=1\n",
		"a[1<<2]\ngit commit -m x\n2]\n",
		"a[1<<2]b\ngit commit -m x\n2]b\n",
		"a[1]=x b[1<<2]=y\ngit commit -m x\n2]=y\n",
		"time a[1<<2]=x\ngit commit -m x\n2]=x\n",
		"if a[1<<2]=x; then :; fi\ngit commit -m x\n2]=x\n",
		"true | a[1<<2]=x\ngit commit -m x\n2]=x\n",
		// `#` inside the subscript is no comment.
		"a[1 #]; git commit -m x",
		// The nested scanner reads the subscript at a word start too.
		"x=$(a[1<<2]=y\ngit commit -m x\n2]=y\n)",
		"x=$( : ; a[1<<2]=y\ngit commit -m x\n2]=y\n)",
		"x=$(a[1 #]; git commit -m x)",
		"x=$(a[1<<2]=y\n)\ngit commit -m x\n2]=y\n",
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			assert.deepStrictEqual(codes(input), []);
		});
	}

	it("control: in argument position, or after a quoted or escaped name, << is a heredoc", () => {
		// bash reads a heredoc in each of these and runs no `git`.
		const heredocs: ReadonlyArray<string> = [
			"echo a[1<<2]\ngit commit -m x\n2]\n",
			"true a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"declare a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"export a[1<<2]=x\ngit commit -m x\n2]=x\n",
			// Only the first subscript of the word, right after the name.
			"a[1]b[1<<2]=x\ngit commit -m x\n2]=x\n",
			'"a"[1<<2]\ngit commit -m x\n2]\n',
			"a\\[1<<2]\ngit commit -m x\n2]\n",
			"9a[1<<2]\ngit commit -m x\n2]\n",
			// A heredoc after the closed subscript still opens.
			"a[1<<2]=x <<E\ngit commit -m x\nE\n",
		];
		for (const input of heredocs) assert.notInclude(names(input), "git", input);
		// An array value's `[k]=v` keys were already safe.
		assert.include(names("x=([1<<2]=y)\ngit commit -m x"), "git");
	});

	it("over-reports, never hides, an argument-position subscript inside $(…)", () => {
		// bash reads a heredoc in both and runs no `git`. The nested scanner
		// does not track command position, so it reads a subscript at every
		// word start and opens no heredoc. Here that costs nothing: it ends at
		// the same `)`, and the re-parsed body reads the heredoc as bash does.
		assert.notInclude(names("x=$(echo a[1<<2]\ngit commit -m x\n2]\n)"), "git");
		// A `)` inside the heredoc body then closes the substitution early, and
		// the line after it is reported as a command bash never runs.
		assert.include(names("x=$(echo a[1<<2]\n)\ngit commit -m x\n2]\n)"), "git");
	});

	it("records the subscripted assignment, and a word when no = follows", () => {
		const [segment] = ShellSyntax.parse("a[1 << 2]+=x git status").segments;
		assert.deepStrictEqual(
			segment?.assignments.map((a) => [a.name, a.append, Option.getOrNull(a.value.literal)]),
			[["a[1 << 2]", true, "x"]],
		);
		assert.strictEqual(resolve("a[1 << 2]+=x git status").name, "git");
		const word = ShellSyntax.parse("a[1<<2]b").segments[0]?.words[0];
		assert.deepStrictEqual(
			word?.parts.map((p) => [p.kind, p.raw]),
			[
				["bare", "a"],
				["opaque", "[1<<2]"],
				["bare", "b"],
			],
		);
		assert.isTrue(word !== undefined && Option.isNone(word.literal));
		assert.strictEqual(resolve("a[1<<2]").name, null);
	});

	it("a subscript holding a substitution is an assignment that lists the substitution", () => {
		const script = ShellSyntax.parse("a[$(git commit -m x)]=x");
		assert.deepStrictEqual(
			script.segments[0]?.assignments.map((a) => [a.name, a.subscript.map((s) => s.body)]),
			[["a[$(git commit -m x)]", ["git commit -m x"]]],
		);
		assert.deepStrictEqual(script.segments[0]?.words, []);
		assert.deepStrictEqual(
			script.substitutions().map((s) => s.body),
			["git commit -m x"],
		);
		assert.include(names("a[$(git commit -m x)]"), "git");
		// A variable alone keeps the assignment.
		assert.deepStrictEqual(
			ShellSyntax.parse("a[$i]=1 git status").segments[0]?.assignments.map((a) => a.name),
			["a[$i]"],
		);
	});

	it("a subscript spans newlines; an unterminated one is opaque to the end, as bash rejects it", () => {
		assert.deepStrictEqual(
			ShellSyntax.parse("a[\n]=x; git status").segments[0]?.assignments.map((a) => a.name),
			["a[\n]"],
		);
		assert.include(names("a[\n]=x; git commit -m x"), "git");
		assert.deepStrictEqual(codes("a[1\ngit commit -m x"), ["UnterminatedSubscript"]);
	});
});

describe("command position follows bash's reserved_word_acceptable, not a local flag", () => {
	const hidden: Record<string, ReadonlyArray<string>> = {
		"an assignment keeps it, whatever its subscript holds": [
			"a[$(true)]=1 b[1<<2]=y\ngit commit -m x\n2]=y\n",
			"a[`true`]=1 b[1<<2]=y\ngit commit -m x\n2]=y\n",
			'a["$(true)"]=1 b[1<<2]=y\ngit commit -m x\n2]=y\n',
			"a[$(true)]+=1 b[1<<2]=y\ngit commit -m x\n2]=y\n",
			"x=$(a[$(true)]=1 b[1<<2]=y\ngit commit -m x\n2]=y\n)",
		],
		"time -p and time -- keep it": [
			"time -p a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"time -- a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"time -p -- a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"time -p time -p a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"! time -p a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"time -p ! a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"x=$(time -p a[1<<2]=x\ngit commit -m x\n2]=x\n)",
		],
		"the word after function NAME and coproc NAME gets it back": [
			"function f { a[1<<2]=x\ngit commit -m x\n2]=x\n}; f",
			"coproc C { a[1<<2]=x\ngit commit -m x\n2]=x\n}; wait",
			"coproc C a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"x=$(function f { a[1<<2]=y\ngit commit -m x\n2]=y\n}; f)",
		],
		"a reserved word after ]], ((…)) or for NAME gets it back": [
			"if [[ x ]] then a[1<<2]=x\ngit commit -m x\n2]=x\nfi",
			"if ((1)) then a[1<<2]=x\ngit commit -m x\n2]=x\nfi",
			"for ((i=0;i<1;i++)) do a[1<<2]=x\ngit commit -m x\n2]=x\ndone",
			"for ((i=0;i<1;i++)) { a[1<<2]=x\ngit commit -m x\n2]=x\n}",
			"set -- 1; for x do a[1<<2]=x\ngit commit -m x\n2]=x\ndone",
		],
	};
	for (const [rule, inputs] of Object.entries(hidden)) {
		describe(rule, () => {
			for (const input of inputs) {
				it(JSON.stringify(input), () => {
					assert.include(names(input), "git");
					assert.deepStrictEqual(codes(input), []);
				});
			}
		});
	}

	it("control: argument position still reads the heredoc", () => {
		for (const input of [
			"time -x a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"true -p a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"time -p x a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"coproc C x a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"function f g a[1<<2]=x\ngit commit -m x\n2]=x\n",
			'time "-p" a[1<<2]=x\ngit commit -m x\n2]=x\n',
			"[[ x a[1<<2]=x\ngit commit -m x\n2]=x\n",
		]) {
			assert.notInclude(names(input), "git", JSON.stringify(input));
		}
	});

	it("records a substituting subscript as an assignment, so the command resolves past it", () => {
		const script = ShellSyntax.parse("a[$(true)]=1 git commit -m x");
		assert.strictEqual(resolve("a[$(true)]=1 git commit -m x").name, "git");
		assert.deepStrictEqual(
			script.substitutions().map((s) => s.body),
			["true"],
		);
	});
});

describe("a backslash-newline is gone before bash tokenizes", () => {
	const hidden: ReadonlyArray<string> = [
		"a\\\n[1<<2]=x\ngit commit -m x\n2]=x\n",
		"ab\\\nc[1<<2]=x\ngit commit -m x\n2]=x\n",
		"echo $\\\n[1<<2]\ngit commit -m x\n2]\n",
		"(\\\n(1<<2))\ngit commit -m x\n2\n",
		"x=$( (\\\n(1<<2))\ngit commit -m x\n2\n)",
		"x=$(a\\\n[1<<2]=y\ngit commit -m x\n2]=y\n)",
		"x=$(echo $\\\n[1<<2]\ngit commit -m x\n2]\n)",
		// The closer sits where the wrong span would swallow it.
		"x=$(a\\\n[1<<2]=y\n)\ngit commit -m x\n2]=y\n",
		"x=$(echo $\\\n[1<<2]\n)\ngit commit -m x\n2]\n",
		"x=$( (\\\n(1<<2))\n)\ngit commit -m x\n2\n",
		"ti\\\nme a[1<<2]=x\ngit commit -m x\n2]=x\n",
		"ti\\\nme -\\\np a[1<<2]=x\ngit commit -m x\n2]=x\n",
		"F\\\nOO=1 git commit -m x",
		// Through a heredoc operator and delimiter.
		"cat <<\\\n-E\nbody\nE\ngit commit -m x\n-E\n",
		"x=$(cat <<\\\n-E\nbody\nE\ngit commit -m x\n-E\n)",
		"cat <<E\\\nND\nEND\ngit commit -m x\nE\n",
		"x=$(cat <<E\\\nND\nEND\n)\ngit commit -m x\nE\n)",
		"cat <\\\n<E\nx\nE\ngit commit -m x\n",
		// Through a heredoc's delimiter line, under an unquoted delimiter.
		"cat <<END\nbody\nE\\\nND\ngit commit -m x\nEND\n",
		"cat <<E\nbody\nE\\\n\ngit commit -m x\nE\n",
		"x=$(cat <<END\nbody\nE\\\nND\n)\ngit commit -m x\nEND\n)",
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			assert.deepStrictEqual(codes(input), []);
		});
	}

	it("every part keeps source offsets across a removed newline", () => {
		const source = "echo $\\\n[1] $\\\n(a) $\\\n{b} $\\\nc\n(\\\n(2))\na\\\n[3]=4\n";
		const script = ShellSyntax.parse(source);
		const parts = script.segments[0]?.words.slice(1).flatMap((w) => w.parts) ?? [];
		assert.deepStrictEqual(
			parts.map((p) => [p.kind, source.slice(p.start, p.end)]),
			[
				["arithmetic", "$\\\n[1]"],
				["commandSubstitution", "$\\\n(a)"],
				["variable", "$\\\n{b}"],
				["variable", "$\\\nc"],
			],
		);
		assert.deepStrictEqual(
			script.substitutions().map((s) => s.body),
			["a"],
		);
		assert.deepStrictEqual(script.segments[2]?.assignments[0]?.name, "a[3]");
	});

	it("control: in a comment, single quotes or an escaped backslash it is no continuation", () => {
		assert.include(names("# x \\\ngit commit -m x"), "git");
		assert.include(names("echo \\\\\ngit commit -m x"), "git");
		assert.include(names("x=$(echo \\\\\n#it's\ngit commit -m x\n)"), "git");
		assert.deepStrictEqual(names("echo 'a\\\n[1<<2]'"), ["echo"]);
	});

	it("a continuation before # leaves it inside the word, in the nested scanner too", () => {
		assert.include(names("x=$(echo a\\\n#b) && git commit -m x"), "git");
		assert.deepStrictEqual(codes("x=$(echo a\\\n#b) && git commit -m x"), []);
	});

	it("control: a quoted delimiter's body keeps its lines apart", () => {
		assert.notInclude(names("cat <<'E'\nbody\nE\\\n\ngit commit -m x\nE\n"), "git");
		assert.notInclude(names("x\\\n=1 cat <<E\nx\\\nE\ngit commit -m x\nE\n"), "git");
	});
});

describe("a metacharacter in an array is a syntax error: bash discards that line and runs the next", () => {
	const hidden: ReadonlyArray<string> = [
		"( function f x=( >f else declare \ngit commit -m x\n )",
		"echo until && x=( function f ; exec <<'E' fi \ngit commit -m x\n export ))",
		"x=( & \ngit commit -m x\n)",
		"x=( <<E\ngit commit -m x\nE\n",
		"x=( & ' \ngit commit -m x\n'\n",
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			assert.include(codes(input), "UnterminatedArrayAssignment");
		});
	}

	it("control: a closed array across lines holds its elements", () => {
		assert.deepStrictEqual(names("x=(a\nb\n) git status"), ["git"]);
		assert.deepStrictEqual(codes("x=(a\nb\n) git status"), []);
	});
});

describe("a backslash before CRLF escapes the CR, and the LF still ends the command", () => {
	for (const input of ["echo x \\\r\ngit commit -m x", "echo x\\\r\ngit commit -m x"]) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			assert.deepStrictEqual(codes(input), []);
		});
	}

	it("the CR is the escaped character", () => {
		const [word] = ShellSyntax.parse("x\\\r\n").segments[0]?.words ?? [];
		assert.strictEqual(Option.getOrNull(word?.literal ?? Option.none()), "x\r");
	});
});

describe("a heredoc delimiter holding an expansion reads no body, with a diagnostic", () => {
	const hidden: ReadonlyArray<string> = [
		"cat <<$[1 2]\n$[1 2]\ngit commit -m x\n$[1\n",
		"cat <<$[1<<2]\n$[1<<2]\ngit commit -m x\n$[1\n2]\n",
		"cat <<$((1<<2))\n$((1<<2))\ngit commit -m x\n$\n",
		"cat <<$(true)\n$(true)\ngit commit -m x\n$\n",
		// bash rebuilds a $( … ) from its parse: the delimiter line is `$(true)`.
		"cat <<$(  true  )\n$(true)\ngit commit -m x\n$(  true  )\n",
		"cat <<`true`\n`true`\ngit commit -m x\n`\n",
		`cat <<\${x}\n\${x}\ngit commit -m x\n$\n`,
		"cat <<E<(x)\nE<(x)\ngit commit -m x\nE\n",
		'cat <<"$(true)"\n$(true)\ngit commit -m x\n$(\n',
		"x=$(cat <<$((1<<2))\n$((1<<2))\ngit commit -m x\n$\n)",
		"x=$(cat <<$[1<<2]\n$[1<<2]\ngit commit -m x\n)",
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(names(input), "git");
			const nested = ShellSyntax.parse(input);
			const all = [...nested.diagnostics.map((d) => d.code), ...nested.substitutions().flatMap((s) => codes(s.body))];
			assert.include(all, "ExpansionInHeredocDelimiter");
		});
	}

	it("the README guard refuses them", () => {
		assert.isFalse(ShellSyntax.parse("cat <<$(true)\n$(true)\ngit commit -m x\n").diagnostics.length === 0);
	});

	it("$'…' and $\"…\" delimiters are their quoted text", () => {
		for (const input of [
			"cat <<$'E'\nE\ngit commit -m x\n$E\n",
			'cat <<$"E"\nE\ngit commit -m x\n$E\n',
			"cat <<$'\\x45'\nE\ngit commit -m x\n$E\n",
			"x=$(cat <<$'E'\nE\n)\ngit commit -m x\n$E\n)",
		]) {
			assert.include(names(input), "git", JSON.stringify(input));
		}
		assert.deepStrictEqual(
			ShellSyntax.parse("cat <<$'E'\nb\nE\n").segments[0]?.heredocs.map((h) => [h.delimiter, h.quoted, h.body]),
			[["E", true, "b\n"]],
		);
	});

	it("control: a plain $NAME delimiter is the literal word and still holds its body", () => {
		assert.notInclude(names("cat <<$E\ngit commit -m x\n$E\n"), "git");
		assert.deepStrictEqual(codes("cat <<$E\ngit commit -m x\n$E\n"), []);
	});
});

describe("known limits, pinned so the docs cannot drift from them (each hides git from bash 5.3)", () => {
	it("extglob and aliases change the parse, with no diagnostic, and show up as command names", () => {
		const extglob = "shopt -s extglob\necho @(<<E)\ngit commit -m x\nE\n";
		assert.notInclude(names(extglob), "git");
		assert.deepStrictEqual(codes(extglob), []);
		assert.include(names(extglob), "shopt");
		const alias = "shopt -s expand_aliases\nalias c='git commit -m x'\nc\n";
		assert.notInclude(names(alias), "git");
		assert.deepStrictEqual(codes(alias), []);
		assert.include(names(alias), "alias");
	});

	it("an unbalanced subscript at a word start of $( … ) hides, with a diagnostic", () => {
		const input = "x=$(echo a[ )\ngit commit -m x\n";
		assert.notInclude(names(input), "git");
		assert.include(codes(input), "UnterminatedCommandSubstitution");
	});
});

describe("assignments after reserved words and compound commands", () => {
	const cases: ReadonlyArray<string> = [
		"if FOO=1 git commit -m x; then :; fi",
		"! FOO=1 git commit",
		"{ FOO=1 git commit; }",
		"time FOO=1 git commit",
		"time -p FOO=1 git commit",
		"while FOO=1 git commit; do :; done",
		"if [[ -n x ]] then FOO=1 git commit; fi",
	];
	for (const input of cases) {
		it(input, () => {
			assert.strictEqual(
				names(input).find((name) => name !== null && name !== ":"),
				"git",
			);
		});
	}

	it("the lexer records the assignment, not a word", () => {
		for (const input of cases.slice(0, 4)) {
			const segment = ShellSyntax.parse(input).segments[0];
			assert.deepStrictEqual(
				segment?.assignments.map((a) => a.name),
				["FOO"],
				input,
			);
		}
	});

	it("control: a quoted or escaped NAME=value is a command, and after a command it is an argument", () => {
		assert.strictEqual(resolve("'FOO=1' git commit").name, "FOO=1");
		assert.strictEqual(resolve("if \\FOO=1 git; then :; fi").name, "FOO=1");
		assert.strictEqual(resolve("echo FOO=1 git").name, "echo");
		assert.deepStrictEqual(ShellSyntax.parse("echo FOO=1").segments[0]?.assignments, []);
	});
});

describe("compound commands whose closing word runs into the next command", () => {
	const cases: ReadonlyArray<string> = [
		"if [[ 1 ]] then git commit; fi",
		"while [[ 1 ]] do git commit; break; done",
		"if ((1)) then git commit; fi",
		"for ((i=0;i<1;i++)) do git commit; done",
		"for ((;;)) { git commit; }",
		"for x do git commit; done",
		"select x in a; do git commit; done",
		"function f { git commit; }",
		"coproc git commit",
		"coproc X { git commit; }",
		"time { git commit; }",
		"time ! git commit",
	];
	for (const input of cases) {
		it(input, () => {
			assert.include(names(input), "git");
		});
	}

	it("control: a for list and a case head name no command", () => {
		assert.strictEqual(resolve("for x in git commit; do :; done").name, "for");
		// A whole `[[ … ]]` names itself, never the words inside it.
		assert.strictEqual(resolve("[[ git ]]").name, "[[");
		assert.strictEqual(resolve("[[ git").name, "[[");
	});
});

describe("env and sudo read NAME=value and options after quote removal", () => {
	const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		['env "FOO=1" git commit -m x', ["env"]],
		["env 'A=b c' git commit", ["env"]],
		['sudo "FOO=1" git commit', ["sudo"]],
		['env "-i" git commit', ["env"]],
		["env -- FOO=1 git commit", ["env"]],
		['env B="$X" git commit', ["env"]],
		["/usr/bin/env git commit -m x", ["/usr/bin/env"]],
		["/usr/bin/sudo -u root git commit", ["/usr/bin/sudo"]],
	];
	for (const [input, wrappers] of cases) {
		it(input, () => {
			assert.deepStrictEqual(resolve(input), { name: "git", wrappers });
		});
	}

	it("control: a quoted word with no = is the command", () => {
		assert.deepStrictEqual(resolve('env "FOO" git'), { name: "FOO", wrappers: ["env"] });
		assert.deepStrictEqual(resolve('env "$CMD" git'), { name: null, wrappers: ["env"] });
		assert.deepStrictEqual(resolve("./env git"), { name: "git", wrappers: ["./env"] });
		assert.deepStrictEqual(resolve("envy git"), { name: "envy", wrappers: [] });
	});
});

describe("substitutions hidden inside brace spans, arrays and parameter expansions", () => {
	const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		["echo {a,$(git commit -m x)}", ["git commit -m x"]],
		['echo {a,"$(git commit)"}', ["git commit"]],
		["echo {a,<(git commit)}", ["git commit"]],
		["x=($(git commit -m x))", ["git commit -m x"]],
		["x=(a <(git commit))", ["git commit"]],
		["x=(a # $(no)\n $(git commit))", ["git commit"]],
		[`echo \${x:-<(git commit)}`, ["git commit"]],
	];
	for (const [input, bodies] of cases) {
		it(input, () => {
			assert.deepStrictEqual(
				ShellSyntax.parse(input)
					.substitutions()
					.map((s) => s.body),
				bodies,
			);
			assert.include(names(input), "git");
		});
	}

	it("control: a brace pair that does not expand keeps its substitution in the word", () => {
		const [word] = ShellSyntax.parse("{$(git commit)}").segments[0]?.words ?? [];
		assert.deepStrictEqual(
			word?.parts.map((p) => p.kind),
			["bare", "commandSubstitution", "bare"],
		);
	});
});

describe("a backtick body is what bash runs, after escape removal", () => {
	it("a nested backtick pair becomes visible to the nested parse", () => {
		assert.include(names("echo `echo \\`git commit -m x\\``"), "git");
		assert.include(names('echo "`echo \\`git commit\\``"'), "git");
		assert.deepStrictEqual(
			ShellSyntax.parse("echo `echo \\`git commit\\``")
				.substitutions()
				.map((s) => s.body),
			["echo `git commit`"],
		);
	});

	it('inside double quotes \\" loses its backslash too, outside it does not', () => {
		const inQuotes = ShellSyntax.parse('echo "`echo \\"hi\\" && git commit`"').substitutions();
		assert.deepStrictEqual(
			inQuotes.map((s) => s.body),
			['echo "hi" && git commit'],
		);
		assert.deepStrictEqual(ShellSyntax.parse(inQuotes[0]?.body ?? "").diagnostics, []);
		assert.deepStrictEqual(
			ShellSyntax.parse('echo `echo \\"hi\\"`')
				.substitutions()
				.map((s) => s.body),
			['echo \\"hi\\"'],
		);
		// $( … ) bodies are the source as written.
		assert.deepStrictEqual(
			ShellSyntax.parse("echo $(echo \\`x\\`)")
				.substitutions()
				.map((s) => s.body),
			["echo \\`x\\`"],
		);
	});
});

describe("smaller fixes", () => {
	it("a segment of reserved words alone resolves to no command, with no args", () => {
		const commands = ShellSyntax.parse("if true; then git status; fi").commands();
		assert.deepStrictEqual(
			commands.map((c) => [Option.getOrNull(c.name), c.args.length]),
			[
				["true", 0],
				["git", 1],
				[null, 0],
			],
		);
	});

	it("caps the diagnostics and says so", () => {
		const script = ShellSyntax.parse(";;&".repeat(5000));
		assert.lengthOf(script.diagnostics, 1001);
		assert.strictEqual(script.diagnostics.at(-1)?.code, "DiagnosticLimitReached");
		assert.strictEqual(ShellSyntax.parse(";;&".repeat(100)).diagnostics.length, 100);
	});

	it("fails closed on a heredoc delimiter written as EOF) inside $(…), which bash accepts", () => {
		const input = 'echo "$(cat <<EOF\nhi\nEOF)"\ngit commit';
		assert.isAbove(codes(input).length, 0);
	});
});

/** Every diagnostic code, through every substitution, depth-first. */
const allCodes = (script: ShellScript, depth = 0): ReadonlyArray<string> => [
	...script.diagnostics.map((d) => d.code),
	...(depth < 16 ? script.substitutions().flatMap((part) => allCodes(ShellSyntax.parse(part.body), depth + 1)) : []),
];

const QUOTED = "QuotedSubstitutionInExpansion";

describe("a quoted run that bash expands anyway is reported, never skipped", () => {
	// Each was run with GNU bash 5.3.20 as `c1(){ echo RAN >&2; }; <input>`:
	// bash runs c1 in every one. Inside `${…}` in double quotes or a heredoc,
	// inside arithmetic and inside an indexed array's subscript, bash honours
	// a `'…'` run only to find the closer, then expands what it holds.
	const hidden: ReadonlyArray<string> = [
		`echo "\${x:-'$(c1)'}"`,
		`echo "\${x:-'\`c1\`'}"`,
		`echo "\${x:-$'$(c1)'}"`,
		`cat <<E\n\${x:-'$(c1)'}\nE\n`,
		`echo "$(echo "\${x:-'$(c1)'}")"`,
		`echo "\${x:-\${y:-'$(c1)'}}"`,
		`echo \${x:-"\${y:-'$(c1)'}"}`,
		`echo "\${x:-'\${y:-$(c1)}'}"`,
		`echo "\${x:-$'\\x41$(c1)'}"`,
		`[[ "\${x:-'$(c1)'}" ]]`,
		`echo $(( '$(c1)' ))`,
		`(( '$(c1)' ))`,
		// A bare `(` inside arithmetic is still arithmetic (ARITH_PAREN).
		`echo $(( ( '$(c1)' ) ))`,
		`(( ( '$(c1)' ) ))`,
		`echo $[ '$(c1)' ]`,
		`echo $(( \${x:-'$(c1)'} ))`,
		`a['$(c1)']=1`,
		`echo \${a['$(c1)']}`,
		`x=(['$(c1)']=1)`,
		`x=$(echo "\${x:-'$(c1)'}")`,
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED);
		});
	}

	it("reports each run it finds, at the run", () => {
		const input = `echo "\${x:-'$(c1)'}" "\${y:-'$(c2)'}"`;
		const script = ShellSyntax.parse(input);
		assert.deepStrictEqual(
			script.diagnostics.map((d) => [d.code, input.slice(d.offset, d.offset + d.length)]),
			[
				[QUOTED, "'$(c1)'"],
				[QUOTED, "'$(c2)'"],
			],
		);
	});

	it("control: the same shapes without the opener record nothing", () => {
		for (const input of [
			`echo "\${x:-'c1'}"`,
			`echo "\${x:-$'c1'}"`,
			`cat <<E\n\${x:-'c1'}\nE\n`,
			`echo "$(echo "\${x:-'c1'}")"`,
			`echo $(( '1' ))`,
			`a['1']=1`,
			`x=(['1']=1)`,
			// A double-quoted run holds an ordinary substitution, listed as one.
			`echo "\${x:-"$(c1)"}"`,
		]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
		assert.deepStrictEqual(
			ShellSyntax.parse(`echo "\${x:-"$(c1)"}"`)
				.substitutions()
				.map((s) => s.body),
			["c1"],
		);
		// Outside any expansion a single-quoted $( is literal, as bash reads it.
		assert.deepStrictEqual(codes("echo '$(c1)' \"'$(c2)'\""), []);
	});

	it("over-reports where bash keeps the run quoted, which bash 5.3 runs nothing for", () => {
		// `x=a; echo "${x//a/'$(c1)'}"` prints `$(c1)` and `echo ${x:-'$(c1)'}`
		// prints `$(c1)`: the scanner does not model which operator or quoting
		// keeps the run literal, so both are reported.
		assert.include(codes(`echo "\${x//a/'$(c1)'}"`), QUOTED);
		assert.include(codes(`echo \${x:-'$(c1)'}`), QUOTED);
	});

	it("a demoted $(( … )) is a substitution whose re-parsed body is read as command text", () => {
		// `$((echo '$(c1)') )` is a command substitution holding a subshell, where
		// the quotes are real; bash runs nothing inside them.
		assert.deepStrictEqual(allCodes(ShellSyntax.parse(`echo $((echo '$(c1)') )`)), []);
	});

	it("the README guard refuses them", () => {
		for (const input of [
			`echo "\${x:-'$(git commit)'}"`,
			`echo "\${x:-'\`git commit\`'}"`,
			`echo "\${x:-$'$(git commit)'}"`,
			`cat <<E\n\${x:-'$(git commit)'}\nE\n`,
			`echo "$(echo "\${x:-'$(git commit)'}")"`,
			`echo "\${x:-'$(git status)'}" "\${y:-'$(git commit)'}"`,
			`(( '$(git commit)' ))`,
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("wrapper options are read as getopt_long reads them", () => {
	// Each `env` case was run as `genv …` against GNU coreutils 9.12 (and the
	// BSD one as /usr/bin/env on macOS), each `sudo` case against sudo 1.9.17's
	// option errors, with `sh -c 'echo RAN'` as the command: every one runs it.
	const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
		["env --unse FOO git commit", ["env"]],
		["env --chd /tmp git commit", ["env"]],
		["env -- -x=1 git commit", ["env"]],
		["env =x git commit", ["env"]],
		["env -a foo git commit", ["env"]],
		["env --ar foo git commit", ["env"]],
		["env -P /bin git commit", ["env"]],
		["env time --out f git commit", ["env", "time"]],
		["sudo --us root git commit", ["sudo"]],
		["sudo --login git commit", ["sudo"]],
		["sudo -a type git commit", ["sudo"]],
	];
	for (const [input, wrappers] of cases) {
		it(input, () => {
			assert.deepStrictEqual(resolve(input), { name: "git", wrappers });
		});
	}

	it("control: a long option that is no prefix of a known one stops with no name", () => {
		for (const input of [
			"env --unsef FOO git commit",
			"env --chdx /tmp git commit",
			"env time --outx f git commit",
			"sudo --usx root git commit",
		]) {
			assert.strictEqual(resolve(input).name, null, input);
		}
	});

	it("an ambiguous prefix is unknown, as getopt_long rejects it", () => {
		// genv: "option '--i' is ambiguous; possibilities: '--ignore-environment' '--ignore-signal'".
		assert.deepStrictEqual(resolve("env --i FOO git commit"), { name: null, wrappers: ["env"] });
		assert.deepStrictEqual(resolve("env --d FOO git commit"), { name: null, wrappers: ["env"] });
		// sudo: "option `--c' is ambiguous", and `--logi` is login or login-class.
		assert.deepStrictEqual(resolve("sudo --c 3 git commit"), { name: null, wrappers: ["sudo"] });
		assert.deepStrictEqual(resolve("sudo --logi git commit"), { name: null, wrappers: ["sudo"] });
		// Control: a longer prefix is unique again.
		assert.deepStrictEqual(resolve("env --ignore-e FOO git commit"), { name: "FOO", wrappers: ["env"] });
	});

	it("an option env does not know is unknown, never a flag that hides its argument", () => {
		assert.deepStrictEqual(resolve("env -x FOO git commit"), { name: null, wrappers: ["env"] });
		// Control: a known flag is skipped and the next word is the command.
		assert.deepStrictEqual(resolve("env -i FOO git commit"), { name: "FOO", wrappers: ["env"] });
	});

	it("env --split stops with no name", () => {
		assert.deepStrictEqual(resolve("env --split 'git commit'"), { name: null, wrappers: ["env"] });
		assert.deepStrictEqual(resolve("env --sp='git commit'"), { name: null, wrappers: ["env"] });
		// Control: without it the quoted string is the command name.
		assert.deepStrictEqual(resolve("env 'git commit'"), { name: "git commit", wrappers: ["env"] });
	});

	it("env reads options only before its first assignment or command, then any word with = is an assignment", () => {
		// Control for `env -- -x=1`: before `--`, a word starting - is an option.
		assert.deepStrictEqual(resolve("env -x=1 git commit"), { name: null, wrappers: ["env"] });
		// Control for `env =x`: no = makes it the command.
		assert.deepStrictEqual(resolve("env x git commit"), { name: "x", wrappers: ["env"] });
		// genv A=1 -i sh: "‘-i’: No such file or directory".
		assert.deepStrictEqual(resolve("env A=1 -i git commit"), { name: "-i", wrappers: ["env"] });
		assert.deepStrictEqual(resolve("env -- -i git commit"), { name: "-i", wrappers: ["env"] });
		// A lone - keeps options open, as BSD env reads it (GNU runs `-u`): over-reported.
		assert.deepStrictEqual(resolve("env -i - -u HOME git commit"), { name: "git", wrappers: ["env"] });
	});

	it("control for -a and -P: a flag takes no argument", () => {
		assert.deepStrictEqual(resolve("env -i foo git commit"), { name: "foo", wrappers: ["env"] });
	});
});

describe("bash's evaluators of quoted text are reported, not hidden", () => {
	// Each runs `git commit` under GNU bash 5.3.20 (checked with a function
	// in its place), and the parse cannot see inside the evaluation: a guard
	// must refuse it by name, and the README guard does.
	const evaluators: ReadonlyArray<readonly [string, string]> = [
		["[[ 'a[$(git commit)]' -eq 0 ]]", "[["],
		["[[ 'a[$(git commit)]' -lt 0 ]]", "[["],
		["[[ -v 'a[$(git commit)]' ]]", "[["],
		["let 'a[$(git commit)]'", "let"],
		["declare -i v='a[$(git commit)]'", "declare"],
		["typeset -i v='a[$(git commit)]'", "typeset"],
		["local -i v='a[$(git commit)]'", "local"],
		["declare -n r='a[$(git commit)]'", "declare"],
		["printf -v 'a[$(git commit)]' %s 1", "printf"],
		["read 'a[$(git commit)]'", "read"],
		["[ -v 'a[$(git commit)]' ]", "["],
		["test -v 'a[$(git commit)]'", "test"],
		["trap 'git commit' EXIT", "trap"],
		["(( x ))", "(("],
		["for ((i=x; i<0; i++))", "(("],
	];
	for (const [input, name] of evaluators) {
		it(input, () => {
			const [command] = ShellSyntax.parse(input).commands();
			assert.strictEqual(Option.getOrNull(command?.name ?? Option.none()), name);
			assert.isTrue(refuses(ShellSyntax.parse(input)));
		});
	}

	it("a variable bash evaluates as arithmetic or a prompt makes the guard refuse", () => {
		for (const input of [
			"x='a[$(git commit)]'; (( x ))",
			"x='a[$(git commit)]'; echo $(( x ))",
			"x='a[$(git commit)]'; echo $[ x ]",
			"x='a[$(git commit)]'; echo $(( $x ))",
			`x='$(git commit)'; echo "\${x@P}"`,
			`x='a[$(git commit)]'; echo \${!x}`,
			`x='a[$(git commit)]'; echo \${a[x]}`,
			`a=abc; x='a[$(git commit)]'; echo \${a:x}`,
			"x='a[$(git commit)]'; a[x]=2",
			"x='a[$(git commit)]'; [[ x -eq 0 ]]",
			"if [[ x -eq 0 ]] then git status; fi",
			"if (( x )) then git status; fi",
			`echo "\${y:-$(( x ))}"`,
			"cat <<E\n$(( x ))\nE\n",
			// An assignment builtin's array value, which this parse splits as a
			// subshell: bash evaluates its keys as arithmetic.
			"declare -a x=(['$(git commit)']=1)",
			"export x=(['$(git commit)']=1)",
			"readonly x=(['$(git commit)']=1)",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: the same text where bash evaluates nothing is allowed", () => {
		for (const input of [
			"[[ 'a[$(git commit)]' == 0 ]]",
			"declare v='a[$(git commit)]'",
			"printf %s 'a[$(git commit)]'",
			"[ -n 'a[$(git commit)]' ]",
			"(( 2 > 1 ))",
			"echo $(( 1 + 2 ))",
			`x='a[$(git commit)]'; echo "\${x@Q}" \${x:-1} $x`,
			`echo \${a[0]} \${#a[@]} \${a[@]}`,
			"export FOO= BAR=1",
			"declare -a x",
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("[[ … ]] and (( … )) name themselves when they are the whole command", () => {
		assert.deepStrictEqual(resolve("[[ -n x ]]"), { name: "[[", wrappers: [] });
		assert.deepStrictEqual(resolve("! [[ -n x ]]"), { name: "[[", wrappers: [] });
		assert.deepStrictEqual(resolve("(( 1 ))"), { name: "((", wrappers: [] });
		assert.deepStrictEqual(resolve("time (( 1 ))"), { name: "((", wrappers: ["time"] });
		// Running straight into `then` they name the command after them, so
		// the guard reads the segment's words for them too.
		assert.strictEqual(resolve("if [[ -n x ]] then git status; fi").name, "git");
		assert.strictEqual(resolve("if (( 1 )) then git status; fi").name, "git");
		// A segment that runs nothing still names nothing.
		assert.deepStrictEqual(resolve("fi"), { name: null, wrappers: [] });
	});
});

// Round 1 of the adversarial review. Every "refuses" shape below runs the
// command in place of `git commit` under GNU bash 5.3.20 (checked with an
// executable that touches a marker file), and every control runs nothing, or
// is marked as an over-report.

describe("[[ … ]] is split on &&, || and (, so its arithmetic tests are tracked across segments", () => {
	it("the split puts an operand in command position, named as if it ran", () => {
		// What the guard has to cope with: the operand after `||` is a fake command name.
		assert.deepStrictEqual(names("[[ 0 == 1 || 'a[$(c1)]' -eq 0 ]]"), ["[[", "a[$(c1)]"]);
		assert.deepStrictEqual(codes("[[ 0 == 1 || 'a[$(c1)]' -eq 0 ]]"), []);
	});

	it("the README guard refuses an arithmetic test anywhere between [[ and its ]]", () => {
		for (const input of [
			"[[ 0 == 1 || 'a[$(git commit)]' -eq 0 ]]",
			"x='a[$(git commit)]'; [[ 1 && x -eq 0 ]]",
			"x='a[$(git commit)]'; [[ ( x -eq 0 ) ]]",
			"[[ 0 == 1 || -v 'a[$(git commit)]' ]]",
			"x='a[$(git commit)]'; [[ ! ( 1 && x -ge 0 ) ]]",
			// A quoted ]] is an operand, not the closer.
			"x='a[$(git commit)]'; [[ ']]' == y || x -eq 0 ]]",
			"x='a[$(git commit)]'; [[ 1 ]] && [[ x -eq 0 ]]",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: no arithmetic test inside the [[ … ]], or one after its ]], is allowed", () => {
		for (const input of [
			// bash runs nothing: == compares strings.
			"[[ 0 == 1 || 'a[$(git commit)]' == 0 ]]",
			"[[ -n x && -n y ]] && git status",
			"[[ ( -n x ) ]] && git status",
			// After the closer, -eq is an argument of an ordinary command.
			"[[ -n x ]] && echo -eq",
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("a subscripted name given to an assignment builtin is evaluated", () => {
	it("is reported only as the builtin's own name, with no diagnostic", () => {
		assert.deepStrictEqual(names("declare 'a[$(c1)]=1'"), ["declare"]);
		assert.deepStrictEqual(codes("declare 'a[$(c1)]=1'"), []);
	});

	it("the README guard refuses declare, typeset and local with one, in every spelling", () => {
		for (const input of [
			"declare 'a[$(git commit)]=1'",
			"typeset 'a[$(git commit)]=1'",
			"f(){ local 'a[$(git commit)]=1'; }; f",
			"declare -g 'a[$(git commit)]=1'",
			"declare -a 'a[$(git commit)]=1'",
			"declare -x 'a[$(git commit)]=1'",
			"declare -- 'a[$(git commit)]=1'",
			"declare b=1 'a[$(git commit)]=1'",
			'declare "a[\\$(git commit)]=1"',
			"declare a\\[\\$\\(git\\ commit\\)\\]=1",
			"x='a[$(git commit)]'; declare \"a[x]=1\"",
			// The name from a variable.
			"x='a[$(git commit)]=1'; declare \"$x\"",
			"x='a[$(git commit)]'; declare \"$x=1\"",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: export and readonly do not evaluate the name, and a plain value is allowed", () => {
		for (const input of [
			"export 'a[$(git commit)]=1'",
			"readonly 'a[$(git commit)]=1'",
			"declare v='a[$(git commit)]'",
			"declare a=1 b=2",
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
		// Over-report: with no `=`, bash 5.3 runs nothing for `declare 'a[$(c1)]'`.
		assert.isTrue(refuses(ShellSyntax.parse("declare 'a[$(git commit)]'")));
		// Over-report: a value that is not literal may be re-read as an array
		// when `x` is already a local array (see the re-read describe below).
		assert.isTrue(refuses(ShellSyntax.parse("local x=$(git status)")));
		assert.isTrue(refuses(ShellSyntax.parse('local x="$1"')));
	});
});

describe("PS4 is prompt-expanded before every command xtrace traces", () => {
	it("is reported only as set and :, with no diagnostic", () => {
		assert.deepStrictEqual(names("PS4='$(c1)'; set -x; :"), [null, "set", ":"]);
		assert.deepStrictEqual(codes("PS4='$(c1)'; set -x; :"), []);
	});

	it("the README guard refuses turning xtrace on, and any assignment to PS4", () => {
		for (const input of [
			"PS4='$(git commit)'; set -x; :",
			"set -o xtrace; PS4='`git commit`'; :",
			"set -x; PS4='$(git commit)' :",
			"set -x; f(){ :; }; PS4='$(git commit)'; f",
			"PS4='$(git commit)'; set -euxo pipefail; :",
			"shopt -so xtrace; PS4='$(git commit)'; :",
			"declare PS4='$(git commit)'; set -x; :",
			"export PS4='$(git commit)'; set -x; :",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		// Over-reports: each half alone runs nothing under bash 5.3 (an
		// inherited PS4 or xtrace is the other half, hence both are refused).
		assert.isTrue(refuses(ShellSyntax.parse("PS4='$(git commit)'; :")));
		assert.isTrue(refuses(ShellSyntax.parse("set -x; :")));
	});

	it("control: other set options, turning xtrace off, and PS3 are allowed", () => {
		// bash 5.3 does not prompt-expand PS3 here: `PS3='$(c1)'; :` runs nothing.
		for (const input of ["set -e", "set -euo pipefail", "set +x", "PS3='$(git commit)'; :"]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

const CLOSER = "QuotedCloserInExpansion";

describe("POSIX mode reads a quote inside a double-quoted expansion as an ordinary character", () => {
	// `set -o posix` (or POSIXLY_CORRECT=1), then the input: bash runs c1. In
	// the default mode the same line runs nothing, and the parse follows the
	// default reading, so a quoted run whose text that reading would act on is
	// reported.
	const hidden: ReadonlyArray<string> = [
		`echo "\${x:-'}"; c1; echo "'}"`,
		`echo "\${x:-$'}"; c1; echo "'}"`,
		`echo "$(echo "\${x:-'}"; c1; echo "'}")"`,
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), CLOSER);
		});
	}

	it("also reports a run holding a nested quote, opener or subscript closer", () => {
		// The two readings disagree on these too (bash 5.3 prints different
		// text, or fails in one mode only), though none of these runs c1.
		for (const input of [
			`echo "\${x:-\${y:-'}"; c1; echo "'}}"`,
			`echo "\${x:-'"'}"`,
			`echo "\${x:-'\${'}"`,
			`declare -A a; echo "\${a['}"; c1; echo "']}"`,
		]) {
			assert.include(allCodes(ShellSyntax.parse(input)), CLOSER, input);
		}
	});

	it("reports the run, at the run", () => {
		const input = `echo "\${x:-'}"; c1; echo "'}"`;
		assert.deepStrictEqual(
			ShellSyntax.parse(input).diagnostics.map((d) => [d.code, input.slice(d.offset, d.offset + d.length)]),
			[[CLOSER, `'}"; c1; echo "'`]],
		);
	});

	it("control: outside double quotes, or with nothing the other reading acts on, nothing is recorded", () => {
		for (const input of [
			// Unquoted, the quotes are real in both modes: bash runs c1 either way.
			`echo \${x:-'}'}; c1`,
			`echo "\${x:-'a'}"`,
			`echo "\${x:-'a\\b'}"`,
			// Balanced text leaves both readings on the same closer: bash 5.3 prints
			// the same text in either mode for each of these.
			`echo "\${x:-'""'}"; c1`,
			`echo "\${x:-'\\}'}"; c1`,
			// Arithmetic honours the quotes in both modes.
			`echo "$(( '1' ))"`,
			`echo $(( ')' ))`,
		]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
		// A balanced run holding a `$` reads the same in both modes, so it records
		// no closer; the R6 rule reports its quoted `$` instead.
		assert.deepStrictEqual(codes(`echo "\${x:-'\${y:-c}'}"; c1`), [QUOTED]);
	});

	it("the README guard refuses the run, and turning POSIX mode on", () => {
		for (const input of [
			`echo "\${x:-'}"; git commit; echo "'}"`,
			"set -o posix",
			"POSIXLY_CORRECT=1 git status",
			"export POSIXLY_CORRECT=1",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("a variable as a substring offset or length is evaluated as arithmetic", () => {
	it("the README guard refuses every name form and every offset spelling", () => {
		for (const input of [
			`x='a[$(git commit)]'; echo "\${@:x}"`,
			`x='a[$(git commit)]'; echo "\${*:x}"`,
			`x='a[$(git commit)]'; a=(1 2); echo "\${a[@]:x}"`,
			`x='a[$(git commit)]'; s=abc; echo "\${s: -x}"`,
			`x='a[$(git commit)]'; s=abc; echo "\${s:1-x}"`,
			`x='a[$(git commit)]'; s=abc; echo "\${s:0:-x}"`,
			`x='a[$(git commit)]'; s=abc; echo "\${s:1+x}"`,
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: a numeric offset and the :- :+ := :? operators are allowed", () => {
		for (const input of [
			`s=abc; echo "\${s:1}" "\${s: -1}" "\${s:0:-1}" "\${@:2}" "\${a[@]:1:2}"`,
			`echo "\${x:-default}" "\${x:+set}" "\${x:=v}" "\${x:?unset}"`,
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("an array literal's key over a variable is evaluated as arithmetic", () => {
	it("the README guard refuses it", () => {
		for (const input of [
			"x='a[$(git commit)]'; a=([x]=1)",
			"x='a[$(git commit)]'; a+=([x]=1)",
			"x='a[$(git commit)]'; a=([$x]=1)",
			"x='a[$(git commit)]'; a=([1+x]=1)",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: a numeric key is allowed", () => {
		assert.isFalse(refuses(ShellSyntax.parse("a=([0]=1 [2]=3)")));
		assert.isFalse(refuses(ShellSyntax.parse("a=(1 2)")));
		// bash evaluates no associative key, and runs nothing here.
		assert.isFalse(refuses(ShellSyntax.parse("declare -A h=([k]=1)")));
	});
});

// #1265. bash's parser reads `NAME=(` and `NAME+=(` as a compound assignment
// after an assignment builtin (`PST_ASSIGNOK`). Each "runs" shape below ran a
// marker command (`touch M`, here `git commit` or `c1`) under GNU bash 5.3.20,
// and each control ran nothing or was a syntax error.
// #1265 review, fix round 1. Each "refuses" shape ran `git commit` under GNU
// bash 5.3.20 (a fake git on PATH marking `git commit`), and each control ran
// nothing.
describe("an assignment builtin re-reads a quoted or expanded value as an array", () => {
	const V = "v='($(git commit))'; ";
	const K = "k='a[$(git commit)]'; ";

	it("the README guard refuses every value bash may re-read as a compound assignment", () => {
		for (const input of [
			"declare -a 'x=($(git commit))'",
			"declare -a x='($(git commit))'",
			"declare -a x='(`git commit`)'",
			'declare -a "x=(\\$(git commit))"',
			"declare -A 'h=([k]=$(git commit))'",
			"declare -A 'h=([$(git commit)]=1)'",
			"declare -A x='([$(git commit)]=1)'",
			"declare -a x=\\(\\$\\(git\\ commit\\)\\)",
			"declare -a x=$'($(git commit))'",
			"typeset -a 'x=($(git commit))'",
			"f(){ local -a 'x=($(git commit))'; }; f",
			"readonly -a 'x=($(git commit))'",
			"export -a 'x=($(git commit))'",
			// No option: x is already an array, so declare and typeset re-read.
			"x=(); declare 'x=($(git commit))'",
			"declare -a x; declare x='($(git commit))'",
			"x=(); typeset x+='($(git commit))'",
			`${V}declare -a x="$v"`,
			`${V}declare -a x=$v`,
			`v='([$(git commit)]=1)'; declare -A x="$v"`,
			`${V}x=(); declare x="$v"`,
			`${V}x=(); declare x+="$v"`,
			`${V}export -a x="$v"`,
			`${V}readonly -a x="$v"`,
			`${V}f(){ local -A x="$v"; }; f`,
			`declare -a x="$(echo '($(git commit))')"`,
			`declare -a x="("$(echo '$(git commit)')")"`,
			`${K}declare -a 'x=([k]=1)'`,
			`${K}declare -a x='([k]=1)'`,
			`${K}declare -a x=\\([k]=1\\)`,
			`${K}declare -ag 'x+=([k]=1)'`,
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("the README guard refuses local over a name already a local array in the same function", () => {
		// bash re-reads the value as an array, whatever local's own options.
		for (const input of [
			"f(){ local -a x; local x='($(git commit))'; }; f",
			"f(){ local x=(a) x='($(git commit))'; }; f",
			`${V}f(){ declare -a x; local x="$v"; }; f`,
			"f(){ local x=(a); command local x='($(git commit))'; }; f",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: export and readonly with no array option are allowed", () => {
		for (const input of [
			`${V}x=(); export x="$v"`,
			`${V}x=(); readonly x="$v"`,
			"declare -a x=('$(git commit)')",
			'export PATH="$PATH:/opt/bin"',
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("over-report: declare, typeset and local refuse any value that is not literal or holds =(", () => {
		// bash ran nothing for each (no array target in scope), but the text
		// cannot show what the variable or the enclosing function declared.
		for (const input of [
			"declare 'x=($(git commit))'",
			'declare x="$1"',
			'f(){ local dir="$1"; }; f',
			'f(){ local p="$PATH:/opt/bin"; }; f',
			`${V}f(){ x=(); local x="$v"; }; f`,
			"x=(); f(){ local x='($(git commit))'; }; f",
			"f(){ x=(); local x='($(git commit))'; }; f",
			"f(){ local -a x; g; }; g(){ local x='($(git commit))'; }; f",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("export and readonly with -i evaluate an array's elements as arithmetic", () => {
	const K = "k='a[$(git commit)]'; ";

	it("the README guard refuses -i and -n in every spelling", () => {
		for (const input of [
			`${K}export -i x=(1 k)`,
			`${K}export -i x=(k)`,
			`${K}readonly -i x=(k 1)`,
			`${K}readonly -ai x=(k)`,
			`${K}readonly -A -i x=([a]=k)`,
			`${K}f(){ readonly -i x\\\n=(k 1) -A\n}; f`,
			`${K}export -ix x=(k)`,
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: other options are allowed", () => {
		for (const input of [`${K}export -l x=(k)`, "export -x FOO=1", "readonly FOO=1"]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("an assignment builtin's NAME=( … ) argument is one word with an array value (#1265)", () => {
	const argsOf = (input: string): ReadonlyArray<string> =>
		ShellSyntax.parse(input)
			.commands()[0]
			?.args.map((w) => w.raw) ?? [];

	it("reads the array as part of the argument, after every builtin bash reads it after", () => {
		for (const head of ["declare", "typeset", "local", "export", "readonly", "alias", "eval", "let"]) {
			assert.deepStrictEqual(argsOf(`${head} x=(a b)`), ["x=(a b)"], head);
			assert.deepStrictEqual(names(`${head} x=(a b); git status`), [head, "git"], head);
		}
		assert.deepStrictEqual(argsOf("declare -A h=([k]=1 [a b]=2)"), ["-A", "h=([k]=1 [a b]=2)"]);
		assert.deepStrictEqual(argsOf("declare -a x+=(a) y=(b)"), ["-a", "x+=(a)", "y=(b)"]);
		// A newline inside the array is a blank, as in bash: `c1` is an element.
		assert.deepStrictEqual(names("declare y=(a\nc1\n)"), ["declare"]);
		// Reached through time, !, an assignment, a prefix redirection and `\⏎`.
		for (const input of [
			"time declare y=(a\nc1\n)",
			"! declare y=(a\nc1\n)",
			"FOO=1 declare y=(a\nc1\n)",
			">/dev/null declare y=(a\nc1\n)",
			"dec\\\nlare y\\\n=\\\n(a\nc1\n)",
			"declare -- y=(a\nc1\n)",
			"if [[ 1 ]] then declare y=(a\nc1\n); fi",
		]) {
			assert.notInclude(names(input), "c1", JSON.stringify(input));
		}
	});

	it("known limit: eval's words after an array argument are its text, not commands", () => {
		// bash runs c1: eval re-reads `y=(a) c1` as a prefix assignment and a
		// command. The parse names eval only, as for any eval argument, and the
		// README guard refuses eval by name.
		assert.deepStrictEqual(names("eval y=(a) c1"), ["eval"]);
		assert.isTrue(refuses(ShellSyntax.parse("eval y=(a) git commit")));
	});

	it("reads a subscripted name, matching its ] through quotes", () => {
		assert.deepStrictEqual(argsOf("declare y[1]=(a)"), ["y[1]=(a)"]);
		assert.deepStrictEqual(argsOf('declare y["]"]=(a)'), ['y["]"]=(a)']);
		assert.deepStrictEqual(argsOf("declare y[$(echo 1)]=(a)"), ["y[$(echo 1)]=(a)"]);
	});

	it("reads on after the array's ) into the same word, so a # there starts no comment", () => {
		// bash runs c1 in each: `#` inside a token is not a comment.
		for (const input of ["x=(a)#; c1", "declare x=(a)#; c1", "declare y[1]=(a)#; c1", "x=(a)#\nc1"]) {
			assert.include(names(input), "c1", JSON.stringify(input));
			assert.lengthOf(ShellSyntax.parse(input).comments, 0, JSON.stringify(input));
		}
		assert.deepStrictEqual(argsOf("declare -A x=([a )]=1); c1"), ["-A", "x=([a )]=1)"]);
		assert.include(names("declare -A x=([a )]=1); c1"), "c1");
	});

	it("control: where bash reads no compound assignment, the array still splits off", () => {
		// Each is a syntax error under bash 5.3: a quoted or escaped builtin,
		// a word that is not the command, a redirection after the builtin, a
		// quoted name, a name that is not one, a subscript not followed by `=`.
		for (const input of [
			"\\declare y=(a\nc1\n)",
			"'declare' y=(a\nc1\n)",
			"echo y=(a\nc1\n)",
			"command declare y=(a\nc1\n)",
			"sudo declare y=(a\nc1\n)",
			"declare 2>/dev/null y=(a\nc1\n)",
			"declare <&0 y=(a\nc1\n)",
			"declare 'y'=(a\nc1\n)",
			"declare 1y=(a\nc1\n)",
			"declare y[1][2]=(a\nc1\n)",
			"declare y[a b]=(a\nc1\n)",
		]) {
			assert.include(names(input), "c1", JSON.stringify(input));
		}
	});

	it("keeps every substitution in the array value reachable", () => {
		for (const [input, body] of [
			["declare -a x=($(touch marker))", "touch marker"],
			["declare -a x=(`touch marker`)", "touch marker"],
			["declare -a x=(<(touch marker))", "touch marker"],
			["declare -a x=([$(touch marker)]=1)", "touch marker"],
			["declare -A x=([a b]=$(touch marker))", "touch marker"],
			["export x=($(touch marker))", "touch marker"],
			["declare y[1]=($(touch marker))", "touch marker"],
		] as const) {
			const script = ShellSyntax.parse(input);
			assert.deepStrictEqual(
				script.substitutions().map((part) => part.body),
				[body],
				input,
			);
			assert.deepStrictEqual(script.diagnostics, [], input);
		}
	});

	it("records a quoted substitution in an indexed key, as in a plain assignment", () => {
		assert.include(codes("declare -a x=(['$(c1)']=1)"), QUOTED);
		assert.include(codes("declare -a x=([ '$(c1)' ]=1)"), QUOTED);
	});

	it("the README guard refuses every array value that runs a command", () => {
		for (const input of [
			"declare -a x=($(git commit))",
			"declare -a x=(['$(git commit)']=1)",
			"declare -a x=([$(git commit)]=1)",
			"local x=(`git commit`)",
			"readonly x=(<(git commit))",
			// Indexed keys are arithmetic: `k` holding 'a[$(cmd)]' runs cmd.
			`k='a[$(git commit)]'; declare -a x=([k]=1)`,
			`k='a[$(git commit)]'; declare x=([k]=1)`,
			`k='a[$(git commit)]'; export x=([k]=1)`,
			// An `-A` after the value does not make it associative.
			`k='a[$(git commit)]'; declare x=([k]=1) -A`,
			`k='a[$(git commit)]'; declare +A x=([k]=1)`,
			"declare x=(a)#; git commit",
			"x=(a)#; git commit",
			"declare -A x=([a )]=1); git commit",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: the README guard allows array values that run nothing", () => {
		for (const input of [
			"declare -A h=([k]=1)",
			"declare -A h=([k]=1 [a b]=2)",
			`k='a[$(git commit)]'; declare -A x=([k]=1)`,
			`k='a[$(git commit)]'; readonly -A x=([k]=1)`,
			`k='a[$(git commit)]'; declare -gA x=([k]=1)`,
			"declare -a x=(a b c)",
			"declare -a x=([0]=a [1]=b)",
			"export x=(a b)",
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("names that run something else, and commands that run another command", () => {
	it("hash -p and enable -n rebind a name, with no diagnostic", () => {
		assert.deepStrictEqual(names("hash -p /tmp/c1 ls; ls"), ["hash", "ls"]);
		assert.deepStrictEqual(codes("hash -p /tmp/c1 ls; ls"), []);
	});

	it("the README guard refuses them, alias and shopt, and unmodelled wrappers", () => {
		for (const input of [
			"hash -p /tmp/x ls; ls",
			"enable -n printf; printf x",
			"alias c='git commit'",
			"shopt -s extglob",
			"builtin eval 'git commit'",
			"eval 'git commit'",
			"bash -c 'git commit'",
			"nice git commit",
			"timeout 5 git commit",
			"find . -exec git commit \\;",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});

	it("control: find without -exec is allowed", () => {
		assert.isFalse(refuses(ShellSyntax.parse("find . -name '*.ts'")));
	});
});

// Round-2 re-review. Every shape below ran c1 under bash 5.3.20 (c1 prints 1),
// and the round-1 guard allowed it with no diagnostic.
const X = "x='a[$(git commit)]'; ";
const CONT = "\\\n";

describe("a backslash-newline does not hide a shape from the guard (R1)", () => {
	// [split, joined]: bash joins `\⏎` before it tokenizes, and so does the parse
	// (it names `[[` and `((` for the split forms), but the guard read `raw`.
	const pairs: ReadonlyArray<readonly [string, string]> = [
		[`[${CONT}[ 'a[$(git commit)]' -eq 0 ]]`, "[[ 'a[$(git commit)]' -eq 0 ]]"],
		[`[${CONT}[ -v 'a[$(git commit)]' ]]`, "[[ -v 'a[$(git commit)]' ]]"],
		[`[${CONT}[ 0 == 1 || -v 'a[$(git commit)]' ]]`, "[[ 0 == 1 || -v 'a[$(git commit)]' ]]"],
		[`${X}[${CONT}[ 0 == 1 || x -eq 0 ]]`, `${X}[[ 0 == 1 || x -eq 0 ]]`],
		[`${X}(${CONT}( x ))`, `${X}(( x ))`],
		[`${X}echo $(${CONT}( x ))`, `${X}echo $(( x ))`],
		[`${X}echo $${CONT}[ x ]`, `${X}echo $[ x ]`],
		[`${X}echo $${CONT}{a[x]}`, `${X}echo \${a[x]}`],
		[`${X}echo \${${CONT}a[x]}`, `${X}echo \${a[x]}`],
		[`${X}echo \${a${CONT}[x]}`, `${X}echo \${a[x]}`],
		[`${X}echo $${CONT}{!x}`, `${X}echo \${!x}`],
		[`y='$(git commit)'; echo "\${y@${CONT}P}"`, `y='$(git commit)'; echo "\${y@P}"`],
		[`${X}echo "$${CONT}{s:x}"`, `${X}echo "\${s:x}"`],
		[`${X}echo "\${${CONT}s:x}"`, `${X}echo "\${s:x}"`],
		[`${X}echo "\${s${CONT}:x}"`, `${X}echo "\${s:x}"`],
		// A redirection target is read joined too (`target.joined`, not `raw`).
		[`${X}cat <$${CONT}{!x}`, `${X}cat <\${!x}`],
		[`y='$(git commit)'; echo hi >"\${y@${CONT}P}"`, `y='$(git commit)'; echo hi >"\${y@P}"`],
	];

	for (const [split, joined] of pairs) {
		it(`refuses ${JSON.stringify(split)}`, () => {
			assert.deepStrictEqual(codes(split), [], "no diagnostic: the guard is the only line of defence");
			assert.isTrue(refuses(ShellSyntax.parse(joined)), `control, joined: ${joined}`);
			assert.isTrue(refuses(ShellSyntax.parse(split)), split);
		});
	}

	it("control: a continuation in an ordinary command is allowed", () => {
		assert.isFalse(refuses(ShellSyntax.parse(`git ${CONT}status`)));
		assert.isFalse(refuses(ShellSyntax.parse(`echo a${CONT}b && git ${CONT}diff`)));
	});
});

describe("POSIX mode set by a writer that is not an assignment token (R2)", () => {
	// POSIX mode expands aliases in a non-interactive shell: each enabler, then
	// `BASH_ALIASES[1]=c1` and `1`, ran c1. `true` in its place ran nothing.
	const aliasLines = "\nBASH_ALIASES[1]=c1\n1";
	const enablers = [
		`: \${POSIXLY_CORRECT:=1}`,
		`: \${POSIXLY_CORRECT=1}`,
		"for POSIXLY_CORRECT in 1; do :; done",
		"select POSIXLY_CORRECT in 1; do break; done <<< 1",
		"declare {POSIXLY_CORRECT,y}=1",
		"export {POSIXLY_CORRECT,y}=1",
		"declare {POSIX''LY_CORRECT,y}=1",
		// Quotes split the name with no brace: only the quote-free mention sees it.
		"export POSIX''LY_CORRECT=1",
		'declare "POSIX""LY_CORRECT=1"',
		"declare {$'POSIX\\x4cY_CORRECT',y}=1",
		`POSIX${CONT}LY_CORRECT=1`,
	];

	for (const enabler of enablers) {
		it(`refuses ${JSON.stringify(enabler)}`, () => {
			assert.isTrue(refuses(ShellSyntax.parse(enabler)), enabler);
			assert.isTrue(refuses(ShellSyntax.parse(`${enabler}${aliasLines}`)), enabler);
		});
	}

	it("refuses a brace that builds the name, which no mention can match", () => {
		// `export {POSIXLY_CORREC,X}T=1` turned POSIX mode on; `declare
		// {BASH_CMD,X}S[1]=/tmp/c1; 1` ran c1. Control: `export {A,X}=1` ran nothing,
		// and is refused too (over-report: any brace in the name is unreadable).
		for (const input of [
			"export {POSIXLY_CORREC,X}T=1",
			"declare {POSIXLY_CORREC,X}T=1",
			"declare {BASH_CMD,X}S[1]=/tmp/c1; 1",
			"declare PS{4,}=1",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		assert.isTrue(refuses(ShellSyntax.parse("export {A,X}=1")));
		assert.isFalse(refuses(ShellSyntax.parse("export A=1 X=1")));
	});

	it("refuses any write to BASH_ALIASES, a letter-free key included", () => {
		// The assignment-only segment names nothing; the next names the alias key.
		assert.deepStrictEqual(names("BASH_ALIASES[1]=c1\n1"), [null, "1"]);
		assert.isTrue(refuses(ShellSyntax.parse("BASH_ALIASES[1]=c1")));
		assert.isTrue(refuses(ShellSyntax.parse("BASH_ALIASES=([1]=c1)")));
	});

	it("control: the same alias lines after `true`, and a key on another array, are allowed", () => {
		// bash runs nothing for `true`, then the two lines, outside POSIX mode;
		// the guard still refuses them for the BASH_ALIASES write, so the control
		// is the enabler-free, alias-free form.
		assert.isFalse(refuses(ShellSyntax.parse("true\nX[1]=c1\n1")));
	});

	it("over-report, pinned: writers bash does not take into POSIX mode are refused", () => {
		// mapfile, getopts and a heredoc `${…:=}` ran nothing under bash 5.3.20.
		for (const input of [
			"mapfile -t POSIXLY_CORRECT <<< 1",
			"getopts a POSIXLY_CORRECT -a",
			`cat <<E\n\${POSIXLY_CORRECT:=1}\nE`,
			"echo PS4",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("BASH_CMDS rebinds a name like hash -p (R3)", () => {
	const bin = "/tmp/c1";
	const shapes = [
		`BASH_CMDS[1]=${bin}; 1`,
		`BASH_CMDS[+]=${bin}; +`,
		`BASH_CMDS[@]=${bin}; @`,
		`BASH_CMDS[1.2]=${bin}; 1.2`,
		`BASH_CMDS[" "]=${bin}; " "`,
		`BASH_CMDS+=([1]=${bin}); 1`,
		`BASH_CMDS=([1]=${bin}); 1`,
		`declare -A BASH_CMDS; BASH_CMDS[1]=${bin}; 1`,
		`f(){ BASH_CMDS[1]=${bin}; }; f; 1`,
		`BASH_CMDS[1]=${bin}; command 1`,
		`BASH_CMDS[1]=${bin}; exec 1`,
		`BASH${CONT}_CMDS[1]=${bin}; 1`,
		"BASH_CMDS[1]=/usr/bin/git; 1 commit",
	];

	it("the parse names the rebound key, with no diagnostic", () => {
		assert.deepStrictEqual(names(`BASH_CMDS[1]=${bin}; 1`), [null, "1"]);
		assert.deepStrictEqual(codes(`BASH_CMDS[1]=${bin}; 1`), []);
	});

	for (const shape of shapes) {
		it(`refuses ${JSON.stringify(shape)}`, () => {
			assert.isTrue(refuses(ShellSyntax.parse(shape)), shape);
		});
	}

	it("control: a write to another array is allowed", () => {
		assert.isFalse(refuses(ShellSyntax.parse(`X[1]=${bin}; 1`)));
		// Over-report, pinned: bash runs nothing for a quoted export of the word.
		assert.isTrue(refuses(ShellSyntax.parse(`export 'BASH_CMDS[1]=${bin}'; 1`)));
	});
});

describe("a substring offset over a special parameter (R4)", () => {
	const shapes = [
		`${X}echo "\${-:x}"`,
		`${X}echo "\${?:x}"`,
		`${X}echo "\${$:x}"`,
		`${X}echo "\${#:x}"`,
		`${X}echo "\${-: -x}"`,
		`${X}echo "\${?: -x}"`,
		`${X}echo "\${$: -x}"`,
		`${X}echo "\${#: -x}"`,
		`${X}echo \${-:x}`,
	];

	for (const shape of shapes) {
		it(`refuses ${JSON.stringify(shape)}`, () => {
			assert.isTrue(refuses(ShellSyntax.parse(shape)), shape);
		});
	}

	it("control: the bare parameter, a length and a default are allowed", () => {
		// bash runs nothing for any of these with x='a[$(c1)]'.
		for (const input of [
			`echo "\${-}" "\${#}"`,
			`echo "\${#x}"`,
			`echo "\${-:-x}" "\${?:+x}"`,
			`echo "\${#a[@]}" "\${#a[@]:x}"`,
		]) {
			assert.isFalse(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("an indexed array's [ … ] key is one matched pair, blanks included (R3 F1)", () => {
	// bash reads a `[` that starts a compound-assignment element with
	// parse_matched_pair, so the key runs to its matching `]` across blanks,
	// newlines, `)`, `#` and `;`, and an `=` after it evaluates the key as
	// arithmetic, where a quoted `$(` still runs. Each ran c1 under bash 5.3.
	const hidden: ReadonlyArray<string> = [
		`x=([ '$(c1)' ]=1)`,
		`x=(['$(c1)' ]=1)`,
		`x=([ '$(c1)']=1)`,
		`x=([\t'$(c1)']=1)`,
		`x=([\n'$(c1)']=1)`,
		`x=([1 + '$(c1)']=1)`,
		`x+=([ '$(c1)' ]=1)`,
		"x=([ '`c1`' ]=1)",
		`x=([ $'$(c1)' ]=1)`,
		`x=( [ '$(c1)' ]=1)`,
		`x=(a [ '$(c1)' ]=1)`,
		`x=([ [ '$(c1)' ] ]=1)`,
		`x=([ '$(c1)' ]+=1)`,
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED);
		});
	}

	it("a substitution in a key with blanks is listed, = or not", () => {
		for (const input of [`x=([ $(c1) ]=1)`, `x=([ "$(c1)" ]=1)`, `x=([ $(c1) ])`]) {
			assert.include(names(input), "c1", input);
		}
	});

	it("the key holds the ) # and ; inside it, as bash reads it", () => {
		// bash 5.3 runs nothing for each: the key is ` ) ` (or `# `, `; c1 `),
		// an arithmetic error that aborts the line.
		for (const input of [`x=([ ) ]=1); c1`, `x=([ # ]=1); c1`, `x=([ ; c1 ]=1)`]) {
			const script = ShellSyntax.parse(input);
			assert.deepStrictEqual(script.diagnostics, [], input);
			assert.deepStrictEqual(script.segments[0]?.assignments[0]?.value.raw.startsWith("(["), true, input);
		}
		assert.deepStrictEqual(names(`x=([ ; c1 ]=1)`), [null]);
	});

	it("an unclosed key is opaque to the end, with a diagnostic", () => {
		for (const input of [`x=([ `, `x=([ '$(c1)'\nc1`, `x=([ a b )\ngit commit -m x`]) {
			assert.include(codes(input), "UnterminatedSubscript", input);
		}
	});

	it("control: the same keys without an opener, and a key with no = after it", () => {
		// `x=([ '$(c1)' ])` is one element, `[ $(c1) ]`, never evaluated: bash runs nothing.
		for (const input of [`x=([ '1' ]=1)`, `x=([ 1 + 2 ]=1)`, `x=([ '$(c1)' ])`, `x=([ '$(c1)' ] )`, `x=([ ]=1); c1`]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
		assert.deepStrictEqual(names(`x=([ ]=1); c1`), [null, "c1"]);
	});

	it("the README guard refuses them", () => {
		for (const input of [
			`x=([ '$(git commit)' ]=1)`,
			`x+=([ '$(git commit)' ]=1)`,
			`x=([\n'$(git commit)']=1)`,
			`declare -a x=([ '$(git commit)' ]=1)`,
			"x=([ '`git commit`' ]=1)",
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		assert.isFalse(refuses(ShellSyntax.parse(`x=([ 1 ]=1); git status`)));
	});
});

describe("sudo reads NAME=value only while options are on, and never one starting / or = (R3 F2)", () => {
	// sudo's parse_args.c: is_envar is argv[0] != '/' && argv[0] != '=' &&
	// strchr(argv, '='), tested only while !got_end_of_args.
	const cases: ReadonlyArray<readonly [string, string]> = [
		["sudo /opt/x=1/git commit", "/opt/x=1/git"],
		["sudo -u root /tmp/a=b/git commit", "/tmp/a=b/git"],
		["sudo -- ./g=1 commit", "./g=1"],
		["sudo -- A=1 git commit", "A=1"],
		["sudo -E -- B=2 git commit", "B=2"],
		["sudo =x commit", "=x"],
		["sudo '/opt/x=1/git' commit", "/opt/x=1/git"],
	];
	for (const [input, name] of cases) {
		it(input, () => {
			assert.deepStrictEqual(resolve(input), { name, wrappers: ["sudo"] });
		});
	}

	it("control: an assignment among the options is skipped, wherever it sits", () => {
		for (const input of [
			"sudo A=1 git commit",
			"sudo A=1 -u root git commit",
			"sudo ./g=1 git commit",
			"sudo a/b=1 git commit",
			"sudo -E A=1 -- git commit",
		]) {
			assert.deepStrictEqual(resolve(input), { name: "git", wrappers: ["sudo"] }, input);
		}
	});

	it("the README guard refuses them", () => {
		for (const input of ["sudo /opt/x=1/git commit", "sudo -u root /tmp/a=b/git commit"]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("an ANSI-C run inside an expansion is read decoded, as bash expands it (R4 R1)", () => {
	// bash decodes a `$'…'` run's escapes first and then expands the decoded
	// text, in a double-quoted `${…}`, in arithmetic, in a subscript and in an
	// array key. Each ran c1 under GNU bash 5.3.20.
	const hidden: ReadonlyArray<string> = [
		`echo "\${x:-$'\\x24(c1)'}"`,
		`echo "\${x:-$'\\044(c1)'}"`,
		`echo "\${x:-$'\\444(c1)'}"`,
		`echo "\${x:-$'\\u0024(c1)'}"`,
		`echo "\${x:-$'\\U00000024(c1)'}"`,
		`echo "\${x:-$'\\x60c1\\x60'}"`,
		// The decoded `$` joins the text after the run.
		`echo "\${x:-$'\\x24'(c1)}"`,
		// A decoded `(` after a raw `$`.
		`echo "\${x:-$'$\\x28c1)'}"`,
		`echo "\${x:-$'\\x24\\x28c1\\x29'}"`,
		`echo "\${x:-\${y:-$'\\x24(c1)'}}"`,
		`echo $(( $'\\x24(c1)' ))`,
		`echo $[ $'\\x24(c1)' ]`,
		`(( $'\\x24(c1)' ))`,
		`echo $(( $'\\x60c1\\x60' ))`,
		`echo \${a[$'\\x24(c1)']}`,
		`a[$'\\x24(c1)']=1`,
		`x=([$'\\x24(c1)']=1)`,
		`x=([ $'\\x24(c1)' ]=1)`,
		`x=([$'\\044(c1)']=1)`,
		`x=([$'\\x60c1\\x60']=1)`,
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED);
		});
	}

	it("control: a top-level ANSI-C run is not expanded again, so its decoded text stays literal", () => {
		// bash 5.3 runs nothing for each.
		for (const [input, literal] of [
			[`echo $'\\x24(c1)'`, "$(c1)"],
			[`echo $'\\x60c1\\x60'`, "`c1`"],
		] as const) {
			const script = ShellSyntax.parse(input);
			assert.deepStrictEqual(script.diagnostics, [], input);
			assert.deepStrictEqual(script.segments[0]?.words[1]?.literal, Option.some(literal), input);
			assert.deepStrictEqual(names(input), ["echo"], input);
		}
	});

	it("control: an ANSI-C run in an expansion whose escapes decode to no opener", () => {
		// bash 5.3 runs nothing for each.
		for (const input of [
			`echo "\${x:-$'a\\tb'}"`,
			`echo $(( $'\\x31' ))`,
			`x=([$'\\x31']=1)`,
			`echo "\${x:-$'\\x3c'}"`,
			// A single-quoted run is not decoded.
			`echo "\${x:-'\\x24(c1)'}"`,
			`echo $(( '\\x24(c1)' ))`,
			"x=(['\\x60c1\\x60']=1)",
		]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
	});

	it("the README guard refuses them", () => {
		for (const input of [`echo "\${x:-$'\\x24(git commit)'}"`, `echo "\${x:-$'\\x60git commit\\x60'}"`]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		assert.isFalse(refuses(ShellSyntax.parse(`echo "\${x:-$'a\\tb'}"; git status`)));
	});
});

describe("sudo reads no NAME=value right after an argv word that is exactly --, an option's value included (R4 R2)", () => {
	// sudo's parse_args.c tests got_end_of_args as argv[optind - 1] being
	// exactly `--`, whatever role that word played: the loop over libc
	// getopt_long, compiled from the source, runs the word after it.
	const cases: ReadonlyArray<readonly [string, string]> = [
		["sudo -p -- ./x=1 git status", "./x=1"],
		["sudo --prompt -- ./x=1 git status", "./x=1"],
		["sudo -u -- c1=x git status", "c1=x"],
		["sudo -u root -p -- c1=x git status", "c1=x"],
		["sudo -Ep -- c1=x git status", "c1=x"],
		["sudo -p -- c1=x -u root git status", "c1=x"],
		["sudo -D -- A=1 git", "A=1"],
		["sudo -g -- ./a=1 git", "./a=1"],
	];
	for (const [input, name] of cases) {
		it(input, () => {
			assert.deepStrictEqual(resolve(input), { name, wrappers: ["sudo"] });
		});
	}

	it("an option value that may expand to -- names no command", () => {
		for (const input of [`sudo -p "$p" A=1 git status`, `sudo -p --"$p" A=1 git status`]) {
			assert.strictEqual(resolve(input).name, null, input);
		}
	});

	it("control: a -- that is a real terminator, or a value that only holds --", () => {
		for (const [input, name] of [
			["sudo -p -- -u root A=1 git", "git"],
			["sudo -p-- A=1 git", "git"],
			["sudo --prompt=-- A=1 git", "git"],
			["sudo -p x -- A=1 git", "A=1"],
			["sudo -E A=1 -- B=2 git", "B=2"],
		] as const) {
			assert.deepStrictEqual(resolve(input), { name, wrappers: ["sudo"] }, input);
		}
	});

	it("the README guard refuses an option value that may be --, and reads past a real one", () => {
		// sudo runs `A=1` when `$p` is `--`, `git commit` otherwise.
		assert.isTrue(refuses(ShellSyntax.parse(`sudo -p "$p" A=1 git commit`)));
		assert.isTrue(refuses(ShellSyntax.parse("sudo -p -- -u root A=1 git commit")));
		assert.isFalse(refuses(ShellSyntax.parse("sudo -p -- -u root A=1 git status")));
	});
});

describe("a quoted run ending in $ joins the ( or backtick after it (R5 1)", () => {
	// bash expands the run's decoded text joined to what follows it, so a `$`
	// the run ends in opens a substitution with the `(` after the quote. Each
	// ran c1 under GNU bash 5.3.20.
	const hidden: ReadonlyArray<string> = [
		`echo "\${x:-$'$'(c1)}"`,
		`echo "\${x:-$'a$'(c1)}"`,
		`echo "\${x:-$'$'"(c1)"}"`,
		`echo "\${x:-$'$'$'(c1)'}"`,
		`echo "\${x:-$'$'\\\n(c1)}"`,
		`x=a; echo "\${x:+$'$'(c1)}"`,
		`x=a; echo "\${x+$'$'(c1)}"`,
		`echo "\${x=$'$'(c1)}"`,
		`echo "\${x:=$'$'(c1)}"`,
		`echo "\${x-$'$'(c1)}"`,
		`echo "\${x:?$'$'(c1)}"`,
		`echo "\${x:-a$'$'(c1)b}"`,
		`echo "\${x:-\${y:-$'$'(c1)}}"`,
		`echo "\${x:-$'$'\`c1\`}"`,
		// The same in an array key and a subscript, plain quotes included.
		`x=([$'$'(c1)]=1)`,
		`echo "\${a[$'$'(c1)]}"`,
		`x=([$'$'"(c1)"]=1)`,
		"x=([$'$'`c1`]=1)",
		`x=(['$'(c1)]=1)`,
		`x=([ '$'(c1) ]=1)`,
		`x=(['$'"(c1)"]=1)`,
		`x=(['$'$'(c1)']=1)`,
		`x=(['$''(c1)']=1)`,
		"x=(['$'`c1`]=1)",
		`x=(['a$'(c1)]=1)`,
		`x=(['$'\\(c1)]=1)`,
		`x=(['$'\\\n(c1)]=1)`,
	];
	for (const input of hidden) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED);
		});
	}

	it("over-report: a plain-quoted $ in a key is reported whatever follows it (R6)", () => {
		// bash 5.3 runs nothing for each; the R6 rule reports any quoted `$`.
		for (const input of [`x=(['$'1]=1)`, `x=(['$'{c1}]=1)`, `x=(['$']=1)`, `x=(['$' (c1)]=1)`, `x=(['a$b'(c1)]=1)`]) {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED, input);
		}
	});

	it("the README guard refuses them", () => {
		for (const input of [`echo "\${x:-$'$'(git commit)}"`, `echo "\${x:-a$'$'(git commit)b}"`]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("a wrapper's option value or NAME=value word that may split names no command (R5 2)", () => {
	// An unquoted expansion, a brace or a glob word-splits into several argv
	// words, and a quoted "$@" or "${a[@]}" expands to one word each, so the
	// wrapper may run a word the analyzer never sees as the command. Each
	// ran c1 under GNU bash 5.3.20 (sudo through its parse_args.c model) with
	// the variable set to `X c1`, `1 c1` or `root c1`.
	const hidden: ReadonlyArray<string> = [
		"env -u $v git status",
		`env -u \${v} git status`,
		`env -u \${v:-X} git status`,
		"env -u ''$v git status",
		"env -u {X,c1} git status",
		"env -u $(echo X c1) git status",
		"env -u `echo X c1` git status",
		'env -u "$@" git status',
		`env -u "\${a[@]}" git status`,
		"env -u X -u $v git status",
		"env -u $v A=1 git status",
		"env -u $v -- git status",
		"/usr/bin/env -u $v git status",
		"nohup env -u $v git status",
		"command env -u $v git status",
		"env -C $v git status",
		"exec -a $v git status",
		"exec -a {x,c1} git status",
		"/usr/bin/time -o $v git status",
		"command time -o $v git status",
		"env A=$v git status",
		`env A=\${v} git status`,
		"env A=$(echo 1 c1) git status",
		"env -- A=$v git status",
		"command env A=$v git status",
		"sudo -u $u git status",
		"sudo --user $u git status",
		"sudo -u {root,c1} git status",
		"sudo -p $p git status",
		"sudo -p $(echo x c1) git status",
		"sudo A=$v git status",
	];
	for (const input of hidden) {
		it(input, () => {
			assert.strictEqual(resolve(input).name, null);
		});
	}

	it("a glob value may split too", () => {
		assert.strictEqual(resolve("env -u * git status").name, null);
	});

	it("control: a double-quoted value is one word, and so is a shell assignment after time", () => {
		// bash 5.3 runs nothing extra for each.
		for (const input of [
			'env -u "$v" git status',
			'env -u "$*" git status',
			'exec -a "$v" git status',
			'env A="$v" git status',
			'env -C "$v" git status',
			'/usr/bin/time -o "$v" git status',
			'nohup env -u "$v" git status',
			'command env A="$v" git status',
			'sudo -u "$u" git status',
			"time A=$v git status",
			"env -u ~ git status",
		]) {
			assert.strictEqual(resolve(input).name, "git", input);
		}
	});

	it("the README guard refuses them", () => {
		for (const input of ["env -u $v git commit", "env A=$v git status", "sudo -u $u git status"]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		assert.isFalse(refuses(ShellSyntax.parse('env -u "$v" git status')));
	});
});

describe("a $ or backtick that reaches an expansion through any quoting or escape is reported (R6)", () => {
	// bash removes quotes and escapes inside a double-quoted or heredoc
	// `${…}`, arithmetic, a subscript and an indexed array's key, then reads
	// the text again, so a quoted or escaped `$` joins what follows it. Each
	// ran c1 under GNU bash 5.3.20, and the README guard allowed the first 19.
	const hidden: ReadonlyArray<string> = [
		`echo "\${x:-"$"(c1)}"`,
		`echo "\${x:-$"$"(c1)}"`,
		`cat <<E\n\${x:-"$"(c1)}\nE`,
		`echo "\${x-"$"(c1)}"`,
		`x=1; echo "\${x:+"$"(c1)}"`,
		`x=1; echo "\${x+"$"(c1)}"`,
		`echo "\${x:="$"(c1)}"`,
		`echo "\${x="$"(c1)}"`,
		`echo "\${x:-"$""(c1)"}"`,
		`echo "\${x:-"$"$'(c1)'}"`,
		`echo "\${x:-"$"\\\n(c1)}"`,
		`echo "\${x:-a"$"(c1)b}"`,
		`echo "\${x:-\${y:-"$"(c1)}}"`,
		`echo "\${a[0]:-"$"(c1)}"`,
		`echo "\${x:-"a b$"(c1)}"`,
		`echo "\${x:-"$y$"(c1)}"`,
		`echo "\${@:-"$"(c1)}"`,
		`echo "\${1:-"$"(c1)}"`,
		`cat <<E\n\${x-"$""(c1)"}\nE`,
	];
	// Each ran c1, and the guard refused it only through a heuristic.
	const engineOnly: ReadonlyArray<string> = [
		`x=(["$"(c1)]=1)`,
		`x=([\\$'(c1)']=1)`,
		`x=([\\$"(c1)"]=1)`,
		`x=(["\\$(c1)"]=1)`,
		`x=([\\$\\(c1\\)]=1)`,
		`x=(["$"'(c1)']=1)`,
		`x=(["$"\\\`c1\\\`]=1)`,
		`x+=(["$"(c1)]=1)`,
		`x=([ "$"(c1) ]=1)`,
		`echo "$(( \${x:-"$"(c1)} ))"`,
		`echo $(( \${x:-"$"(c1)} ))`,
		`x=([\${y:-"$"(c1)}]=1)`,
		`x=(["a$"(c1)]=1)`,
		`x=([\\$\\\n(c1)]=1)`,
		`x=(["$""(c1)"]=1)`,
		"x=([\\`c1\\`]=1)",
		// An escaped backtick in a double-quoted key, found while checking the rule.
		'x=(["\\`c1\\`"]=1)',
		'x=(["\\`"c1"\\`"]=1)',
	];
	for (const input of [...hidden, ...engineOnly]) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED);
		});
	}

	it("control: at top level bash does not read the text again", () => {
		// bash 5.3 runs nothing for each.
		for (const [input, literal] of [
			[`echo x"$"y`, "x$y"],
			[`echo "$"`, "$"],
			[`echo '$'`, "$"],
			[`echo \\$x`, "$x"],
			[`echo "a$"`, "a$"],
			[`echo "$""(c1)"`, "$(c1)"],
			[`echo '$''(c1)'`, "$(c1)"],
			[`echo \\$'(c1)'`, "$(c1)"],
		] as const) {
			const script = ShellSyntax.parse(input);
			assert.deepStrictEqual(script.diagnostics, [], input);
			assert.deepStrictEqual(script.segments[0]?.words[1]?.literal, Option.some(literal), input);
			assert.deepStrictEqual(names(input), ["echo"], input);
		}
	});

	it("control: a $ that opens an expansion, or a quoted run with no $, is not reported", () => {
		for (const input of [
			`echo "\${x:-"$HOME"}"`,
			`echo "\${x:-"$1"}"`,
			`echo "\${x:-"$@" "$?" "$-"}"`,
			`echo "\${x:-"$[1]"}"`,
			`echo "\${x:-"$\\\nHOME"}"`,
			`echo "\${x:-"\${y}"}"`,
			`echo "\${x:-"a b"}"`,
			`x=(["1"]=1)`,
			`x=([\\1]=1)`,
		]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
	});

	it("control: a $ inside a substitution is the substitution's own, reported once by its parse", () => {
		// bash 5.3 runs nothing for each. A `((` that turns out to be a subshell
		// is command text, where `"$"` is just a string.
		assert.deepStrictEqual(allCodes(ShellSyntax.parse(`echo "\${x:-$( (true) "$")}"`)), []);
		assert.deepStrictEqual(allCodes(ShellSyntax.parse(`echo "\${x:-$((true) "$")}"`)), []);
		assert.deepStrictEqual(allCodes(ShellSyntax.parse(`echo "\${x:-$(echo "\${y:-\\$z}")}"`)), [QUOTED]);
	});

	it("over-report: the unquoted x:- form and a quoted $ before a blank are reported too", () => {
		// bash 5.3 runs nothing for each.
		for (const input of [`echo \${x:-"$"(c1)}`, `echo "\${x:-"$" (c1)}"`, `echo "\${x:-\\$(c1)}"`]) {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED, input);
		}
	});

	it("the README guard refuses them", () => {
		for (const input of [`echo "\${x:-"$"(git commit)}"`, `cat <<E\n\${x:-"$"(git commit)}\nE`]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		assert.isFalse(refuses(ShellSyntax.parse(`echo "\${x:-"$HOME"}"; git status`)));
	});
});

describe("a bare $ before an escaped ( or backtick in a re-read frame is reported (R7)", () => {
	// bash removes the backslash and reads the key again as arithmetic, so
	// `$\(cmd\)` becomes `$(cmd)`. Each ran c1 under GNU bash 5.3.20; the
	// README guard allowed the first 8.
	const hidden: ReadonlyArray<string> = [
		`x=([1[0]+$\\(c1\\)]=1)`,
		`x=([0[0]$\\(c1\\)]=1)`,
		`x=([1[]$\\(c1\\)]=1)`,
		`x=([ [0] $\\(c1\\) ]=1)`,
		`x=([[0]$\\(c1\\)]=1)`,
		`x=([[]$\\(c1\\)]=1)`,
		`x=([0[1]$\\(c1\\)]=1); echo ok`,
		`x=([(1)[0]$\\(c1\\)]=1)`,
	];
	// Each ran c1, and the guard refused it only through a heuristic.
	const engineOnly: ReadonlyArray<string> = [
		`echo \`x=([\\$\\(c1\\)]=1)\``,
		`x=([$\\(c1\\)]=1)`,
		`x=([$\\(c1)]=1)`,
		`x=([a$\\(c1\\)]=1)`,
		`x=([ $\\(c1\\) ]=1)`,
		`echo \`x=([$\\\\(c1\\\\)]=1)\``,
		`echo $(x=([$\\(c1\\)]=1))`,
		`x=([$\\\n\\(c1\\)]=1)`,
		`x+=([$\\(c1\\)]=1)`,
		`x=(a [$\\(c1\\)]=1)`,
		`x=([1+$\\(c1\\)]=1)`,
		`if x=([$\\(c1\\)]=1); then :; fi`,
		`x=([$\\(c1\\)]=1) y=2`,
		`x=([$\\\n\\\n\\(c1\\)]=1)`,
		`x=([\${y}$\\(c1\\)]=1)`,
		`x=(["a"$\\(c1\\)]=1)`,
		`x=([$\\(c1\\)+1]=1)`,
		`f(){ x=([$\\(c1\\)]=1); }; f`,
		"x=([$\\`c1\\`]=1)",
	];
	for (const input of [...hidden, ...engineOnly]) {
		it(JSON.stringify(input), () => {
			assert.include(allCodes(ShellSyntax.parse(input)), QUOTED);
		});
	}

	it("control: a bare $ before any other escape, and the top-level word", () => {
		// bash 5.3 runs nothing for each.
		for (const input of [
			`x=([$\\n]=1)`,
			`x=([$\\n(c1)]=1)`,
			`x=([$\\x(c1)]=1)`,
			`x=([$\\{c1}]=1)`,
			`x=([$\\\\(c1)]=1)`,
			// A parameter before the `(` is no escape.
			`x=([$1(2)]=1)`,
		]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
		const script = ShellSyntax.parse(`echo $\\(c1\\)`);
		assert.deepStrictEqual(script.diagnostics, []);
		assert.deepStrictEqual(script.segments[0]?.words[1]?.literal, Option.some("$(c1)"));
		assert.deepStrictEqual(names(`echo $\\(c1\\)`), ["echo"]);
	});

	it("control: a bare $\\( in command text, and inside a substitution reported once by its parse", () => {
		// bash 5.3 runs nothing for each. `$((true) …)` is a subshell, not arithmetic.
		assert.deepStrictEqual(allCodes(ShellSyntax.parse(`echo "\${x:-$((true) $\\(c1\\))}"`)), []);
		assert.deepStrictEqual(allCodes(ShellSyntax.parse(`echo "\${x:-$(echo "\${y:-$\\(z\\)}")}"`)), [QUOTED]);
	});

	it("the README guard refuses them", () => {
		for (const input of [`x=([1[0]+$\\(git commit\\)]=1)`, `x=([$\\(git commit\\)]=1)`]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
	});
});

describe("a special parameter inside double quotes in a re-read frame is an expansion, not a literal $ (R7)", () => {
	it("control: $$ and the other special parameters record nothing", () => {
		// bash 5.3 runs nothing for each: `$$` is the shell's PID.
		for (const input of [
			`echo "\${x:-"$$"}"`,
			`echo "\${x:-"$$"(c1)}"`,
			`x=(["$$"]=1)`,
			`echo $(( "$$" ))`,
			`echo "\${x:-"a$$"}"`,
			`echo "\${x:-"$\\\n$"(c1)}"`,
			`echo "\${x:-"$!" "$#" "$-" "$?" "$@" "$*" "$0" "$_"}"`,
		]) {
			assert.deepStrictEqual(allCodes(ShellSyntax.parse(input)), [], input);
		}
	});

	it("a third $ after $$ is literal again", () => {
		// bash 5.3 ran c1.
		assert.include(allCodes(ShellSyntax.parse(`echo "\${x:-"$$$"(c1)}"`)), QUOTED);
	});
});

// The README's guard, verbatim in shape: every shape above must make it refuse.
const MAX_DEPTH = 8;
const GIT_OPTIONS_WITH_ARGUMENT: ReadonlySet<string> = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--config-env",
]);

const gitSubcommand = (command: ShellCommand): string | null | undefined => {
	const name = Option.getOrUndefined(command.name);
	if (name === undefined || baseName(name) !== "git") return undefined;
	const args = command.args.map((word) => Option.getOrNull(word.literal));
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === undefined || arg === null) return null;
		if (GIT_OPTIONS_WITH_ARGUMENT.has(arg)) i += 1;
		else if (!arg.startsWith("-")) return arg;
	}
	return undefined;
};

const ARITHMETIC_TESTS: ReadonlySet<string> = new Set(["-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-v"]);
const EVALUATES_A_NAME =
	/(?:\$\(\(|\$\[|\(\()[^A-Za-z_]*[A-Za-z_]|\$\{(?:!|[^}]*@P|(?:[@*#?$!0-9-]|\w+(?:\[[^\]]*\])?):(?![-=?+])[^}]*[A-Za-z_$])/;
// A subscript over a name in a parameter expansion (`${a[x]}`, `${#a[x]}`),
// read to its matching `]` at any nesting depth (`${a[0[0]+x]}`).
const expandsASubscriptOverAName = (text: string): boolean => {
	for (const match of text.matchAll(/\$\{#?\w*\[/g)) {
		let depth = 0;
		for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
			const c = text[i] as string;
			if (c === "[") depth += 1;
			else if (c === "]") {
				depth -= 1;
				if (depth === 0) break;
			} else if (/[A-Za-z_$]/.test(c)) return true;
		}
	}
	return false;
};
// A letter, `_` or `$` anywhere inside `[ … ]`, at any nesting depth.
const subscriptOverAName = (text: string): boolean => {
	let depth = 0;
	for (const c of text) {
		if (c === "[") depth += 1;
		else if (c === "]") depth = Math.max(0, depth - 1);
		else if (depth > 0 && /[A-Za-z_$]/.test(c)) return true;
	}
	return false;
};
const REFUSED_COMMANDS: ReadonlySet<string> = new Set([
	"shopt",
	"alias",
	"hash",
	"enable",
	"builtin",
	"eval",
	"source",
	".",
	"bash",
	"sh",
	"su",
	"ssh",
	"xargs",
	"nice",
	"timeout",
	"stdbuf",
	"setsid",
	"doas",
	"chroot",
]);
const REFUSED_VARIABLE = /(?<!\w)(?:PS4|POSIXLY_CORRECT|BASH_ALIASES|BASH_CMDS)(?!\w)/;

const assignedName = (word: ShellWord): string | null => {
	const literal = Option.getOrNull(word.literal);
	if (literal !== null) return literal.split("=", 1)[0] ?? "";
	const head = word.joined.split("=", 1)[0] ?? "";
	return /[$`{]/.test(head) ? null : head.replace(/["'\\]/g, "");
};

const arrayValue = (word: ShellWord): string | undefined =>
	word.parts.find((part) => part.kind === "opaque" && part.raw.startsWith("("))?.raw;

// With an array target the builtin re-reads a quoted or expanded value as a
// compound assignment, so `declare -a 'x=($(cmd))'` and `v='($(cmd))';
// declare -a x="$v"` run cmd. Whether `word` assigns a value bash may re-read
// that way: one not literal, or holding `=(` once quotes are removed, unless
// it is the parse's own unquoted `x=( … )` array.
const mayRereadAsArray = (word: ShellWord): boolean => {
	if (!word.joined.includes("=")) return false;
	const literal = Option.getOrNull(word.literal);
	if (literal !== null) return literal.includes("=(");
	const last = word.parts[word.parts.length - 1];
	const parsedArray =
		last?.kind === "opaque" &&
		last.raw.startsWith("(") &&
		word.parts.slice(0, -1).every((part) => part.kind === "bare");
	return !parsedArray;
};

const arithmeticTest = (commands: ReadonlyArray<ShellCommand>): boolean => {
	let inTest = false;
	for (const command of commands) {
		for (const word of inTest ? command.segment.words : command.evaluated) {
			if (word.joined === "[[") inTest = true;
			else if (word.joined === "]]") inTest = false;
			else if (inTest && ARITHMETIC_TESTS.has(Option.getOrElse(word.literal, () => ""))) return true;
		}
	}
	return false;
};

const evaluatesText = (command: ShellCommand): boolean => {
	const { segment } = command;
	const texts = [
		...segment.words.map((word) => word.joined),
		...segment.assignments.map((assignment) => assignment.joined),
		...segment.redirections.map(({ target }) =>
			target.kind === "heredoc" ? (target.quoted ? "" : target.body.replaceAll("\\\n", "")) : target.joined,
		),
	];
	if (texts.some((text) => EVALUATES_A_NAME.test(text) || expandsASubscriptOverAName(text))) return true;
	if (texts.some((text) => REFUSED_VARIABLE.test(text.replace(/["'\\]/g, "")))) return true;
	for (const { name, value } of segment.assignments) {
		if (subscriptOverAName(name)) return true;
		if (value.joined.startsWith("(") && subscriptOverAName(value.joined)) return true;
	}
	const name = Option.getOrUndefined(command.name);
	const base = name === undefined ? undefined : baseName(name);
	if (base !== undefined && REFUSED_COMMANDS.has(base)) return true;
	const args = command.args.map((word) => Option.getOrNull(word.literal));
	const indexedKeyOverAName = command.args.some((word, i) => {
		const value = arrayValue(word);
		if (value === undefined || !subscriptOverAName(value)) return false;
		return !args.slice(0, i).some((arg) => arg !== null && /^-[A-Za-z]*A/.test(arg));
	});
	// `-i` evaluates every value as arithmetic, and `-n` makes a nameref, in
	// any spelling: bundled (`-ix`), after `--`, or as `+i`.
	const integerOrNameref = args.some((arg) => arg !== null && /^[-+][A-Za-z]*[in]/.test(arg));
	// An `a` or `A` option, or a word an expansion supplies that may be one.
	const arrayOption = command.args.some((word) => {
		const literal = Option.getOrNull(word.literal);
		return literal === null ? !word.joined.includes("=") : /^[-+][A-Za-z]*[aA]/.test(literal);
	});
	const assigned = command.args
		.filter((word) => !/^[-+]/.test(Option.getOrElse(word.literal, () => "")))
		.map(assignedName);
	switch (base) {
		case "let":
		case "read":
		case "trap":
			return true;
		case "declare":
		case "typeset":
		case "local":
			// These evaluate a subscript in the name they assign: `declare 'a[$(cmd)]=1'`.
			// They re-read a value as an array whenever the target already is one,
			// for `local`, one already local to the same function.
			return (
				indexedKeyOverAName ||
				integerOrNameref ||
				command.args.some(mayRereadAsArray) ||
				assigned.some((assignee) => assignee === null || assignee.includes("["))
			);
		case "export":
		case "readonly":
			return (
				indexedKeyOverAName ||
				integerOrNameref ||
				(arrayOption && command.args.some(mayRereadAsArray)) ||
				assigned.some((assignee) => assignee === null)
			);
		case "set":
			return args.some((arg) => arg === null || /^-[A-Za-z]*x/.test(arg) || arg === "xtrace" || arg === "posix");
		case "printf":
			return args[0]?.startsWith("-v") === true;
		case "test":
		case "[":
			return args.includes("-v");
		case "find":
			return args.some((arg) => arg === null || /^-(?:exec|execdir|ok|okdir)$/.test(arg));
		default:
			return false;
	}
};

const refuses = (script: ShellScript, depth = 0): boolean => {
	const commands = script.commands();
	if (script.diagnostics.length > 0 || arithmeticTest(commands)) return true;
	for (const command of commands) {
		if (Option.isNone(command.name) && command.args.length > 0) return true;
		if (evaluatesText(command)) return true;
		const subcommand = gitSubcommand(command);
		if (subcommand === null || subcommand === "commit") return true;
	}
	const nested = script.substitutions();
	if (nested.length > 0 && depth >= MAX_DEPTH) return true;
	return nested.some((part) => refuses(ShellSyntax.parse(part.body), depth + 1));
};

describe("the README guard", () => {
	it("refuses every bypass shape", () => {
		const shapes = [
			'git add -A && git commit -m "feat: x"',
			"(( x = 1 << 2 ))\ngit commit -m x\n2\n",
			"echo $[1<<2]\ngit commit -m x\n2]\n",
			"x=$(echo $[1<<2]\ngit commit -m x\n2]\n)",
			"a[1<<2]=x\ngit commit -m x\n2]=x\n",
			"a[1<<2]\ngit commit -m x\n2]\n",
			"x=$(a[1<<2]=y\ngit commit -m x\n2]=y\n)",
			"a[1 #]; git commit -m x",
			"if FOO=1 git commit -m x; then :; fi",
			"time FOO=1 git commit",
			'env "FOO=1" git commit -m x',
			"echo {a,$(git commit -m x)}",
			"x=($(git commit -m x))",
			"echo `echo \\`git commit -m x\\``",
			"/usr/bin/env git commit -m x",
			"coproc git commit -m x",
			"git -C dir commit -m x",
			"git -c user.name=x commit",
			"if [[ 1 ]] then git commit; fi",
			`echo ${"$(".repeat(12)}git commit${")".repeat(12)}`,
			// bash evaluates n as arithmetic, and a value of 'a[$(cmd)]' runs cmd.
			"(( n > 1 )) && git push",
			`echo "\${x:-'$(git commit)'}"`,
			"env --unse FOO git commit",
			"sudo --us root git commit",
			"env --i FOO git commit",
			"[[ 'a[$(git commit)]' -eq 0 ]]",
		];
		for (const shape of shapes) assert.isTrue(refuses(ShellSyntax.parse(shape)), shape);
	});

	it("reads an array key's subscript at any nesting depth", () => {
		// `[^\]]*` stopped at the first `]`, so `x=([1[0]+$\(c1\)]=1)`, which
		// bash runs, got past a guard that read only the regex.
		assert.isTrue(subscriptOverAName("([1[0]+$\\(c1\\)]=1)"));
		assert.isTrue(subscriptOverAName("([[[0]]+x]=1)"));
		assert.isFalse(/\[[^\]]*[A-Za-z_$]/.test("([1[0]+$\\(c1\\)]=1)"));
		assert.isFalse(subscriptOverAName("([0]=foo [1]=bar)"));
	});

	it("reads a parameter expansion's subscript to its matching ] at any nesting depth", () => {
		// bash 5.3 ran c1 for `${a[b[0]+x]}`, `${a[1+b[0]*x]}` and `${a[x+0[0]]}`
		// with x='a[$(c1)]'. A valid subscript names an array before any inner
		// `[`, so these already had a letter before the first `]`; `${a[0[0]+x]}`,
		// whose `0[0]` bash rejects before it reads x, is refused to fail closed.
		for (const input of [
			`echo "\${a[0[0]+x]}"`,
			`echo "\${a[b[0]+x]}"`,
			`echo "\${a[1+b[0]*x]}"`,
			`echo "\${#a[0[0]+x]}"`,
		]) {
			assert.isTrue(refuses(ShellSyntax.parse(input)), input);
		}
		assert.isTrue(expandsASubscriptOverAName(`\${a[0[0]+x]}`));
		assert.isFalse(expandsASubscriptOverAName(`\${a[0[0]]} [x]`));
		assert.isFalse(expandsASubscriptOverAName(`\${a[0]} \${#a[@]}`));
	});

	it("allows ordinary scripts, compound commands included", () => {
		const allowed = [
			"git status && git diff",
			"if git diff --quiet; then git status; fi",
			"{ git log; git status; }",
			"for f in a b; do git add $f; done",
			"(( 2 > 1 )) && git push",
			"git -C dir status",
			"a[0]=1 git status",
			"echo $[1 + 2] && git status",
			"a=([0]=1 [2]=3); git status",
			"x=([0]=foo [1]=bar); git status",
			`echo \${a[0]} \${#a[@]}; git status`,
		];
		for (const shape of allowed) assert.isFalse(refuses(ShellSyntax.parse(shape)), shape);
	});
});
