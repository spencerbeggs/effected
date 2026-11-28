import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/ast";
import { assert, describe, it } from "vitest";
import { isDepthAware, isHostile } from "../lib/scripts/test-tiers.js";
import type { Token } from "./support/tokenize.js";
import { tokenize } from "./support/tokenize.js";

/**
 * A test file's name says what kind of test it is, and no test reads a clock to assert how fast kit code runs (#1415).
 *
 * @remarks
 * Four rules, read from tokens so a comment or a string cannot trip them:
 *
 * 1. Nothing under a package's `__test__/` reads a clock (`process.cpuUsage`, `process.hrtime`, `performance.now`,
 *    `Date.now`). An elapsed time in milliseconds holds on one machine and fails on a loaded runner; how work grows
 *    with its input holds on both, and `@effected/testing`'s `Growth` measures that. `ALLOWED_CLOCKS` names the
 *    files that read a clock for another reason, each with the reason.
 * 2. A test file that reaches `Growth` is named `.hostile.test.ts`. The hostile tier runs those one file at a time,
 *    which a growth ratio needs: beside other files it failed two CI runs in four (#1387).
 * 3. A test file that reaches `Depth` or `Corpus` is named `.parity.test.ts`, `.corpus.test.ts` or
 *    `.property.test.ts`. The full run finds its files by those suffixes, so a depth-aware file under another name
 *    would never run at full depth.
 * 4. A file with one of those suffixes reaches the matching API, so a suffix is never a label on a file that does
 *    not behave as its tier assumes. `HOSTILE_WITHOUT_GROWTH` names the hostile files that measure growth by hand
 *    because their package may not depend on the test kit, each with the reason.
 *
 * "Reaches" follows relative imports inside the package's `__test__/`, so a rule test that reads its corpus through
 * a shared harness is depth-aware though it never names `Corpus` itself.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The hostile files that measure growth without `Growth`, because their package may take no `@effected` edge. Each
 * also reads a clock, so it is in `ALLOWED_CLOCKS` too.
 */
const HOSTILE_WITHOUT_GROWTH: Readonly<Record<string, string>> = {
	"packages/memfs/__test__/integration/node-directory-seed.hostile.test.ts":
		"memfs's zero-edges law forbids any @effected dependency, dev included, so the ratio is written out (#1420)",
};

/** The files that read a clock for a reason other than asserting how fast kit code runs. */
const ALLOWED_CLOCKS: Readonly<Record<string, string>> = {
	"packages/bundler/__test__/e2e/action-spike.e2e.test.ts":
		"times each bundle for a row in the report it prints; nothing is asserted on it",
	"packages/cli-kit/__test__/ui/CliUi.live.modes.test.ts": "a poll deadline while waiting on a child's output",
	"packages/cli-kit/__test__/ui/CliUi.run.test.ts":
		"a lower bound: Ink flushes a lone escape after 20 ms, so the key must not arrive sooner",
	"packages/cli-kit/__test__/ui/CliUiTest.test.ts": "a fixture that keeps the screen busy for 30 ms",
	"packages/commands/__test__/e2e/RunOnce.e2e.test.ts": "the startedAt timestamp of a lock file fixture",
	"packages/glob/__test__/differential/run.ts":
		"the differential runner's own summary line and watchdog; a script, not a test",
	"packages/memfs/__test__/integration/node-directory-seed.hostile.test.ts":
		"a growth ratio written out by hand: memfs takes no @effected dependency of any kind, @effected/testing included",
	"packages/s3/__test__/readme.test.ts": "a lower bound: the gap a retry backoff must leave on the live clock",
	"packages/webhooks/__test__/StandardWebhooks.test.ts": "the timestamp a signed webhook fixture carries",
};

const CLOCKS: ReadonlyArray<readonly [receiver: string, member: string]> = [
	["process", "cpuUsage"],
	["process", "hrtime"],
	["performance", "now"],
	["Date", "now"],
];

/** Names the global object goes by: `globalThis.performance.now()` is the global's clock, not some other object's. */
const GLOBALS: ReadonlySet<string> = new Set(["globalThis", "global", "window", "self"]);

/** The modules a clock can be imported from by name. */
const CLOCK_MODULES: ReadonlySet<string> = new Set(["node:process", "process"]);

const isClock = (receiver: string, member: string): boolean => CLOCKS.some(([r, m]) => r === receiver && m === member);

/**
 * The clock reads in `tokens`, as `receiver.member` with the offset of each: a member access (`performance.now`,
 * `globalThis.Date.now`), a string key (`performance["now"]`), a destructure (`const { now } = performance`) and a
 * named import (`import { hrtime } from "node:process"`).
 */
