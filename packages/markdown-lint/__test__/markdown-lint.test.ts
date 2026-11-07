// The rule definition and the programmatic host: LintRule's validation to
// markdownlint's custom-rule contract, the LintContext a check receives, how
// a report becomes a LintDiagnostic, and MarkdownLint's ordering, naming
// check, refusal reporting and Effect twin.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownEdit } from "@effected/markdown";
import { Cause, Effect, Exit, Option, Result } from "effect";
import type { LintContext } from "../src/LintContext.js";
import { LintDiagnostic, LintFixInfo } from "../src/LintDiagnostic.js";
import { LintRule } from "../src/LintRule.js";
import { MarkdownLint } from "../src/MarkdownLint.js";

const ruleNamed = (names: ReadonlyArray<string>, check: LintRule["check"] = () => {}) =>
	LintRule.make({ names: names as [string, ...Array<string>], description: "d", tags: ["t"], check });

/** A rule that hands its context out, so a test can inspect it. */
const capture = (source: string, options?: Parameters<typeof MarkdownLint.lint>[2]): LintContext => {
	let seen: LintContext | undefined;
	MarkdownLint.lint(
		source,
		[
			ruleNamed(["capture"], (context) => {
				seen = context;
			}),
		],
		options,
	);
	assert.isDefined(seen);
	return seen as LintContext;
};

describe("LintRule", () => {
	it("makes a rule and names it by its first name", () => {
		const rule = LintRule.make({
			names: ["my-rule", "MY001"],
			description: "Checks things",
			tags: ["style"],
			information: "https://example.com/my-rule",
			check: () => {},
		});
		assert.strictEqual(rule.name, "my-rule");
		assert.strictEqual(rule.information, "https://example.com/my-rule");
	});

	it("refuses metadata markdownlint's custom-rule validation would refuse", () => {
		const base = { names: ["ok"] as [string], description: "d", tags: ["t"] as [string], check: () => {} };
		const refused: ReadonlyArray<[string, unknown]> = [
			["no names", { ...base, names: [] }],
			["an empty name", { ...base, names: [""] }],
			["no tags", { ...base, tags: [] }],
			["an empty tag", { ...base, tags: [""] }],
			["an empty description", { ...base, description: "" }],
			["a name used twice, ignoring case", { ...base, names: ["dup", "DUP"] }],
			["a tag equal to a name", { ...base, names: ["style"], tags: ["Style"] }],
			["an information that is not a URL", { ...base, information: "not a url" }],
			["a check that is not a function", { ...base, check: "nope" }],
		];
		for (const [label, input] of refused) {
			assert.throws(() => LintRule.make(input as Parameters<typeof LintRule.make>[0]), undefined, undefined, label);
		}
		// The control: the base itself is accepted.
		assert.strictEqual(LintRule.make(base).name, "ok");
	});
});

