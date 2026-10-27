import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import type { ShellExportsErrorReason } from "../src/ShellExports.js";
import { ShellExports, ShellExportsError } from "../src/ShellExports.js";

const ok = (text: string): Record<string, string> => {
	const parsed = ShellExports.parseResult(text);
	if (Result.isFailure(parsed)) assert.fail(`rejected ${JSON.stringify(text)}: ${parsed.failure.message}`);
	return { ...parsed.success };
};

const rejection = (text: string): ShellExportsError => {
	const parsed = ShellExports.parseResult(text);
	if (Result.isSuccess(parsed)) return assert.fail(`accepted ${JSON.stringify(text)}`);
	return parsed.failure;
};

describe("ShellExports.parseResult: the dialect", () => {
	it("bare, single-quoted, double-quoted and $'…' words, and their concatenation", () =>
		assert.deepStrictEqual(ok(`export A=plain\nexport B='a b'\nexport C="x y"\nexport D='it'\\''s'"!"$'\\t'x\n`), {
			A: "plain",
			B: "a b",
			C: "x y",
			D: "it's!\tx",
		}));

	it("a bare backslash escapes the next character (printf %q's form)", () =>
		assert.deepStrictEqual(ok("export A=a\\ b\\$c\\~d\\*e\\{f\\}\n"), { A: "a b$c~d*e{f}" }));

	it('double quotes: \\" and \\\\ unescape, any other backslash is kept', () =>
		assert.deepStrictEqual(ok(`export A="\\" \\\\ \\n \\a"\n`), { A: '" \\ \\n \\a' }));

	it("$'…' escapes: the one-character set, octal and hex bytes decoded as UTF-8, and \\c", () =>
		assert.deepStrictEqual(
			ok(
				`export A=$'\\a\\b\\e\\E\\f\\n\\r\\t\\v\\\\\\'\\"\\?'\nexport B=$'\\303\\251'\nexport C=$'\\xc3\\xa9\\101\\x41\\cA\\c[\\c_'\n`,
			),
			{ A: "\x07\b\x1b\x1b\f\n\r\t\v\\'\"?", B: "é", C: "éAA\x01\x1b\x1f" },
		));

	it("tab and newline are allowed inside quotes", () =>
		assert.deepStrictEqual(ok("export A='a\tb\nc'\nexport B=\"x\ny\"\n"), { A: "a\tb\nc", B: "x\ny" }));

	it("blank lines, # comment lines (after leading blanks too), and ; between statements", () =>
		assert.deepStrictEqual(ok("# head\n\n  # indented\nexport A=1; export B=2;\n\t\nexport C=3"), {
			A: "1",
			B: "2",
			C: "3",
		}));

	it("an empty value, non-ASCII, # inside a word, and ~ where bash leaves it literal", () =>
		assert.deepStrictEqual(ok("export A=\nexport B=''\nexport C=日本😀\nexport D=x#y\nexport E=a~b/~\n"), {
			A: "",
			B: "",
			C: "日本😀",
			D: "x#y",
			E: "a~b/~",
		}));

	it("a later export of the same name wins", () => assert.deepStrictEqual(ok("export A=1\nexport A=2\n"), { A: "2" }));

	it("lower-case names, and a __proto__ name as an ordinary key", () => {
		const parsed = Result.getOrThrow(ShellExports.parseResult("export lower=1\nexport __proto__=2\n"));
		assert.strictEqual(parsed.lower, "1");
		assert.strictEqual(Object.getPrototypeOf(parsed), null);
		assert.strictEqual(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value, "2");
	});

	it("Claude Code's session-env shape", () =>
		assert.deepStrictEqual(
			ok(
				"export CLAUDE_SESSION_ID=0f1e2d3c-aaaa-bbbb-cccc-000000000000\nexport CLAUDE_PROJECT_DIR=/Users/me/my\\ repo\nexport NOTE=$'line one\\nline two'\n",
			),
			{
				CLAUDE_SESSION_ID: "0f1e2d3c-aaaa-bbbb-cccc-000000000000",
				CLAUDE_PROJECT_DIR: "/Users/me/my repo",
				NOTE: "line one\nline two",
			},
		));

	it.effect("parse is the Effect form: the same success and the same typed failure", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual({ ...(yield* ShellExports.parse("export A=1\n")) }, { A: "1" });
			const failure = yield* Effect.flip(ShellExports.parse("export A=$X\n"));
			assert.instanceOf(failure, ShellExportsError);
			assert.strictEqual(failure.reason, "expansion");
		}),
	);
});

