// The host applies markdownlint's configuration, inline comments and severity,
// and reads each file the way markdownlint does: HTML comment bodies masked
// after the front matter, front matter counted by markdownlint's own pattern.
// The differential cases run the same inputs and configs through the REAL
// markdownlint (through a variable specifier, as markdownlint-host.test.ts
// does) with the probes adapted, and require the two hosts to agree.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Option, Result } from "effect";
import type { LintConfigRecord } from "../src/LintConfig.js";
import type { LintContext } from "../src/LintContext.js";
import type { LintDiagnostic } from "../src/LintDiagnostic.js";
import { LintRule } from "../src/LintRule.js";
import type { MarkdownLintOptions } from "../src/MarkdownLint.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import type { MarkdownlintRule } from "../src/MarkdownlintAdapter.js";
import { MarkdownlintAdapter } from "../src/MarkdownlintAdapter.js";

interface MarkdownlintResult {
	readonly lineNumber: number;
	readonly ruleNames: ReadonlyArray<string>;
	readonly errorDetail: string | null;
	readonly severity: string;
}

interface MarkdownlintSync {
	readonly lint: (options: {
		readonly strings: Readonly<Record<string, string>>;
		readonly customRules: ReadonlyArray<MarkdownlintRule>;
		readonly config: Readonly<Record<string, unknown>>;
		readonly noInlineConfig?: boolean;
	}) => Record<string, ReadonlyArray<MarkdownlintResult>>;
}

const syncSpecifier = "markdownlint/sync";
const markdownlint: MarkdownlintSync = await import(syncSpecifier);