describe("LintContext", () => {
	it("hands the check the document, source, root, lines and name", () => {
		const source = "# A\r\n\r\nb\r\n";
		const context = capture(source, { name: "docs/a.md" });
		assert.strictEqual(context.name, "docs/a.md");
		assert.strictEqual(context.source, source);
		assert.strictEqual(context.root, context.document.root);
		assert.deepStrictEqual(context.lines, ["# A", "", "b", ""]);
		assert.isTrue(Option.isNone(context.frontmatter));
	});

	it("drops a leading byte order mark before the parse, as markdownlint does", () => {
		const context = capture("﻿# Title\n");
		assert.strictEqual(context.source, "# Title\n");
		const heading = Option.getOrThrow(context.document.find("heading"));
		const finding = context.diagnostic({ at: heading });
		assert.strictEqual(finding.lineNumber, 1);
		assert.strictEqual(finding.column, 1);
	});

	it("names the input <input> by default", () => {
		assert.strictEqual(capture("x\n").name, "<input>");
	});

	it("reports the frontmatter block's node, line count and lines", () => {
		const context = capture("---\ntitle: x\nn: 1\n---\n\nBody\n");
		const frontmatter = Option.getOrThrow(context.frontmatter);
		assert.strictEqual(frontmatter.node.format, "yaml");
		assert.strictEqual(frontmatter.lineCount, 4);
		assert.deepStrictEqual(frontmatter.lines, ["---", "title: x", "n: 1", "---"]);
		assert.strictEqual(context.root.children[0]?.type, "frontmatter");
	});

	it("leaves the fences to the markdown parse when frontmatter capture is off", () => {
		const context = capture("---\ntitle: x\n---\n\nBody\n", { frontmatter: false });
		assert.isTrue(Option.isNone(context.frontmatter));
		assert.notStrictEqual(context.root.children[0]?.type, "frontmatter");
	});

	describe("diagnostic", () => {
		const source = "Intro\n\n## Heading *here*\n";
		const context = capture(source);
		const heading = Option.getOrThrow(context.document.find("heading"));

		it("stamps the rule's names and positions the report by its node", () => {
			const finding = context.diagnostic({ at: heading, detail: "bad" });
			assert.deepStrictEqual(
				finding,
				LintDiagnostic.make({
					ruleNames: ["capture"],
					lineNumber: 3,
					column: 1,
					detail: Option.some("bad"),
					context: Option.none(),
					range: Option.none(),
					fixInfo: Option.none(),
					edit: Option.none(),
				}),
			);
		});

		it("positions a report by an offset span", () => {
			const offset = source.indexOf("*here*");
			const finding = context.diagnostic({ at: { offset, length: 6 }, range: true, context: "*here*" });
			assert.strictEqual(finding.lineNumber, 3);
			assert.strictEqual(finding.column, 12);
			assert.deepStrictEqual(finding.range, Option.some([12, 6] as const));
			assert.deepStrictEqual(finding.context, Option.some("*here*"));
			assert.isTrue(Option.isNone(finding.detail));
		});

		it("reports a range only when asked, and a named span instead of the node's when given", () => {
			assert.isTrue(Option.isNone(context.diagnostic({ at: heading }).range));
			assert.isTrue(Option.isNone(context.diagnostic({ at: heading, range: false }).range));
			assert.deepStrictEqual(context.diagnostic({ at: heading, range: true }).range, Option.some([1, 17] as const));
			assert.deepStrictEqual(
				context.diagnostic({ at: heading, range: { offset: heading.position.start.offset + 3, length: 7 } }).range,
				Option.some([4, 7] as const),
			);
		});

		it("cuts a named span to the diagnostic's line, so a span on another line reports no range", () => {
			const paragraph = Option.getOrThrow(context.document.find("paragraph"));
			assert.notStrictEqual(
				context.mapping.nodeLineNumber(paragraph),
				context.mapping.nodeLineNumber(heading),
				"the fixture's first paragraph must sit on another line than the heading",
			);
			const finding = context.diagnostic({
				at: heading,
				range: { offset: paragraph.position.start.offset + 2, length: 3 },
			});
			assert.strictEqual(finding.lineNumber, context.mapping.nodeLineNumber(heading));
			assert.isTrue(Option.isNone(finding.range));
		});

		it("reads an empty detail or context as absent, as markdownlint does", () => {
			const finding = context.diagnostic({ at: heading, detail: "", context: "" });
			assert.isTrue(Option.isNone(finding.detail));
			assert.isTrue(Option.isNone(finding.context));
		});

		it("carries a fix both as markdownlint's fixInfo and as the kit edit", () => {
			const offset = heading.position.start.offset;
			const finding = context.diagnostic({ at: heading, fix: { offset, length: 2, content: "#" } });
			assert.deepStrictEqual(
				finding.fixInfo,
				Option.some(LintFixInfo.make({ editColumn: 1, deleteCount: 2, insertText: "#" })),
			);
			assert.deepStrictEqual(finding.edit, Option.some(MarkdownEdit.make({ offset, length: 2, content: "#" })));
			assert.strictEqual(MarkdownEdit.applyAll(source, Option.toArray(finding.edit)), "Intro\n\n# Heading *here*\n");
		});

		it("keeps the kit edit when the fix cannot be one markdownlint fixInfo", () => {
			const finding = context.diagnostic({ at: heading, fix: { offset: 0, length: 8, content: "" } });
			assert.isTrue(Option.isNone(finding.fixInfo));
			assert.isTrue(Option.isSome(finding.edit));
		});
	});
});