// Every input the review named, plus the dialect's other edges: each must reject the WHOLE text, at the first
// offending character, even with valid exports around it.
const NEGATIVE: ReadonlyArray<readonly [text: string, reason: ShellExportsErrorReason]> = [
	["eval 'export A=1'", "unsupported-statement"],
	["if true; then export A=1; fi", "unsupported-statement"],
	["{ export A=1; }", "unsupported-statement"],
	["declare -x A=1", "unsupported-statement"],
	["read A", "unsupported-statement"],
	["set -a", "unsupported-statement"],
	["A=1", "unsupported-statement"],
	["unset A", "unsupported-statement"],
	["compgen -e", "unsupported-statement"],
	["jobs", "unsupported-statement"],
	["test -v A", "unsupported-statement"],
	["source ./x", "unsupported-statement"],
	["export A+=1", "unsupported-statement"],
	["export A[0]=1", "unsupported-statement"],
	["export A=(1 2)", "unsupported-statement"],
	["export A", "unsupported-statement"],
	["export -n A", "unsupported-statement"],
	["export A=1 B=2", "unsupported-statement"],
	["export A=1 # trailing comment", "unsupported-statement"],
	["export A=1 && true", "unsupported-statement"],
	["export A=1 | cat", "unsupported-statement"],
	["export A=1 &", "unsupported-statement"],
	["export A=1 >/dev/null", "unsupported-statement"],
	["export A=1|cat", "unsupported-statement"],
	["export A=1&&true", "unsupported-statement"],
	["export A=1&", "unsupported-statement"],
	["export A=1>x", "unsupported-statement"],
	["export A=1<x", "unsupported-statement"],
	["export A=a(b)", "unsupported-statement"],
	["export A='x'|cat", "unsupported-statement"],
	["export A=x\\\ny", "unsupported-statement"],
	["export A=1;; export B=2", "unsupported-statement"],
	["; export A=1", "unsupported-statement"],
	["exportA=1", "unsupported-statement"],
	['"export" A=1', "unsupported-statement"],
	["export A=$((1+2))", "expansion"],
	["export A=$[1+2]", "expansion"],
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a literal shell parameter expansion, not a template
	["export A=${U:?}", "expansion"],
	["export A=$U", "expansion"],
	["export A=$-", "expansion"],
	['export A="$U"', "expansion"],
	['export A="\\$U"', "expansion"],
	["export A=`id`", "expansion"],
	['export A="`id`"', "expansion"],
	['export A=$"x"', "expansion"],
	["export A=*", "expansion"],
	["export A=a?b", "expansion"],
	["export A=[ab]", "expansion"],
	["export A={a,b}", "expansion"],
	["export A=~", "expansion"],
	["export A=x:~/y", "expansion"],
	["export A=x=~/y", "expansion"],
	["export $A=1", "expansion"],
	["export RANDOM=1", "special-variable"],
	["export UID=1", "special-variable"],
	["export IFS=x", "special-variable"],
	["export _=x", "special-variable"],
	["export BASH_ENV=/tmp/x", "special-variable"],
	["export BASH_ANYTHING=1", "special-variable"],
	["export POSIXLY_CORRECT=1", "special-variable"],
	["export A='open", "unterminated-quote"],
	['export A="open', "unterminated-quote"],
	["export A=$'open", "unterminated-quote"],
	["export A=$'\\u00e9'", "invalid-encoding"],
	["export A=$'\\U0001F600'", "invalid-encoding"],
	["export A=$'\\xff'", "invalid-encoding"],
	["export A=$'\\0'", "invalid-encoding"],
	["export A=$'\\x00'", "invalid-encoding"],
	["export A=$'\\q'", "invalid-encoding"],
	["export A=$'\\x'", "invalid-encoding"],
	["export A=$'\\c\\\\'", "invalid-encoding"],
	// bash 3.2 reads \c? as 0x1F and bash 5 as DEL: a text whose meaning depends on the bash is outside the dialect.
	["export A=$'\\c?'", "invalid-encoding"],
	["export A=$'\\c1'", "invalid-encoding"],
	["export A=1\r", "invalid-encoding"],
	["export A='a\rb'", "invalid-encoding"],
	["export A=a\u0001b", "invalid-encoding"],
	["export A=\\\u0001", "invalid-encoding"],
	["export A=\uD800", "invalid-encoding"],
	["export 1A=1", "invalid-name"],
	["export 9=1", "invalid-name"],
];

describe("ShellExports.parseResult: anything else rejects the whole text", () => {
	for (const [text, reason] of NEGATIVE) {
		it(`${JSON.stringify(text)} → ${reason}`, () => {
			assert.strictEqual(rejection(text).reason, reason);
			// Valid exports before and after it do not rescue the text.
			assert.strictEqual(rejection(`export OK=1\n${text}\nexport LATER=2\n`).reason, reason);
		});
	}

	it("reports the first offending position: line and column of the first bad character", () => {
		const error = rejection("export A=1\n\nexport B=ok$X\nexport C=$Y\n");
		assert.deepStrictEqual([error.line, error.column, error.reason], [3, 12, "expansion"]);
		const special = rejection("# c\n  export RANDOM=1\n");
		assert.deepStrictEqual([special.line, special.column, special.reason], [2, 10, "special-variable"]);
		// Lines are counted through quotes that span them.
		const late = rejection("export A='x\ny'\nexport B=*\n");
		assert.deepStrictEqual([late.line, late.column], [3, 10]);
	});

	it("the failure is a ShellExportsError with a readable message", () => {
		const error = rejection("export A=*\n");
		assert.instanceOf(error, ShellExportsError);
		assert.strictEqual(error._tag, "ShellExportsError");
		assert.strictEqual(error.message, "Not a shell export file: expansion at line 1, column 10");
	});
});

/** Bytes from parts: a string contributes its UTF-8, an array of numbers its raw bytes. */
const bytes = (...parts: ReadonlyArray<string | ReadonlyArray<number>>): Uint8Array =>
	new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...new TextEncoder().encode(part)] : [...part])));

