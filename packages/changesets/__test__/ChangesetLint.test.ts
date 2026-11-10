// The default rules held to @changesets/parse, the parser the changesets tool
// runs: a file it parses fails no default rule, and a file it refuses fails
// one. It is loaded from beside @changesets/get-release-plan, as that package
// resolves it. Each input also runs through markdownlint, which
// @effected/markdown-lint pins, so the two hosts agree.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import type { LintDiagnostic, MarkdownlintRule } from "@effected/markdown-lint";
import { LintRule, MarkdownlintAdapter } from "@effected/markdown-lint";
import { Option } from "effect";
import { ChangesetLint } from "../src/ChangesetLint.js";
import { loadParse } from "./support/oracle.js";

// The markdownlint @effected/markdown-lint pins for its own host test: this
// package takes no dependency on it.
interface MarkdownlintFinding {
	readonly lineNumber: number;
	readonly ruleNames: ReadonlyArray<string>;
}
interface MarkdownlintApi {
	readonly lint: (options: {
		readonly strings: Readonly<Record<string, string>>;
		readonly customRules: ReadonlyArray<MarkdownlintRule>;
		readonly config: Readonly<Record<string, unknown>>;
	}) => Promise<Record<string, ReadonlyArray<MarkdownlintFinding>>>;
}
const markdownlintSpecifier = new URL(
	"../../markdown-lint/node_modules/markdownlint/lib/exports-promise.mjs",
	import.meta.url,
).href;
const markdownlint = (await import(markdownlintSpecifier)) as MarkdownlintApi;

const hosted = async (text: string, rules: ReadonlyArray<LintRule>) => {
	const config: Record<string, unknown> = { default: false };
	for (const rule of rules) config[rule.name] = true;
	const found = await markdownlint.lint({
		strings: { input: text },
		customRules: MarkdownlintAdapter.rules(rules),
		config,
	});
	return (found.input ?? []).map((f) => [f.ruleNames[1] ?? "", f.lineNumber] as const);
};

const ids = (findings: ReadonlyArray<LintDiagnostic>) =>
	findings.map((d) => [d.ruleNames[1] ?? "", d.lineNumber] as const);

/**
 * Inputs chosen for the edges of `@changesets/parse`: what it accepts that a
 * stricter reader would not (leading whitespace, text before the block, an
 * empty or falsy block, an empty summary, any non-blank key), and each way
 * it refuses a file.
 */
const corpus: ReadonlyArray<readonly [string, string]> = [
	["a release", '---\n"@scope/a": minor\n"b": patch\n---\n\nA change.\n'],
	["changeset add --empty", "---\n---\n"],
	["an empty block with a summary", "---\n---\n\nNothing released.\n"],
	["an empty summary", "---\na: patch\n---\n"],
	["none", "---\na: none\n---\n\nNamed, not released.\n"],
	["leading blank lines", "\n\n---\na: patch\n---\n\nX.\n"],
	["leading spaces before the fence", "  ---\na: patch\n---\n\nX.\n"],
	["text before the block", "Intro.\n---\na: patch\n---\n\nX.\n"],
	["a false value", "---\nfalse\n---\n\nX.\n"],
	["a null value", "---\nnull\n---\n\nX.\n"],
	["a zero value", "---\n0\n---\n\nX.\n"],
	["an uppercase name", "---\nMyPackage: patch\n---\n\nX.\n"],
	["a numeric key", "---\n1: patch\n---\n\nX.\n"],
	["a comment in the block", "---\n# releases\na: patch # why\n---\n\nX.\n"],
	["CRLF line endings", "---\r\na: patch\r\n---\r\n\r\nX.\r\n"],
	["a byte order mark", "﻿---\na: patch\n---\n\nX.\n"],
	["single-quoted values", "---\n'a': 'minor'\n---\n\nX.\n"],
	["a flow mapping", "---\n{ a: patch, b: minor }\n---\n\nX.\n"],
	["an empty file", ""],
	["whitespace only", "  \n\n"],
	["no front matter", "Just text.\n"],
	["an unterminated block", "---\na: patch\n\nX.\n"],
	["invalid YAML", "---\na: [patch\n---\n\nX.\n"],
	["a sequence", "---\n- a\n- b\n---\n\nX.\n"],
	["a string value", "---\nhello\n---\n\nX.\n"],
	["a blank key", '---\n"": patch\n---\n\nX.\n'],
	["a whitespace key", '---\n" ": patch\n---\n\nX.\n'],
	["an unknown release type", "---\na: major2\n---\n\nX.\n"],
	["an uppercase release type", "---\na: Patch\n---\n\nX.\n"],
	["a numeric release type", "---\na: 1\n---\n\nX.\n"],
	["a null release type", "---\na:\n---\n\nX.\n"],
	["a nested release type", "---\na:\n  type: patch\n---\n\nX.\n"],
	["a release type past 2^53", '---\n"@a/b": 9007199254740993\n---\n\nX.\n'],
	["a release type nesting a value past 2^53", "---\na: [9007199254740993]\n---\n\nX.\n"],
	["one bad release among good ones", "---\na: patch\nb: huge\nc: minor\n---\n\nX.\n"],
];