export const clockReads = (
	tokens: ReadonlyArray<Token>,
): ReadonlyArray<{ readonly name: string; readonly start: number }> => {
	const reads: Array<{ readonly name: string; readonly start: number }> = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const receiver = tokens[index];
		if (receiver?.kind !== SyntaxKind.Identifier) continue;
		// `x.process.cpuUsage` is some other object's member, not the global's, unless `x` is the global object.
		const before = tokens[index - 1]?.kind;
		if (before === SyntaxKind.DotToken || before === SyntaxKind.QuestionDotToken) {
			const owner = tokens[index - 2];
			if (owner?.kind !== SyntaxKind.Identifier || !GLOBALS.has(owner.value)) continue;
		}
		const next = tokens[index + 1];
		const member = tokens[index + 2];
		if (next?.kind === SyntaxKind.DotToken || next?.kind === SyntaxKind.QuestionDotToken) {
			if (member?.kind === SyntaxKind.Identifier && isClock(receiver.value, member.value)) {
				reads.push({ name: `${receiver.value}.${member.value}`, start: receiver.start });
			}
			continue;
		}
		if (next?.kind === SyntaxKind.OpenBracketToken) {
			if (
				(member?.kind === SyntaxKind.StringLiteral || member?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) &&
				isClock(receiver.value, member.value)
			) {
				reads.push({ name: `${receiver.value}.${member.value}`, start: receiver.start });
			}
			continue;
		}
		// `const { now } = performance`: the names taken out of the braces that close just before the `=`.
		if (before === SyntaxKind.EqualsToken && tokens[index - 2]?.kind === SyntaxKind.CloseBraceToken) {
			let depth = 0;
			for (let cursor = index - 2; cursor >= 0; cursor -= 1) {
				const token = tokens[cursor];
				if (token?.kind === SyntaxKind.CloseBraceToken) depth += 1;
				else if (token?.kind === SyntaxKind.OpenBraceToken) {
					depth -= 1;
					if (depth === 0) break;
				} else if (
					depth === 1 &&
					token?.kind === SyntaxKind.Identifier &&
					// A property name, not the local a `name: local` pair binds it to.
					tokens[cursor - 1]?.kind !== SyntaxKind.ColonToken &&
					isClock(receiver.value, token.value)
				) {
					reads.push({ name: `${receiver.value}.${token.value}`, start: token.start });
				}
			}
		}
	}
	for (const entry of importsOf(tokens)) {
		if (!CLOCK_MODULES.has(entry.from)) continue;
		for (const name of entry.names) {
			if (isClock("process", name)) reads.push({ name: `process.${name}`, start: 0 });
		}
	}
	return reads;
};

/** What a file imports: each module specifier with the names taken from it (`*` for a namespace or default). */
export const importsOf = (
	tokens: ReadonlyArray<Token>,
): ReadonlyArray<{ readonly from: string; readonly names: ReadonlyArray<string> }> => {
	const found: Array<{ readonly from: string; readonly names: ReadonlyArray<string> }> = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const kind = tokens[index]?.kind;
		if (kind !== SyntaxKind.ImportKeyword && kind !== SyntaxKind.ExportKeyword) continue;
		const next = tokens[index + 1]?.kind;
		// `import.meta` is not an import.
		if (next === SyntaxKind.DotToken) continue;
		// `import("x")` takes the whole module, whatever is read off it afterwards.
		if (next === SyntaxKind.OpenParenToken) {
			const specifier = tokens[index + 2];
			if (kind === SyntaxKind.ImportKeyword && specifier?.kind === SyntaxKind.StringLiteral) {
				found.push({ from: specifier.value, names: ["*"] });
			}
			continue;
		}
		const names: Array<string> = [];
		let braces = 0;
		for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
			const token = tokens[cursor];
			if (token === undefined || token.kind === SyntaxKind.SemicolonToken) break;
			if (token.kind === SyntaxKind.OpenBraceToken) braces += 1;
			else if (token.kind === SyntaxKind.CloseBraceToken) braces -= 1;
			else if (token.kind === SyntaxKind.AsteriskToken) names.push("*");
			else if (token.kind === SyntaxKind.Identifier) {
				// The imported name is the one before `as`; the local alias after it is not what the module exports.
				if (tokens[cursor - 1]?.kind !== SyntaxKind.AsKeyword) names.push(braces > 0 ? token.value : "*");
			} else if (token.kind === SyntaxKind.StringLiteral) {
				const before = tokens[cursor - 1]?.kind;
				if (before === SyntaxKind.FromKeyword || before === SyntaxKind.ImportKeyword) {
					found.push({ from: token.value, names });
				}
				break;
			} else if (braces === 0 && kind === SyntaxKind.ExportKeyword && token.kind !== SyntaxKind.TypeKeyword) {
				// `export const`, `export function`, `export interface`: a declaration, not a re-export.
				// `export * as ns from "x"` and `export { a } from "x"` carry on to their specifier.
				if (
					token.kind !== SyntaxKind.FromKeyword &&
					token.kind !== SyntaxKind.CommaToken &&
					token.kind !== SyntaxKind.AsKeyword
				) {
					break;
				}
			}
		}
	}
	return found;
};