const okBytes = (input: Uint8Array): Record<string, string> => {
	const parsed = ShellExports.parseBytesResult(input);
	if (Result.isFailure(parsed)) assert.fail(`rejected bytes: ${parsed.failure.message}`);
	return { ...parsed.success };
};

const bytesRejection = (input: Uint8Array): ShellExportsError => {
	const parsed = ShellExports.parseBytesResult(input);
	if (Result.isSuccess(parsed)) return assert.fail("accepted bytes");
	return parsed.failure;
};

describe("ShellExports.parseBytesResult", () => {
	it("bash 3.2's printf %q shape: raw high bytes and octal escapes in one $'…' join into one character", () => {
		// What macOS /bin/bash 3.2 writes for 日本 under a UTF-8 locale (captured with od -c).
		const input = bytes("export A=$'", [0xe6], "\\227", [0xa5, 0xe6], "\\234", [0xac], "'\n");
		assert.deepStrictEqual(okBytes(input), { A: "日本" });
		// The same file decoded to a string first holds U+FFFD, which parseResult rightly rejects.
		assert.strictEqual(rejection(new TextDecoder().decode(input)).reason, "invalid-encoding");
	});

	it("is parseResult over a text's UTF-8 bytes: the same success, or the same rejection at the same position", () => {
		const texts = [
			...NEGATIVE.map(([text]) => text).filter((text) => !/[\uD800-\uDFFF]/.test(text)),
			"export A=1\n\nexport B=ok$X\n",
			"export C=日本😀\nexport D=日本*\n",
			"export E='日\n本'\nexport F=$'日\\q'\n",
			`export A=plain\nexport B='a b'\nexport C="x y"\nexport D='it'\\''s'"!"$'\\t'x\n`,
			"# 日本\nexport A=$'\\303\\251'\\ é\n",
		];
		for (const text of texts)
			assert.deepStrictEqual(
				ShellExports.parseBytesResult(new TextEncoder().encode(text)),
				ShellExports.parseResult(text),
				JSON.stringify(text),
			);
	});

	const MALFORMED: ReadonlyArray<readonly [label: string, input: Uint8Array, line: number, column: number]> = [
		["a lone continuation byte in a bare word", bytes("export A=x", [0xa5], "\n"), 1, 11],
		["a lone continuation byte in '…'", bytes("export A='x", [0xa5], "'\n"), 1, 12],
		['a lone continuation byte in "…"', bytes('export A="x', [0xa5], '"\n'), 1, 12],
		["a lone continuation byte after a bare backslash", bytes("export A=\\", [0xa5], "\n"), 1, 11],
		["a truncated character in a bare word", bytes("export A=", [0xe6, 0x97], "\n"), 1, 10],
		["an overlong NUL", bytes("export A=", [0xc0, 0x80], "\n"), 1, 10],
		["an encoded surrogate", bytes("export A=", [0xed, 0xa0, 0x80], "\n"), 1, 10],
		["a character split across a quote", bytes("export A=", [0xe6], "'", [0x97, 0xa5], "'\n"), 1, 10],
		// Inside $'…' the whole quote must be UTF-8; the rejection points at its closing quote, as for escapes.
		["a $'…' whose raw and escaped bytes stop mid-character", bytes("export A=$'", [0xe6], "\\227'\n"), 1, 17],
		["a $'…' character split across two quotes", bytes("export A=$'\\346'$'\\227\\245'\n"), 1, 16],
		["the column after earlier non-ASCII on the line", bytes("export A=日本", [0xff], "\n"), 1, 12],
	];
	for (const [label, input, line, column] of MALFORMED) {
		it(`rejects ${label} as invalid-encoding at its position`, () => {
			const error = bytesRejection(input);
			assert.deepStrictEqual([error.reason, error.line, error.column], ["invalid-encoding", line, column]);
		});
	}

	it("a raw control byte inside $'…' is still rejected, and a raw NUL anywhere", () => {
		assert.strictEqual(bytesRejection(bytes("export A=$'a", [0x01], "'\n")).reason, "invalid-encoding");
		assert.strictEqual(bytesRejection(bytes("export A=$'a", [0x00], "'\n")).reason, "invalid-encoding");
		assert.strictEqual(bytesRejection(bytes("export A=a", [0x00], "\n")).reason, "invalid-encoding");
	});

	it("a # comment line is skipped unread, whatever its bytes", () =>
		assert.deepStrictEqual(okBytes(bytes("# ", [0xff, 0xa5], "\nexport A=1\n")), { A: "1" }));
});