// The 0-based offset each line of `source` starts at, split as markdownlint splits.
const lineStarts = (source: string): Array<number> => {
	const starts = [0];
	for (const match of source.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
	return starts;
};

// Reports once per non-blank line, its text as the detail.
const everyLine = LintRule.make({
	names: ["every-line"],
	description: "Reports every non-blank line",
	tags: ["probe"],
	check: (context, report) => {
		const starts = lineStarts(context.source);
		for (const [index, line] of context.lines.entries()) {
			if (line.trim() === "") continue;
			report(context.diagnostic({ at: { offset: starts[index] ?? 0, length: 0 }, detail: line }));
		}
	},
});

// Reports its configuration once, on line 1.
const echoConfig = LintRule.make({
	names: ["echo-config"],
	description: "Reports its configuration",
	tags: ["probe"],
	check: (context, report) => {
		report(context.diagnostic({ at: { offset: 0, length: 0 }, detail: JSON.stringify(context.config) }));
	},
});

const probes = [everyLine, echoConfig];

const lines = (findings: ReadonlyArray<LintDiagnostic>) => findings.map((finding) => finding.lineNumber);

const capture = (source: string, options?: MarkdownLintOptions): LintContext => {
	let seen: LintContext | undefined;
	MarkdownLint.lint(
		source,
		[
			LintRule.make({
				names: ["capture"],
				description: "Hands its context out",
				tags: ["probe"],
				check: (context) => {
					seen = context;
				},
			}),
		],
		options,
	);
	assert.isDefined(seen);
	return seen as LintContext;
};

describe("MarkdownLint applies markdownlint configuration", () => {
	it("runs nothing under default: false, and a rule the config names", () => {
		let ran = 0;
		const counting = LintRule.make({
			names: ["counting"],
			description: "Counts its runs",
			tags: ["probe"],
			check: () => {
				ran++;
			},
		});
		assert.lengthOf(MarkdownLint.lint("a\nb\n", [everyLine, counting], { config: { default: false } }), 0);
		assert.strictEqual(ran, 0);
		assert.deepStrictEqual(
			lines(MarkdownLint.lint("a\nb\n", [everyLine, counting], { config: { default: false, "every-line": true } })),
			[1, 2],
		);
		assert.strictEqual(ran, 0);
	});

	it("enables every rule by default, at severity error", () => {
		const findings = MarkdownLint.lint("a\nb\n", [everyLine]);
		assert.deepStrictEqual(lines(findings), [1, 2]);
		for (const finding of findings) assert.strictEqual(finding.severity, "error");
	});

	it("stamps the configured severity", () => {
		const findings = MarkdownLint.lint("a\nb\n", [everyLine], { config: { "every-line": "warning" } });
		assert.lengthOf(findings, 2);
		for (const finding of findings) assert.strictEqual(finding.severity, "warning");
	});

	it("hands a rule its settings without enabled and severity", () => {
		const findings = MarkdownLint.lint("a\n", [echoConfig], {
			config: { "echo-config": { a: 1, severity: "warning" } },
		});
		assert.deepStrictEqual(
			findings.map((finding) => [Option.getOrNull(finding.detail), finding.severity]),
			[['{"a":1}', "warning"]],
		);
	});

	it("honours disable-next-line, and ignores it under noInlineConfig", () => {
		const source = "a\n<!-- markdownlint-disable-next-line every-line -->\nb\nc\n";
		assert.deepStrictEqual(lines(MarkdownLint.lint(source, [everyLine])), [1, 2, 4]);
		assert.deepStrictEqual(lines(MarkdownLint.lint(source, [everyLine], { noInlineConfig: true })), [1, 2, 3, 4]);
	});

	it("applies the same configuration through lintDocument", () => {
		const document = Result.getOrThrow(
			MarkdownDocument.parseResult("a\n<!-- markdownlint-disable-next-line every-line -->\nb\n"),
		);
		const findings = MarkdownLint.lintDocument(document, [everyLine], { config: { "every-line": "warning" } });
		assert.deepStrictEqual(lines(findings), [1, 2]);
		for (const finding of findings) assert.strictEqual(finding.severity, "warning");
	});

	it("reports a parse refusal at severity error for each enabled rule", () => {
		const bomb = `${"> ".repeat(300)}deep\n`;
		const findings = MarkdownLint.lint(bomb, probes, {
			config: { default: false, "every-line": "warning" },
		});
		assert.deepStrictEqual(
			findings.map((finding) => [finding.ruleNames[0], finding.severity]),
			[["every-line", "error"]],
		);
	});
});

describe("MarkdownLint reads a file as markdownlint does", () => {
	it("hides HTML comment bodies from rules, at the same offsets", () => {
		const source = "Text <!-- secret --> end\n";
		const context = capture(source);
		assert.deepStrictEqual(context.lines, ["Text <!-- ...... --> end", ""]);
		assert.strictEqual(context.source, "Text <!-- ...... --> end\n");
		assert.strictEqual(context.source.length, source.length);
	});

	it("reads a { } block as front matter the kit does not capture, with no node inside it", () => {
		const source = '{\n"title": "x"\n}\n# H\n';
		const context = capture(source);
		const frontmatter = Option.getOrThrow(context.frontmatter);
		assert.strictEqual(frontmatter.lineCount, 3);
		assert.deepStrictEqual(frontmatter.lines, ["{", '"title": "x"', "}"]);
		assert.isTrue(Option.isNone(frontmatter.node));
		for (const node of context.root.children) assert.isAbove(node.position.start.line, 3, node.type);
		assert.strictEqual(context.root.children[0]?.type, "heading");
		assert.strictEqual(context.root.children[0]?.position.start.offset, source.indexOf("# H"));
	});

	it("counts the blank lines markdownlint's closing fence swallows, keeping the kit's node", () => {
		const context = capture("---\ntitle: x\n---\n\n\n# H\n");
		const frontmatter = Option.getOrThrow(context.frontmatter);
		assert.strictEqual(frontmatter.lineCount, 5);
		assert.deepStrictEqual(frontmatter.lines, ["---", "title: x", "---", "", ""]);
		assert.strictEqual(Option.getOrThrow(frontmatter.node).format, "yaml");
	});

	it("does not capture a ---json block, which markdownlint reads as content", () => {
		const context = capture('---json\n{"a": 1}\n---\n# H\n');
		assert.isTrue(Option.isNone(context.frontmatter));
		assert.notStrictEqual(context.root.children[0]?.type, "frontmatter");
	});

	it("reads a ...-closed +++ block and a fence with trailing spaces as front matter with no node", () => {
		for (const source of ["+++\na = 1\n...\n# H\n", "---  \ntitle: x\n---\n# H\n"]) {
			const context = capture(source);
			const frontmatter = Option.getOrThrow(context.frontmatter);
			assert.strictEqual(frontmatter.lineCount, 3, JSON.stringify(source));
			assert.isTrue(Option.isNone(frontmatter.node), JSON.stringify(source));
			for (const node of context.root.children) assert.isAbove(node.position.start.line, 3, node.type);
		}
	});

	it("leaves HTML comments in the front matter unmasked", () => {
		const context = capture("---\nnote: <!-- kept -->\n---\n<!-- hidden -->\n");
		assert.deepStrictEqual(context.lines, ["---", "note: <!-- kept -->", "---", "<!-- ...... -->", ""]);
	});
});

const inputs: ReadonlyArray<readonly [string, string]> = [
	["plain lines", "# A\n\nb\nc\n"],
	["a disable-next-line comment", "# A\n<!-- markdownlint-disable-next-line every-line -->\nc\nd\n"],
	[
		"a disable-next-line comment after front matter",
		"---\ntitle: x\n---\n<!-- markdownlint-disable-next-line every-line -->\nc\nd\n",
	],
	[
		"a disable-line comment inside front matter",
		"---\nnote: <!-- markdownlint-disable-line every-line -->\nb: 1\n---\nbody\n",
	],
	[
		"a disable-next-line comment inside front matter",
		"---\na: <!-- markdownlint-disable-next-line every-line -->\nb: 1\n---\nbody\n",
	],
	["a disable comment inside front matter", "---\na: <!-- markdownlint-disable every-line -->\n---\nbody\nmore\n"],
	["a { } block and a comment", '{\n"title": "x"\n}\n<!-- markdownlint-disable-line -->\nbody\n'],
	["a ---json block", '---json\n{"a": 1}\n---\n<!-- markdownlint-disable-next-line -->\n# H\nx\n'],
	["a ...-closed +++ block", "+++\na = 1\n...\n<!-- markdownlint-disable-line -->\n# H\n"],
	["a fence with trailing spaces", "---  \ntitle: x\n---\n# H\n<!-- a -->\n"],
	["swallowed blank lines", "---\ntitle: x\n---\n\n\n<!-- markdownlint-disable-next-line -->\nx\ny\n"],
	["disable and enable", "<!-- markdownlint-disable -->\na\n<!-- markdownlint-enable every-line -->\nb\n"],
	[
		"capture and restore",
		"<!-- markdownlint-capture -->\n<!-- markdownlint-disable -->\na\n<!-- markdownlint-restore -->\nb\n",
	],
	["a configure-file comment", '<!-- markdownlint-configure-file { "every-line": "warning" } -->\na\n'],
	["CRLF line endings", "a\r\n<!-- markdownlint-disable-next-line every-line -->\r\nb\r\nc\r\n"],
	["a masked comment", "Text <!-- secret --> end\n<!--\nmulti line\n-->\n"],
	["a byte order mark", "﻿a\n<!-- markdownlint-disable-line -->\n"],
];

const configs: ReadonlyArray<LintConfigRecord> = [
	{ default: false, "every-line": true, "echo-config": true },
	{ default: false },
	{ default: false, "every-line": true },
	{ default: false, "every-line": "warning", "echo-config": { a: 1, severity: "warning" } },
	{ default: "warning", "echo-config": { enabled: true, b: [1, 2] } },
	{ default: false, probe: true },
];

const probeNames = new Set(probes.map((rule) => rule.name));

const viaMarkdownlint = (text: string, config: LintConfigRecord, noInlineConfig: boolean) =>
	(
		markdownlint.lint({
			strings: { input: text },
			customRules: MarkdownlintAdapter.rules(probes),
			config,
			noInlineConfig,
		}).input ?? []
	)
		.filter((result) => probeNames.has(result.ruleNames[0] ?? ""))
		.map((result) => ({
			rule: result.ruleNames[0],
			lineNumber: result.lineNumber,
			detail: result.errorDetail,
			severity: result.severity,
		}));

const viaHost = (text: string, config: LintConfigRecord, noInlineConfig: boolean) =>
	MarkdownLint.lint(text, probes, { config, noInlineConfig })
		.map((finding) => ({
			rule: finding.ruleNames[0],
			lineNumber: finding.lineNumber,
			detail: Option.getOrNull(finding.detail),
			severity: finding.severity,
		}))
		// markdownlint sorts by rule name, then line.
		.sort((a, b) => a.rule.localeCompare(b.rule) || a.lineNumber - b.lineNumber);

describe("the programmatic host agrees with markdownlint", () => {
	for (const [label, text] of inputs) {
		for (const noInlineConfig of [false, true]) {
			it(`${label}${noInlineConfig ? " under noInlineConfig" : ""}`, () => {
				for (const config of configs) {
					assert.deepStrictEqual(
						viaHost(text, config, noInlineConfig),
						viaMarkdownlint(text, config, noInlineConfig),
						JSON.stringify(config),
					);
				}
			});
		}
	}

	it("has a discriminating corpus: the comments change markdownlint's own output", () => {
		const text = inputs[2]?.[1] ?? "";
		const config = { default: false, "every-line": true };
		assert.notDeepEqual(viaMarkdownlint(text, config, false), viaMarkdownlint(text, config, true));
		assert.deepStrictEqual(
			viaMarkdownlint(text, config, false).map((result) => result.lineNumber),
			[1, 2, 3, 4, 6],
		);
	});
});