const golden: { readonly cases: ReadonlyArray<{ readonly id: number; readonly markdown: string }> } = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("../../markdown-lint/__test__/fixtures/changesets/golden.json", import.meta.url)),
		"utf8",
	),
);

const parses = (parse: (contents: string) => unknown, text: string): boolean => {
	try {
		parse(text);
		return true;
	} catch {
		return false;
	}
};

describe("ChangesetLint's defaults against @changesets/parse", async () => {
	const parse = await loadParse();

	for (const [label, text] of corpus) {
		it(label, async () => {
			const findings = ids(ChangesetLint.lint(text));
			if (parses(parse, text)) assert.deepStrictEqual(findings, [], "a file the oracle parses fails no default rule");
			else assert.isAbove(findings.length, 0, "a file the oracle refuses fails a default rule");
			assert.deepStrictEqual(await hosted(text, ChangesetLint.defaults), findings, "markdownlint agrees");
		});
	}

	it("the corpus reaches both verdicts: the oracle parses some and refuses some", () => {
		const verdicts = corpus.map(([, text]) => parses(parse, text));
		assert.isTrue(verdicts.includes(true) && verdicts.includes(false));
	});

	it("agrees with the oracle on every golden-corpus input, both ways", () => {
		let accepted = 0;
		for (const entry of golden.cases) {
			const findings = ids(ChangesetLint.lint(entry.markdown));
			if (parses(parse, entry.markdown)) {
				accepted++;
				assert.deepStrictEqual(findings, [], `golden case ${entry.id}`);
			} else assert.isAbove(findings.length, 0, `golden case ${entry.id}`);
		}
		// Most golden inputs are bodies with no front matter, which the oracle refuses.
		assert.isAbove(accepted, 0);
		assert.isBelow(accepted, golden.cases.length);
	});
});

describe("ChangesetLint", () => {
	it("names its rules CF001 to CF004", () => {
		assert.deepStrictEqual(
			[...ChangesetLint.defaults, ChangesetLint.knownPackages([])].map((rule) => [...rule.names]),
			[
				["changeset-front-matter", "CF001"],
				["changeset-package-name", "CF002"],
				["changeset-release-type", "CF003"],
				["changeset-known-package", "CF004"],
			],
		);
		assert.strictEqual(ChangesetLint.frontMatter, ChangesetLint.defaults[0]);
		assert.strictEqual(ChangesetLint.packageName, ChangesetLint.defaults[1]);
		assert.strictEqual(ChangesetLint.releaseType, ChangesetLint.defaults[2]);
	});

	it("reports each bad entry on its own line, and a broken block once", () => {
		assert.deepStrictEqual(ids(ChangesetLint.lint("---\na: patch\nb: huge\nc: minor\n---\n\nX.\n")), [["CF003", 3]]);
		assert.deepStrictEqual(ids(ChangesetLint.lint("---\na: [patch\n---\n\nX.\n")), [["CF001", 1]]);
	});

	it("reports a release type YAML decodes as a bigint instead of throwing on it", () => {
		const [top] = ChangesetLint.lint('---\n"@a/b": 9007199254740993\n---\n\nX.\n');
		assert.deepStrictEqual(top?.ruleNames[1], "CF003");
		assert.include(
			Option.getOrElse(top?.detail ?? Option.none(), () => ""),
			"@a/b: 9007199254740993 is not a release type",
		);
		const [nested] = ChangesetLint.lint("---\na: [9007199254740993]\n---\n\nX.\n");
		assert.deepStrictEqual(nested?.ruleNames[1], "CF003");
		assert.include(
			Option.getOrElse(nested?.detail ?? Option.none(), () => ""),
			'["9007199254740993"] is not a release type',
		);
	});

	it("checks package existence only when the workspace's names are given", async () => {
		const text = '---\n"@scope/a": patch\nghost: minor\n---\n\nX.\n';
		assert.deepStrictEqual(ids(ChangesetLint.lint(text)), []);
		const known = ids(ChangesetLint.lint(text, { packages: ["@scope/a"] }));
		assert.deepStrictEqual(known, [["CF004", 3]]);
		assert.deepStrictEqual(
			await hosted(text, [...ChangesetLint.defaults, ChangesetLint.knownPackages(["@scope/a"])]),
			known,
		);
		// A file the oracle parses can still fail it: it is the one default that looks past the file.
		assert.deepStrictEqual(ids(ChangesetLint.lint(text, { packages: ["@scope/a", "ghost"] })), []);
	});

	it("runs the caller's rules after the defaults, and lets the defaults be replaced", () => {
		const noSummary = LintRule.make({
			names: ["house-summary"],
			description: "A summary follows the front matter",
			tags: ["house"],
			check: (context, report) => {
				if (/---\s*$/.test(context.source)) report(context.diagnostic({ at: { offset: 0, length: 0 } }));
			},
		});
		const text = "---\na: huge\n---\n";
		assert.deepStrictEqual(
			ChangesetLint.lint(text, { rules: [noSummary] }).map((d) => d.ruleNames[0]),
			["changeset-release-type", "house-summary"],
		);
		assert.deepStrictEqual(
			ChangesetLint.lint(text, { rules: [noSummary], defaults: [] }).map((d) => d.ruleNames[0]),
			["house-summary"],
		);
	});
});