describe("ShellExports.format", () => {
	it("bare when safe, '' for empty, single quotes otherwise, $'…' for control characters", () =>
		assert.strictEqual(
			ShellExports.format({ A: "a/b:c", B: "", C: "it's here", D: "x\ny\u0001", E: "~" }),
			"export A=a/b:c\nexport B=''\nexport C='it'\\''s here'\nexport D=$'x\\ny\\001'\nexport E='~'\n",
		));
	it("rejects an invalid name, a special variable, NUL and a lone surrogate", () => {
		assert.throws(() => ShellExports.format({ "A-B": "1" }), RangeError);
		assert.throws(() => ShellExports.format({ "1A": "1" }), RangeError);
		assert.throws(() => ShellExports.format({ RANDOM: "1" }), RangeError);
		assert.throws(() => ShellExports.format({ BASH_ENV: "1" }), RangeError);
		assert.throws(() => ShellExports.format({ A: "a\0b" }), RangeError);
		assert.throws(() => ShellExports.format({ A: "a\uD800" }), RangeError);
	});
	it("keeps a leading U+FEFF: format, then parse, gives the map back, BOM and all", () => {
		const map = { A: "\uFEFFabc", B: "\uFEFF", C: "\uFEFF\uFEFFx", D: "a\uFEFF" };
		assert.deepStrictEqual(ok(ShellExports.format(map)), map);
		assert.deepStrictEqual(okBytes(new TextEncoder().encode(ShellExports.format(map))), map);
	});
});

describe("ShellExports: a word that starts with U+FEFF", () => {
	it("keeps it in every word form: bare, '…', \"…\", and $'…' bytes", () =>
		assert.deepStrictEqual(
			ok(
				`export A=\uFEFFx\nexport B='\uFEFFx'\nexport C="\uFEFFx"\nexport D=$'\\xef\\xbb\\xbfx'\nexport E=$'\\357\\273\\277'\n`,
			),
			{ A: "\uFEFFx", B: "\uFEFFx", C: "\uFEFFx", D: "\uFEFFx", E: "\uFEFF" },
		));
	it("counts it as a column: a rejection after a leading U+FEFF lands where it is in the text", () => {
		const error = rejection("export A='\uFEFF'$X\n");
		assert.deepStrictEqual([error.reason, error.line, error.column], ["expansion", 1, 13]);
	});
});

describe("ShellExports performance", () => {
	const file = (count: number) =>
		ShellExports.format(
			Object.fromEntries(Array.from({ length: count }, (_, k) => [`VAR_${k}`, `value ${k} it's $'x'`])),
		);
	const median = (text: string) => {
		const times = Array.from({ length: 5 }, () => {
			const start = performance.now();
			const parsed = ShellExports.parseResult(text);
			const elapsed = performance.now() - start;
			assert.isTrue(Result.isSuccess(parsed));
			return elapsed;
		}).sort((a, b) => a - b);
		return times[2] as number;
	};

	it("parses a 40 000-export file well under a second", () => {
		const text = file(40_000);
		const parsed = Result.getOrThrow(ShellExports.parseResult(text));
		assert.strictEqual(Object.keys(parsed).length, 40_000);
		assert.isBelow(median(text), 500);
	});

	it("grows linearly: four times the text takes well under sixteen times as long", () => {
		const small = median(file(10_000));
		const large = median(file(40_000));
		// Linear is about 4x; quadratic would be about 16x. The floor keeps timer noise on a fast small run out of it.
		assert.isBelow(large / Math.max(small, 1), 8);
	});
});

// Real bash is the oracle. Only dialect-valid text, rendered from generated maps, is ever sourced, so no file can
// run a command, change IFS or set a trap. Deterministic: seeded generators.
// biome-ignore lint/suspicious/noTemplateCurlyInString: a bash expansion, not a template
const probe = spawnSync("bash", ["-c", 'printf %s.%s "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"'], {
	encoding: "utf8",
});
const hasBash = probe.status === 0 && /^\d+\.\d+$/.test(probe.stdout);
const [bashMajor, bashMinor] = hasBash ? probe.stdout.split(".").map(Number) : [0, 0];
const hasBash5 = (bashMajor as number) >= 5;
/** Whether the bash on PATH is at least `major.minor`. */
const bashAtLeast = (major: number, minor: number): boolean =>
	(bashMajor as number) > major || (bashMajor === major && (bashMinor as number) >= minor);

