// Every command string here once hid a command bash runs (each checked with
// GNU bash 5.3 by running it with `touch ran` in place of `git commit`). Each
// group is pinned against a control that differs in the one token the rule is
// about, so a fix that over-corrects shows up as a failing control.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { ShellCommand, ShellScript } from "../src/index.js";
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
		// It runs no command: a guard sees no name and no args.
		const [command] = ShellSyntax.parse("(( x > 1 ))").commands();
		assert.isTrue(command !== undefined && Option.isNone(command.name) && command.args.length === 0);
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
		assert.strictEqual(resolve("[[ git ]]").name, null);
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

const refuses = (script: ShellScript, depth = 0): boolean => {
	if (script.diagnostics.length > 0) return true;
	for (const command of script.commands()) {
		if (Option.isNone(command.name) && command.args.length > 0) return true;
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
		];
		for (const shape of shapes) assert.isTrue(refuses(ShellSyntax.parse(shape)), shape);
	});

	it("allows ordinary scripts, compound commands included", () => {
		const allowed = [
			"git status && git diff",
			"if git diff --quiet; then git status; fi",
			"{ git log; git status; }",
			"for f in a b; do git add $f; done",
			"(( n > 1 )) && git push",
			"git -C dir status",
			"a[0]=1 git status",
			"echo $[1 + 2] && git status",
		];
		for (const shape of allowed) assert.isFalse(refuses(ShellSyntax.parse(shape)), shape);
	});
});