const TESTING = "@effected/testing";

/** Which of the test kit's modules a file reaches, by its own imports and those of the helpers it imports. */
interface Reach {
	readonly growth: boolean;
	readonly depth: boolean;
}

/** The names a suffix-bearing file may reach to earn its suffix. */
const reachOf = (
	file: string,
	read: (file: string) => string | undefined,
	exists: (file: string) => boolean,
	tokensOf: (file: string, text: string) => ReadonlyArray<Token>,
	seen: Set<string> = new Set(),
): Reach => {
	if (seen.has(file)) return { growth: false, depth: false };
	seen.add(file);
	const text = read(file);
	if (text === undefined) return { growth: false, depth: false };
	let growth = false;
	let depth = false;
	for (const entry of importsOf(tokensOf(file, text))) {
		if (entry.from === TESTING) {
			if (entry.names.includes("Growth") || entry.names.includes("*")) growth = true;
			if (entry.names.includes("Depth") || entry.names.includes("Corpus") || entry.names.includes("*")) depth = true;
			continue;
		}
		if (!entry.from.startsWith(".")) continue;
		const base = join(dirname(file), entry.from).replace(/\.js$/, "");
		const target = [`${base}.ts`, `${base}.tsx`].find(exists);
		// Only helpers: a test's `src` imports are the code under test, which never imports the test kit.
		if (target === undefined || !target.includes("/__test__/")) continue;
		const inner = reachOf(target, read, exists, tokensOf, seen);
		growth ||= inner.growth;
		depth ||= inner.depth;
	}
	return { growth, depth };
};

const isTestFile = (file: string): boolean => /\.test\.tsx?$/.test(file);

/** Every offence in `files` (repo-relative paths), as `path: what is wrong`. */
export const offences = (
	files: ReadonlyArray<string>,
	read: (file: string) => string | undefined,
	allowedClocks: Readonly<Record<string, string>>,
	hostileWithoutGrowth: Readonly<Record<string, string>> = {},
): ReadonlyArray<string> => {
	const known = new Set(files);
	const exists = (file: string): boolean => known.has(file);
	// Each file is read and tokenized once, however many test files reach it: a shared harness is reached by
	// dozens, and tokenizing it for each of them was most of this scan's time.
	const texts = new Map<string, string | undefined>();
	const readOnce = (file: string): string | undefined => {
		if (!texts.has(file)) texts.set(file, read(file));
		return texts.get(file);
	};
	const parsed = new Map<string, ReadonlyArray<Token>>();
	const tokensOf = (file: string, text: string): ReadonlyArray<Token> => {
		let tokens = parsed.get(file);
		if (tokens === undefined) {
			tokens = tokenize(text);
			parsed.set(file, tokens);
		}
		return tokens;
	};
	const found: Array<string> = [];
	for (const file of files) {
		const text = readOnce(file);
		if (text === undefined) continue;
		if (!file.startsWith("packages/testing/") && allowedClocks[file] === undefined) {
			const reads = clockReads(tokensOf(file, text));
			if (reads.length > 0) {
				const names = [...new Set(reads.map((each) => each.name))].join(", ");
				found.push(
					`${file}: reads a clock (${names}). Assert how the work grows with @effected/testing's Growth in a ` +
						".hostile.test.ts file, or add the file to ALLOWED_CLOCKS with the reason it reads one.",
				);
			}
		}
		if (!isTestFile(file) || file.startsWith("packages/testing/")) continue;
		const reach = reachOf(file, readOnce, exists, tokensOf);
		if (reach.growth && !isHostile(file)) {
			found.push(`${file}: reaches Growth but is not named .hostile.test.ts, so it would run beside other files.`);
		}
		if (reach.depth && !isDepthAware(file)) {
			found.push(
				`${file}: reaches Depth or Corpus but is not named .parity.test.ts, .corpus.test.ts or .property.test.ts, ` +
					"so the full run would never find it.",
			);
		}
		if (isHostile(file) && !reach.growth && hostileWithoutGrowth[file] === undefined) {
			found.push(`${file}: named .hostile.test.ts but never reaches Growth.`);
		}
		if (isDepthAware(file) && !reach.depth) {
			found.push(
				`${file}: named as depth-aware but never reaches Depth or Corpus, so its sample and full runs are one.`,
			);
		}
	}
	return found;
};