/** A small seeded PRNG (mulberry32), so the generated maps are the same on every run. */
const mulberry32 = (seed: number) => {
	let state = seed;
	return () => {
		state += 0x6d2b79f5;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

// Every printable ASCII character, every C0 control but NUL (no bash string holds one), DEL, and multibyte text.
const ALPHABET: ReadonlyArray<string> = [
	...Array.from({ length: 31 }, (_, k) => String.fromCharCode(k + 1)),
	...Array.from({ length: 95 }, (_, k) => String.fromCharCode(k + 32)),
	"\u007f",
	"é",
	"ß",
	"中",
	"😀",
	"\u00a0",
	"\u0085",
];
const NAME_START = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
const NAME_REST = `${NAME_START}0123456789`;

const CORPUS: ReadonlyArray<string> = [
	"",
	" lead",
	"trail ",
	"  ",
	"'",
	"''",
	'"',
	"\\",
	"trailing\\",
	"~",
	"~/x",
	"a:~/x",
	"$HOME",
	"$-",
	"`id`",
	"$(id)",
	"$[1]",
	"{a,b}",
	"*?[]",
	"#hash",
	"a=b",
	"new\nline",
	"\r\n",
	"tab\t",
	"é",
	"😀",
];

/** Generated variable maps: random names (never a special one) to random values, and one map of the fixed corpus. */
const maps: ReadonlyArray<Record<string, string>> = (() => {
	const random = mulberry32(0x5eed);
	const pick = (from: string | ReadonlyArray<string>) => from[Math.floor(random() * from.length)] as string;
	const name = (k: number) => {
		const length = 1 + Math.floor(random() * 8);
		let out = pick(NAME_START);
		for (let c = 1; c < length; c++) out += pick(NAME_REST);
		// The suffix keeps generated names distinct and clear of every special name and the BASH_ prefix.
		return `${out}_v${k}`;
	};
	const value = () => Array.from({ length: Math.floor(random() * 14) }, () => pick(ALPHABET)).join("");
	const generated = Array.from({ length: 20 }, () =>
		Object.fromEntries(Array.from({ length: 1 + Math.floor(random() * 25) }, (_, k) => [name(k), value()])),
	);
	return [Object.fromEntries(CORPUS.map((v, k) => [`CORPUS_${k}`, v])), ...generated];
})();

const sandbox = hasBash ? mkdtempSync(join(tmpdir(), "shell-exports-")) : "";
afterAll(() => {
	if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

/**
 * The text bash sources, written to a fresh file in the sandbox, as the relative path a script sources it by. Never
 * `/dev/stdin`: Node hands the child a socket for fd 0 on Linux, `open("/dev/stdin")` fails there with ENXIO, and a
 * failed source exports nothing.
 */
let sourceFiles = 0;
const sourceFile = (text: string | Uint8Array): string => {
	const name = `source-${sourceFiles++}.sh`;
	writeFileSync(join(sandbox, name), text);
	return `./${name}`;
};

/** The exit status a script uses when it cannot read the file it was handed: a harness failure, never a bash verdict. */
const UNREADABLE = 97;
/**
 * Sources `path` as the script's first command, leaving its status in `$status`, and exits with UNREADABLE when it
 * failed because `path` could not be read. The check runs only after a failed source: a pipeline run before the source
 * makes PIPESTATUS an array that the next pipeline overwrites, where sourced first an exported PIPESTATUS stays plain
 * (bash 3.2 through 5.3 alike).
 */
const source = (path: string, redirect = "") =>
	`. ${path}${redirect}; status=$?; [ $status -eq 0 ] || [ -r ${path} ] || exit ${UNREADABLE}`;

/** Fails the test loudly when bash could not read the file it was to source. */
const assertRead = (result: { readonly status: number | null; readonly stderr: unknown }) =>
	assert.notStrictEqual(result.status, UNREADABLE, `harness: bash could not read the file to source ${result.stderr}`);

/** Run bash with `script`, `input` on stdin, in an empty directory with a minimal environment. */
const runBash = (script: string, input: string, lcAll = "en_US.UTF-8") =>
	spawnSync("bash", ["--norc", "--noprofile", "-c", script], {
		input,
		encoding: "utf8",
		cwd: sandbox,
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: sandbox, LC_ALL: lcAll },
		maxBuffer: 16 * 1024 * 1024,
		timeout: 10_000,
	});

/** The values bash exports for `names` after sourcing `text`, which must be dialect-valid. */
const bashExports = (text: string, names: ReadonlyArray<string>): Record<string, string> => {
	assert.isTrue(Result.isSuccess(ShellExports.parseResult(text)), "only dialect-valid text is ever sourced");
	const path = sourceFile(text);
	const script = `${source(path)}; [ $status -eq 0 ] || exit $status; for n in ${names.join(" ")}; do if [[ -v $n ]]; then printf "%s=%s\\0" "$n" "\${!n}"; fi; done`;
	const result = runBash(script, "");
	assertRead(result);
	assert.strictEqual(result.status, 0, result.stderr);
	return Object.fromEntries(
		result.stdout
			.split("\0")
			.slice(0, -1)
			.map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
	);
};

/** The map rendered by bash itself: `printf 'export %s=%q\n'` over every entry. */
const bashPrintf = (map: Record<string, string>, lcAll: string): string => {
	const input = Object.entries(map)
		.map(([name, value]) => `${name}\0${value}\0`)
		.join("");
	const script = 'while IFS= read -r -d "" n && IFS= read -r -d "" v; do printf "export %s=%q\\n" "$n" "$v"; done';
	const result = runBash(script, input, lcAll);
	assert.strictEqual(result.status, 0, result.stderr);
	return result.stdout;
};

describe.skipIf(!hasBash)("ShellExports against real bash", () => {
	it("the generated maps are real: every one is non-empty, and together they hold hundreds of variables", () => {
		for (const map of maps) assert.isAbove(Object.keys(map).length, 0);
		assert.isAbove(
			maps.reduce((total, map) => total + Object.keys(map).length, 0),
			200,
		);
	});

	it("format, then parse, gives back every map", () => {
		for (const map of maps) assert.deepStrictEqual(ok(ShellExports.format(map)), map);
	});

	for (const lcAll of ["C", "en_US.UTF-8"]) {
		it(`bash's printf %q, then parse, gives back every map (LC_ALL=${lcAll})`, () => {
			for (const map of maps) assert.deepStrictEqual(ok(bashPrintf(map, lcAll)), map);
		});
	}

	it("bash sourcing format's text exports exactly the map, which is what parse returns", () => {
		for (const map of maps) {
			const text = ShellExports.format(map);
			const exported = bashExports(text, Object.keys(map));
			assert.deepStrictEqual(exported, map);
			assert.deepStrictEqual(ok(text), exported);
		}
	});

	it("bash sourcing its own printf %q text exports exactly the map, which is what parse returns", () => {
		for (const map of maps) {
			const text = bashPrintf(map, "en_US.UTF-8");
			const exported = bashExports(text, Object.keys(map));
			assert.deepStrictEqual(exported, map);
			assert.deepStrictEqual(ok(text), exported);
		}
	});

	it("bash exports a leading U+FEFF as part of the value, and parse keeps it too", () => {
		const map = { A: "\uFEFFabc", B: "\uFEFF" };
		const text = ShellExports.format(map);
		const exported = bashExports(text, Object.keys(map));
		assert.deepStrictEqual(exported, map);
		assert.deepStrictEqual(ok(text), exported);
	});

	it("hand-written dialect forms mean to bash what parse says: quotes, tabs and newlines in quotes, ;, comments", () => {
		const text = `# c\n  # c\nexport A="x\\"y\\\\z\\q" ; export B='a\tb\nc'\nexport C=a\\ b$'\\303\\251\\cA'"d"\nexport D=a~b/~x\nexport A=last\n`;
		assert.deepStrictEqual(bashExports(text, ["A", "B", "C", "D"]), ok(text));
	});
});

/** `printf 'export %s=%q\n'` over every entry of `map`, run by the bash at `bin`, as the raw bytes it wrote. */
const printfBytes = (bin: string, map: Record<string, string>, lcAll: string): Uint8Array => {
	const input = Object.entries(map)
		.map(([name, value]) => `${name}\0${value}\0`)
		.join("");
	const script = 'while IFS= read -r -d "" n && IFS= read -r -d "" v; do printf "export %s=%q\\n" "$n" "$v"; done';
	const result = spawnSync(bin, ["--norc", "--noprofile", "-c", script], {
		input,
		cwd: sandbox,
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: sandbox, LC_ALL: lcAll },
		maxBuffer: 16 * 1024 * 1024,
		timeout: 10_000,
	});
	assert.strictEqual(result.status, 0, result.stderr?.toString());
	return new Uint8Array(result.stdout);
};

// bash 3.2's printf %q leaves `~` bare, so its `~/x` means $HOME/x to bash itself: the dialect rejects that text as
// an expansion (pinned below), and the bash 3.2 maps leave every value holding a `~` out.
const bash3Maps = maps.map((map) =>
	Object.fromEntries(Object.entries(map).filter(([, value]) => !value.includes("~"))),
);

/** The bash 3.2 maps that hold a non-ASCII character: the ones bash 3.2 writes as mixed bytes. */
const nonAsciiMaps = bash3Maps.filter((map) =>
	Object.values(map).some((value) => [...value].some((ch) => (ch.codePointAt(0) as number) > 0x7f)),
);

/** Whether `input` holds a raw byte of 0x80 or above inside a `$'…'`: the mixed form bash 3.2 writes. */
const hasRawHighByteInAnsiC = (input: Uint8Array): boolean => {
	const text = new TextDecoder("latin1").decode(input);
	return /\$'(?:[^'\\]|\\.)*[\x80-\xff]/.test(text);
};

