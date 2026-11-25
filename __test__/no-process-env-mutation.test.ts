import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind, computeLineStarts } from "typescript/ast";
import { assert, describe, it } from "vitest";
import type { Token } from "./support/tokenize.js";
import { tokenize } from "./support/tokenize.js";

/**
 * Test suites never mutate `process.env` by hand (#1379).
 *
 * @remarks
 * `process.env` is shared by every file a vitest worker runs, so a missed
 * restore, an early throw, or two files touching the same key make unrelated
 * tests pass or fail. Provide the value through the code's own seam — a test
 * `ConfigProvider`, `Git.withRunOptions({ env })`, a spawn's `env` option —
 * and where a test genuinely needs the parent's ambient environment, use
 * `vi.stubEnv(...)` with `vi.unstubAllEnvs()` in `afterEach`/`afterAll`.
 * Reading `process.env` is fine; only writes are flagged.
 */
const RULE =
	"tests must not assign to, delete from, or Object.assign into process.env — provide the value through the " +
	"code's seam (a test ConfigProvider, Git.withRunOptions({ env }), a spawn's env option), or use vi.stubEnv " +
	"with vi.unstubAllEnvs() in afterEach (#1379).";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Assignment operators: a `process.env…` target followed by one of these is a write. */
const ASSIGNMENTS: ReadonlySet<SyntaxKind> = new Set([
	SyntaxKind.EqualsToken,
	SyntaxKind.PlusEqualsToken,
	SyntaxKind.MinusEqualsToken,
	SyntaxKind.AsteriskEqualsToken,
	SyntaxKind.AsteriskAsteriskEqualsToken,
	SyntaxKind.SlashEqualsToken,
	SyntaxKind.PercentEqualsToken,
	SyntaxKind.LessThanLessThanEqualsToken,
	SyntaxKind.GreaterThanGreaterThanEqualsToken,
	SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
	SyntaxKind.AmpersandEqualsToken,
	SyntaxKind.BarEqualsToken,
	SyntaxKind.CaretEqualsToken,
	SyntaxKind.QuestionQuestionEqualsToken,
	SyntaxKind.BarBarEqualsToken,
	SyntaxKind.AmpersandAmpersandEqualsToken,
	// `process.env.N++` / `--`: a postfix update writes as surely as an assignment.
	SyntaxKind.PlusPlusToken,
	SyntaxKind.MinusMinusToken,
]);

/** `Object.assign(process.env, …)` and friends: `<receiver>.<method>(process.env`. */
const MUTATING_CALLS: ReadonlySet<string> = new Set([
	"Object.assign",
	"Object.defineProperty",
	"Object.defineProperties",
	"Reflect.set",
	"Reflect.defineProperty",
	"Reflect.deleteProperty",
]);

/** The index just past the `]` that closes the `[` at `open`, or `-1`. */
const closeBracket = (tokens: ReadonlyArray<Token>, open: number): number => {
	let depth = 0;
	for (let i = open; i < tokens.length; i += 1) {
		const kind = tokens[i]?.kind;
		if (kind === SyntaxKind.OpenBracketToken) depth += 1;
		else if (kind === SyntaxKind.CloseBracketToken) {
			depth -= 1;
			if (depth === 0) return i + 1;
		}
	}
	return -1;
};