/** Every tracked or untracked-but-unignored TypeScript file under a package's `__test__/`. */
const governedFiles = (): ReadonlyArray<string> =>
	execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ":(glob)packages/*/__test__/**"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter((file) => /\.tsx?$/.test(file) && !file.includes("/fixtures/") && existsSync(join(ROOT, file)));

describe("a test file's name says its kind, and no test reads a clock to bound a time", () => {
	const sources = (entries: Readonly<Record<string, string>>) => ({
		files: Object.keys(entries),
		read: (file: string): string | undefined => entries[file],
	});

	it("flags each clock read (positive control)", () => {
		for (const read of ["process.cpuUsage()", "process.hrtime.bigint()", "performance.now()", "Date.now()"]) {
			const { files, read: reader } = sources({ "packages/a/__test__/a.test.ts": `const t = ${read};\n` });
			assert.lengthOf(offences(files, reader, {}), 1, read);
		}
	});

	it("flags a clock reached another way: through the global object, a destructure, a named import or a string key", () => {
		for (const spelling of [
			"const t = globalThis.performance.now();",
			"const t = globalThis.Date.now();",
			"const { now } = performance;",
			"const { cpuUsage, pid } = process;",
			"const { hrtime: clock } = process;",
			'import { hrtime } from "node:process";',
			'import { cpuUsage as used } from "node:process";',
			'const t = performance["now"]();',
			'const t = process["cpuUsage"]();',
		]) {
			const { files, read } = sources({ "packages/a/__test__/a.test.ts": `${spelling}\n` });
			assert.lengthOf(offences(files, read, {}), 1, spelling);
		}
	});

	it("passes a destructure or a named import that takes no clock", () => {
		for (const spelling of [
			"const { pid, platform } = process;",
			'import { argv } from "node:process";',
			'const mark = performance["mark"]("a");',
		]) {
			const { files, read } = sources({ "packages/a/__test__/a.test.ts": `${spelling}\n` });
			assert.deepStrictEqual(offences(files, read, {}), [], spelling);
		}
	});

	it("follows a dynamic import and a namespace re-export to what they reach", () => {
		const dynamic = sources({
			"packages/a/__test__/a.test.ts": 'const kit = await import("@effected/testing");\n',
		});
		assert.lengthOf(offences(dynamic.files, dynamic.read, {}), 2);
		const reexported = sources({
			"packages/a/__test__/a.test.ts": 'import { kit } from "./helpers/kit.js";\n',
			"packages/a/__test__/helpers/kit.ts": 'export * as kit from "./inner.js";\n',
			"packages/a/__test__/helpers/inner.ts": 'export { Growth } from "@effected/testing";\n',
		});
		assert.match(offences(reexported.files, reexported.read, {})[0] ?? "", /a\.test\.ts: reaches Growth/);
	});

	it("passes a clock named in a comment, a string or another object's member, and an allowed file", () => {
		const text = [
			"// process.cpuUsage() is what Growth reads",
			'const label = "performance.now()";',
			"const t = clock.Date.now;",
			// A template whose text names the clock and whose substitution does not.
			["const u = `Date.now() is $", "{1}`;"].join(""),
		].join("\n");
		const { files, read } = sources({ "packages/a/__test__/a.test.ts": text });
		assert.deepStrictEqual(offences(files, read, {}), []);
		const clocked = sources({ "packages/a/__test__/b.test.ts": "const t = Date.now();\n" });
		assert.deepStrictEqual(offences(clocked.files, clocked.read, { "packages/a/__test__/b.test.ts": "a fixture" }), []);
	});

	it("never flags the test kit itself, which is where the clock lives", () => {
		const { files, read } = sources({ "packages/testing/src/Growth.ts": "process.cpuUsage();\n" });
		assert.deepStrictEqual(offences(files, read, {}), []);
	});

	it("holds a file that reaches Growth to the hostile suffix, through a helper too", () => {
		const direct = sources({
			"packages/a/__test__/a.test.ts": 'import { Growth } from "@effected/testing";\n',
		});
		assert.match(offences(direct.files, direct.read, {})[0] ?? "", /reaches Growth/);
		const through = sources({
			"packages/a/__test__/a.test.ts": 'import { measure } from "./helpers/measure.js";\n',
			"packages/a/__test__/helpers/measure.ts":
				'import { Growth } from "@effected/testing";\nexport const measure = 1;\n',
		});
		assert.match(offences(through.files, through.read, {})[0] ?? "", /a\.test\.ts: reaches Growth/);
		const named = sources({
			"packages/a/__test__/a.hostile.test.ts": 'import { Growth } from "@effected/testing";\n',
		});
		assert.deepStrictEqual(offences(named.files, named.read, {}), []);
	});

	it("holds a file that reaches Depth or Corpus to a depth-aware suffix, through a helper too", () => {
		for (const name of ["Depth", "Corpus"]) {
			const through = sources({
				"packages/a/__test__/rules/a.test.ts": 'import { differential } from "../helpers/differential.js";\n',
				"packages/a/__test__/helpers/differential.ts": `import { ${name} } from "@effected/testing";\n`,
			});
			assert.match(offences(through.files, through.read, {})[0] ?? "", /reaches Depth or Corpus/, name);
		}
		for (const suffix of [".parity.test.ts", ".corpus.test.ts", ".property.test.ts", ".property.test.tsx"]) {
			const named = sources({ [`packages/a/__test__/a${suffix}`]: 'import { Depth } from "@effected/testing";\n' });
			assert.deepStrictEqual(offences(named.files, named.read, {}), [], suffix);
		}
	});

	it("flags a suffix on a file that does not reach the matching API", () => {
		const hostile = sources({ "packages/a/__test__/a.hostile.test.ts": 'import { assert } from "vitest";\n' });
		assert.match(offences(hostile.files, hostile.read, {})[0] ?? "", /never reaches Growth/);
		const exempt = { "packages/a/__test__/a.hostile.test.ts": "measures by hand" };
		assert.deepStrictEqual(offences(hostile.files, hostile.read, {}, exempt), []);
		const parity = sources({ "packages/a/__test__/a.parity.test.ts": 'import { Growth } from "@effected/testing";\n' });
		assert.lengthOf(offences(parity.files, parity.read, {}), 2);
	});

	it("reads a type import, an aliased import and a namespace import as reaching what they name", () => {
		const aliased = sources({
			"packages/a/__test__/a.test.ts": 'import { Growth as G } from "@effected/testing";\n',
		});
		assert.match(offences(aliased.files, aliased.read, {})[0] ?? "", /reaches Growth/);
		const namespace = sources({ "packages/a/__test__/a.test.ts": 'import * as T from "@effected/testing";\n' });
		assert.lengthOf(offences(namespace.files, namespace.read, {}), 2);
		const other = sources({ "packages/a/__test__/a.test.ts": 'import { Growth } from "./growth-chart.js";\n' });
		assert.deepStrictEqual(offences(other.files, other.read, {}), []);
	});

	it("every hostile file exempt from Growth exists, is hostile, never reaches Growth, and reads a clock", () => {
		for (const file of Object.keys(HOSTILE_WITHOUT_GROWTH)) {
			assert.isTrue(existsSync(join(ROOT, file)), `${file} is exempt from Growth but does not exist`);
			assert.isTrue(isHostile(file), `${file} is exempt from Growth but is not a hostile file`);
			assert.isDefined(ALLOWED_CLOCKS[file], `${file} measures by hand, so ALLOWED_CLOCKS must name it`);
			const found = offences([file], (path) => readFileSync(join(ROOT, path), "utf8"), ALLOWED_CLOCKS);
			assert.include(found.join("\n"), "never reaches Growth", `${file} reaches Growth now; drop its exemption`);
		}
	});

	it("every allowed clock file exists and still reads a clock", () => {
		for (const file of Object.keys(ALLOWED_CLOCKS)) {
			assert.isTrue(existsSync(join(ROOT, file)), `${file} is allowed a clock but does not exist`);
			assert.isAbove(
				clockReads(tokenize(readFileSync(join(ROOT, file), "utf8"))).length,
				0,
				`${file} is allowed a clock it no longer reads; remove it from ALLOWED_CLOCKS`,
			);
		}
	});

	// A scan of every test file in the repository: seconds alone, and longer beside a thousand other test files on a
	// four-core runner, where the five-second default timed it out. The deadline is not a claim about its speed.
	it("finds no offence under packages/*/__test__/", { timeout: 120_000 }, () => {
		const files = governedFiles();
		// A walk that found nothing would pass everything.
		assert.isAbove(files.length, 1000);
		const found = offences(
			files,
			(file) => readFileSync(join(ROOT, file), "utf8"),
			ALLOWED_CLOCKS,
			HOSTILE_WITHOUT_GROWTH,
		);
		assert.deepStrictEqual(found, []);
	});
});