// macOS ships bash 3.2 as /bin/bash, and its printf %q writes non-ASCII values partly as raw bytes. The oracle runs
// only where that bash is present.
const BASH3 = "/bin/bash";
const bash3Version = spawnSync(BASH3, ["--version"], { encoding: "utf8", timeout: 10_000 });
const hasBash3 = bash3Version.status === 0 && /version 3\.2\./.test(bash3Version.stdout ?? "");

describe.skipIf(!hasBash3)("ShellExports.parseBytesResult against bash 3.2", () => {
	it("control: bash 3.2 really writes raw high bytes inside $'…', which parseResult cannot read", () => {
		assert.isAbove(nonAsciiMaps.length, 5);
		const input = printfBytes(BASH3, Object.assign({}, ...nonAsciiMaps), "en_US.UTF-8");
		assert.isTrue(hasRawHighByteInAnsiC(input));
		assert.isTrue(Result.isFailure(ShellExports.parseResult(new TextDecoder().decode(input))));
	});

	for (const lcAll of ["C", "en_US.UTF-8"]) {
		it(`bash 3.2's printf %q bytes, then parseBytesResult, give back every map (LC_ALL=${lcAll})`, () => {
			for (const map of bash3Maps) assert.deepStrictEqual(okBytes(printfBytes(BASH3, map, lcAll)), map);
		});
	}

	it("bash 3.2 writes a leading ~ bare, which bash expands, and the dialect rejects that text as an expansion", () => {
		const input = printfBytes(BASH3, { A: "~/x" }, "en_US.UTF-8");
		assert.strictEqual(new TextDecoder().decode(input), "export A=~/x\n");
		assert.strictEqual(bytesRejection(input).reason, "expansion");
	});

	it("bash 3.2 sourcing its own printf %q bytes exports exactly what parseBytesResult returns", () => {
		for (const map of nonAsciiMaps) {
			const input = printfBytes(BASH3, map, "en_US.UTF-8");
			const names = Object.keys(map);
			const path = sourceFile(input);
			// bash 3.2 has no [[ -v ]]; ${!n+x} tells a set variable from an unset one.
			const script = `${source(path)}; [ $status -eq 0 ] || exit $status; for n in ${names.join(" ")}; do if [ -n "\${!n+x}" ]; then printf "%s=%s\\0" "$n" "\${!n}"; fi; done`;
			const result = spawnSync(BASH3, ["--norc", "--noprofile", "-c", script], {
				input: "",
				encoding: "utf8",
				cwd: sandbox,
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: sandbox, LC_ALL: "en_US.UTF-8" },
				timeout: 10_000,
			});
			assertRead(result);
			assert.strictEqual(result.status, 0, result.stderr);
			const exported = Object.fromEntries(
				result.stdout
					.split("\0")
					.slice(0, -1)
					.map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
			);
			assert.deepStrictEqual(exported, map);
			assert.deepStrictEqual(okBytes(input), exported);
		}
	});
});