/** The 1-based lines of `text` that mutate `process.env`. */
const envMutationLines = (text: string): ReadonlyArray<number> => {
	const tokens = tokenize(text);
	const lineStarts = computeLineStarts(text);
	const lineOf = (position: number): number => {
		let line = 0;
		while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? Number.POSITIVE_INFINITY) <= position) {
			line += 1;
		}
		return line + 1;
	};
	const is = (i: number, kind: SyntaxKind, value?: string): boolean =>
		tokens[i]?.kind === kind && (value === undefined || tokens[i]?.value === value);
	const hits = new Set<number>();
	for (let i = 0; i + 2 < tokens.length; i += 1) {
		if (!is(i, SyntaxKind.Identifier, "process")) continue;
		// The index just past the `env` access: `process.env` or `process["env"]` / `process['env']`.
		let envEnd = -1;
		if (is(i + 1, SyntaxKind.DotToken) && is(i + 2, SyntaxKind.Identifier, "env")) {
			envEnd = i + 3;
		} else if (
			is(i + 1, SyntaxKind.OpenBracketToken) &&
			(is(i + 2, SyntaxKind.StringLiteral, "env") || is(i + 2, SyntaxKind.NoSubstitutionTemplateLiteral, "env")) &&
			is(i + 3, SyntaxKind.CloseBracketToken)
		) {
			envEnd = i + 4;
		}
		if (envEnd < 0) continue;
		// A `process` that is itself a member (`globalThis.process.env`) is still the global; one
		// that is another object's member (`fake.process.env`) is not — only `globalThis.` passes.
		const start = is(i - 1, SyntaxKind.DotToken) && is(i - 2, SyntaxKind.Identifier, "globalThis") ? i - 2 : i;
		if (is(i - 1, SyntaxKind.DotToken) && start === i) continue;
		const line = lineOf(tokens[i]?.start ?? 0);
		// `delete process.env…`, `++process.env.N`
		if (
			is(start - 1, SyntaxKind.DeleteKeyword) ||
			is(start - 1, SyntaxKind.PlusPlusToken) ||
			is(start - 1, SyntaxKind.MinusMinusToken)
		) {
			hits.add(line);
			continue;
		}
		// `Object.assign(process.env, …)`
		if (
			is(start - 1, SyntaxKind.OpenParenToken) &&
			is(start - 2, SyntaxKind.Identifier) &&
			is(start - 3, SyntaxKind.DotToken) &&
			is(start - 4, SyntaxKind.Identifier) &&
			MUTATING_CALLS.has(`${tokens[start - 4]?.value}.${tokens[start - 2]?.value}`)
		) {
			hits.add(line);
			continue;
		}
		// `process.env = …`, `process.env.X = …`, `process.env[k] ??= …`
		let after = envEnd;
		if (is(after, SyntaxKind.DotToken) && is(after + 1, SyntaxKind.Identifier)) {
			after += 2;
		} else if (is(after, SyntaxKind.OpenBracketToken)) {
			after = closeBracket(tokens, after);
		}
		const next = tokens[after]?.kind;
		// A postfix `++`/`--` never applies across a line terminator: there the `++` starts the next
		// statement (`const v = process.env.N` then `++count;`), so only a same-line update is a write.
		const postfixAcrossLine =
			(next === SyntaxKind.PlusPlusToken || next === SyntaxKind.MinusMinusToken) &&
			/[\n\r\u2028\u2029]/.test(text.slice(tokens[after - 1]?.start ?? 0, tokens[after]?.start ?? 0));
		if (after >= 0 && next !== undefined && ASSIGNMENTS.has(next) && !postfixAcrossLine) {
			hits.add(line);
		}
	}
	return [...hits].sort((a, b) => a - b);
};

/** Every tracked test file under `packages/*\/__test__/`. */
const governedFiles = (): ReadonlyArray<string> =>
	execFileSync("git", ["ls-files", "-z", "--", ":(glob)packages/*/__test__/**"], {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
		.split("\0")
		.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));

describe("test suites never mutate process.env", () => {
	// biome-ignore-start lint/suspicious/noTemplateCurlyInString: the fixtures are SOURCE TEXT holding template substitutions for the scanner to read
	it("flags every spelling of a write (positive control)", () => {
		const fixture = [
			'process.env.CI = "true";',
			"process.env[key] = value;",
			"delete process.env.CI;",
			"delete process.env[name];",
			"Object.assign(process.env, RUNNER_ENV);",
			'process.env.PATH ??= "/bin";',
			'process.env.PATH += ":/x";',
			"process.env = {};",
			'globalThis.process.env.X = "1";',
			'Reflect.deleteProperty(process.env, "X");',
			"const s = `${(process.env.T = 'x')}`;",
			"process.env.COUNT -= 1;",
			"process.env.FLAGS |= 4;",
			'process["env"].CI = "true";',
			"process['env'] = {};",
			'delete process["env"].CI;',
			"Object.assign(process['env'], RUNNER_ENV);",
			"process.env.N++;",
			"--process.env.N;",
		].join("\n");
		assert.deepEqual(
			envMutationLines(fixture),
			Array.from({ length: 19 }, (_, i) => i + 1),
		);
	});

	it("passes reads, comparisons, comments, strings and lookalikes", () => {
		const fixture = [
			"const env = { ...process.env, X: '1' };",
			'if (process.env.CI === "true") {}',
			"const v = process.env[key] ?? 'none';",
			"// process.env.CI = 'true';",
			"const s = 'process.env.CI = \"true\"';",
			"const t = `process.env.X = ${process.env.Y}`;",
			"fake.process.env.X = '1';",
			"options.env.X = '1';",
			"vi.stubEnv('CI', 'true');",
			"Object.keys(process.env);",
			"const r = /#\\s*process.env.X = ''/u; const q = a / b / c;",
			"const h = `#${x}`; const p = s.replace(/[#]/g, '');",
			'const w = process["env"].CI; const k = { ...process["env"] };',
			'if (process["env"].N === "1") {} const m = process.env.A - 1;',
			'const other = process["argv"]; process.title = "x";',
			"const n = process.env.COUNT",
			"++count;",
		].join("\n");
		assert.deepEqual(envMutationLines(fixture), []);
	});

	// biome-ignore-end lint/suspicious/noTemplateCurlyInString: fixtures end

	// A scan of every test file in the repository: beside a thousand other test files on a four-core runner the
	// five-second default timed it out. The deadline is not a claim about its speed.
	it("finds no direct process.env mutation under packages/*/__test__/", { timeout: 120_000 }, () => {
		const files = governedFiles();
		assert.isAbove(files.length, 300, "the scan must reach the tree it guards");
		const offences = files.flatMap((file) =>
			envMutationLines(readFileSync(join(ROOT, file), "utf8")).map((line) => `${file}:${line}`),
		);
		assert.deepEqual(offences, [], RULE);
	});
});