describe("MarkdownLint", () => {
	const everyHeading = (name: string) =>
		ruleNamed([name], (context, report) => {
			for (const heading of context.document.findAll("heading")) {
				report(context.diagnostic({ at: heading, detail: `${name}:${heading.depth}` }));
			}
		});

	it("returns findings in rule order, then report order", () => {
		const findings = MarkdownLint.lint("## b\n\n# a\n", [everyHeading("z-rule"), everyHeading("a-rule")]);
		assert.deepStrictEqual(
			findings.map((finding) => Option.getOrNull(finding.detail)),
			["z-rule:2", "z-rule:1", "a-rule:2", "a-rule:1"],
		);
	});

	it("returns nothing for no rules or no findings", () => {
		assert.deepStrictEqual(MarkdownLint.lint("# a\n", []), []);
		assert.deepStrictEqual(MarkdownLint.lint("plain\n", [everyHeading("h")]), []);
	});

	it("throws when two rules share a name, ignoring case", () => {
		assert.throws(() => MarkdownLint.lint("x", [ruleNamed(["one", "SHARED"]), ruleNamed(["shared"])]), /already used/);
		const document = Result.getOrThrow(MarkdownDocument.parseResult(""));
		assert.throws(() => MarkdownLint.lintDocument(document, [ruleNamed(["a"]), ruleNamed(["A"])]), /already used/);
	});

	it("lets a rule's throw propagate", () => {
		const broken = ruleNamed(["broken"], () => {
			throw new Error("rule bug");
		});
		assert.throws(() => MarkdownLint.lint("x\n", [broken]), /rule bug/);
	});

	it("reports a document nested past the hardening cap once per rule, never throwing", () => {
		const bomb = `${"> ".repeat(300)}deep\n`;
		const findings = MarkdownLint.lint(bomb, [everyHeading("one"), everyHeading("two")]);
		assert.deepStrictEqual(
			findings.map((finding) => finding.ruleNames[0]),
			["one", "two"],
		);
		for (const finding of findings) {
			assert.match(
				Option.getOrElse(finding.detail, () => ""),
				/^Markdown parse failed: NestingDepthExceeded/,
			);
			assert.strictEqual(finding.lineNumber, 1);
		}
	});

	it("parses with the gfm dialect unless told otherwise", () => {
		const tables = (dialect?: "commonmark" | "gfm") => {
			let count = 0;
			MarkdownLint.lint(
				"| a |\n| - |\n| b |\n",
				[
					ruleNamed(["tables"], (context) => {
						count = context.document.findAll("table").length;
					}),
				],
				dialect === undefined ? {} : { dialect },
			);
			return count;
		};
		assert.strictEqual(tables(), 1);
		assert.strictEqual(tables("commonmark"), 0);
	});

	it("lintDocument runs over the given document as is", () => {
		const document = Result.getOrThrow(MarkdownDocument.parseResult("# a\n\n## b\n"));
		let seen: unknown;
		const findings = MarkdownLint.lintDocument(document, [
			everyHeading("h"),
			ruleNamed(["see"], (context) => {
				seen = context.document;
			}),
		]);
		assert.strictEqual(seen, document);
		assert.lengthOf(findings, 2);
	});

	it.effect("lintEffect yields exactly lint's findings", () =>
		Effect.gen(function* () {
			const rules = [everyHeading("h")];
			const findings = yield* MarkdownLint.lintEffect("# a\n\n## b\n", rules);
			assert.deepStrictEqual(findings, MarkdownLint.lint("# a\n\n## b\n", rules));
		}),
	);

	it.effect("lintEffect dies, rather than fails, on a rule's throw", () =>
		Effect.gen(function* () {
			const bug = new Error("rule bug");
			const broken = ruleNamed(["broken"], () => {
				throw bug;
			});
			const exit = yield* Effect.exit(MarkdownLint.lintEffect("x\n", [broken]));
			if (Exit.isFailure(exit)) {
				assert.isFalse(Cause.hasFails(exit.cause), "a rule's throw must not reach the typed channel");
				const defects = exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);
				assert.lengthOf(defects, 1);
				assert.strictEqual(defects[0], bug, "the Die must carry the rule's own error");
			} else {
				assert.fail("expected a defect, but the lint succeeded");
			}
		}),
	);
});