/** The bytes `bin` exports as `V` after sourcing `input`, or undefined when bash fails on it. */
const exportedBytes = (bin: string, input: Uint8Array): ReadonlyArray<number> | undefined => {
	const path = sourceFile(input);
	const result = spawnSync(bin, ["--norc", "--noprofile", "-c", `${source(path)}; printf %s "$V"`], {
		input: "",
		cwd: sandbox,
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: sandbox, LC_ALL: "en_US.UTF-8" },
		timeout: 10_000,
	});
	assertRead(result);
	return result.status === 0 ? [...result.stdout] : undefined;
};

// Every one-character escape and every \c target bash could be handed, plus byte escapes at their length edges.
const ESCAPE_BODIES: ReadonlyArray<string> = [
	...Array.from({ length: 0x7e - 0x21 + 1 }, (_, k) => String.fromCharCode(0x21 + k))
		.filter((ch) => ch !== "'")
		.flatMap((ch) => [`\\${ch}`, `\\c${ch}`, `\\c${ch}x`]),
	"\\101",
	"\\1010",
	"\\0101",
	"\\x41",
	"\\x4",
	"\\x414",
	"\\x7f",
	"\\177",
	"\\303\\251",
	"\\xc3\\xa9",
];

describe.skipIf(!(hasBash3 && hasBash5))("$'…' escapes mean the same to bash 3.2 and bash 5", () => {
	const encode = (body: string) => new TextEncoder().encode(`export V=$'${body}'\n`);

	it("control: the two shells really disagree on \\c?, and the dialect rejects it", () => {
		const input = encode("\\c?");
		assert.deepStrictEqual(exportedBytes(BASH3, input), [0x1f]);
		assert.deepStrictEqual(exportedBytes("bash", input), [0x7f]);
		assert.isTrue(Result.isFailure(ShellExports.parseBytesResult(input)));
	});

	it("every escape the dialect accepts exports identically under both, as what parse returns", () => {
		let accepted = 0;
		const targets = new Set<string>();
		for (const body of ESCAPE_BODIES) {
			const input = encode(body);
			const parsed = ShellExports.parseBytesResult(input);
			if (Result.isFailure(parsed)) continue;
			accepted++;
			if (body.startsWith("\\c")) targets.add(body.slice(2, 3));
			const expected = [...new TextEncoder().encode(parsed.success.V)];
			assert.deepStrictEqual(exportedBytes(BASH3, input), expected, `bash 3.2 on ${body}`);
			assert.deepStrictEqual(exportedBytes("bash", input), expected, `bash 5 on ${body}`);
		}
		// Every \c target the dialect defines was exercised, and the sweep is not vacuous.
		assert.deepStrictEqual([...targets].sort(), [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz"].sort());
		assert.isAbove(accepted, 120);
	});
});

describe.skipIf(!hasBash5)("bash 5's printf %q reads back through both entry points", () => {
	for (const lcAll of ["C", "en_US.UTF-8"]) {
		it(`parseResult over the text and parseBytesResult over the bytes give back every map (LC_ALL=${lcAll})`, () => {
			for (const map of maps) {
				const input = printfBytes("bash", map, lcAll);
				assert.deepStrictEqual(okBytes(input), map);
				assert.deepStrictEqual(ok(new TextDecoder("utf-8", { fatal: true }).decode(input)), map);
			}
		});
	}
});

// Each special name, in the bash the oracle runs (5.x): exporting `NAME=sentinel` from a file does not leave a plain
// variable holding sentinel, by at least one observable test. Names that look plain on export and read-back are shown
// special by what bash itself does with them.
const BEHAVIOUR: Readonly<Record<string, string>> = {
	OPTARG: 'getopts a: o -a v; [ "$OPTARG" != sentinel ] && special=1',
	REPLY: 'read <<< v; [ "$REPLY" != sentinel ] && special=1',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a bash expansion, not a template
	MAPFILE: 'mapfile <<< v; [ "${MAPFILE-}" != sentinel ] && special=1',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a bash expansion, not a template
	COPROC: 'coproc { :; }; [ "${COPROC-}" != sentinel ] && special=1',
	POSIXLY_CORRECT: "shopt -qo posix && special=1",
	BASH_ARGV0: '[ "$0" = sentinel ] && special=1',
	BASH_REMATCH: '[[ xy =~ x ]]; [ "$BASH_REMATCH" != sentinel ] && special=1',
	// A BASH_ENV file is run by every non-interactive bash this one starts (a missing file is ignored, so one is made;
	// the child reads /dev/null: bash skips BASH_ENV when its stdin is a socket, as the pipes Node gives it are).
	BASH_ENV: "printf 'printf ran' > sentinel; [ \"$(bash -c : </dev/null)\" = ran ] && special=1",
	BASH_TRAPSIG: 'trap "[ \\"\\$BASH_TRAPSIG\\" != sentinel ] && special=1" USR1; kill -USR1 $$',
};

const SPECIAL_NAMES: ReadonlyArray<string> = [
	"UID",
	"EUID",
	"PPID",
	"SHELLOPTS",
	"BASHOPTS",
	"RANDOM",
	"SRANDOM",
	"LINENO",
	"SECONDS",
	"EPOCHSECONDS",
	"EPOCHREALTIME",
	"GROUPS",
	"BASHPID",
	"HISTCMD",
	"FUNCNAME",
	"OPTIND",
	"OPTARG",
	"_",
	"BASH",
	"DIRSTACK",
	"IFS",
	"POSIXLY_CORRECT",
	"SHLVL",
	"PWD",
	"OLDPWD",
	"REPLY",
	"MAPFILE",
	"COPROC",
	"COMP_WORDBREAKS",
];

// The BASH_ prefix is reserved by bash; these are the members shown special the same way.
const BASH_PREFIXED: ReadonlyArray<string> = [
	"BASH_ARGC",
	"BASH_ARGV",
	"BASH_ARGV0",
	"BASH_COMMAND",
	"BASH_LINENO",
	"BASH_SOURCE",
	"BASH_SUBSHELL",
	"BASH_VERSINFO",
	"BASH_VERSION",
	"BASH_ALIASES",
	"BASH_CMDS",
	"BASH_MONOSECONDS",
	"BASH_EXECUTION_STRING",
	"BASH_REMATCH",
	"BASH_COMPAT",
	"BASH_XTRACEFD",
	"BASH_TRAPSIG",
	"BASH_ENV",
];

/**
 * Whether bash shows `name` special after sourcing `export name=sentinel`. Sources text built here, by name. A file bash
 * cannot read, or a verdict that is not exactly 0 or 1, fails the test: a harness fault is never counted as special.
 */
const bashTreatsSpecially = (name: string): boolean => {
	const path = sourceFile(`export ${name}=sentinel\n`);
	const script = [
		source(path, " 2>err.txt"),
		`n=${name}; special=0`,
		"[ $status -ne 0 ] && special=1",
		"[ -s err.txt ] && special=1",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a bash indirect expansion, not a template
		'[ "${!n-<unset>}" != sentinel ] && special=1',
		'[ "$(printenv "$n" 2>/dev/null || echo "<absent>")" != sentinel ] && special=1',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a bash indirect expansion, not a template
		'c=$(bash --norc --noprofile -c \'printf %s "${!1-<unset>}"\' _ "$n" 2>&1)',
		'[ "$c" != sentinel ] && special=1',
		BEHAVIOUR[name] ?? ":",
		"printf %s $special",
	].join("\n");
	const result = runBash(script, "");
	assertRead(result);
	assert.strictEqual(result.status, 0, `harness: ${result.stderr}`);
	assert.match(result.stdout, /^[01]$/, `harness: no verdict for ${name}: ${result.stderr}`);
	return result.stdout === "1";
};

// Specials bash added after 5.0, by the 5.x minor that added them (each checked against bash 5.0 to 5.3): an earlier
// bash leaves the name plain, and the dialect rejects it all the same.
const SPECIAL_SINCE: Readonly<Record<string, number>> = { SRANDOM: 1, BASH_MONOSECONDS: 3, BASH_TRAPSIG: 3 };

describe.skipIf(!hasBash5)("the special-variable denylist, against bash 5", () => {
	it("control: ordinary names are not shown special by the same tests (PIPESTATUS included: bash 5 leaves an exported one plain)", () => {
		assert.isFalse(bashTreatsSpecially("PLAIN_CONTROL"));
		assert.isFalse(bashTreatsSpecially("HOSTTYPE"));
		assert.isFalse(bashTreatsSpecially("PIPESTATUS"));
	});

	for (const name of [...SPECIAL_NAMES, ...BASH_PREFIXED]) {
		const since = SPECIAL_SINCE[name];
		if (since !== undefined && !bashAtLeast(5, since)) {
			it(`${name}: bash ${probe.stdout} still leaves it plain (special from 5.${since}), and the dialect rejects it`, () => {
				assert.isFalse(bashTreatsSpecially(name), `bash ${probe.stdout} already treats ${name} specially`);
				assert.strictEqual(rejection(`export ${name}=x\n`).reason, "special-variable");
			});
			continue;
		}
		it(`${name}: bash treats it specially, and the dialect rejects it`, () => {
			assert.isTrue(bashTreatsSpecially(name), `bash ${probe.stdout} leaves ${name} plain`);
			assert.strictEqual(rejection(`export ${name}=x\n`).reason, "special-variable");
		});
	}

	it("names near the denylist stay ordinary: PATH, HOME, LANG, LC_ALL, HOSTTYPE, BASHX, XBASH_Y", () => {
		for (const name of ["HOSTTYPE", "PIPESTATUS", "PATH", "HOME", "LANG", "LC_ALL", "BASHX", "XBASH_Y"])
			ok(`export ${name}=x\n`);
	});
});
