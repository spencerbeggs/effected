// Regenerate ../golden.json from a savvy-web/systems checkout. Run from the
// silk-effects package, which supplies tsx, markdownlint and the published
// @effected/markdown its rules import:
//
//   cd <systems>/packages/silk-effects
//   SYSTEMS="$PWD" node --import tsx/esm --import <here>/register.mjs <here>/capture.mjs <out.json>
import { writeFileSync } from "node:fs";
import { drain } from "./vitest-stub.mjs";

const SYSTEMS = process.env.SYSTEMS;
const [out] = process.argv.slice(2);
const files = [
	"rules__heading-hierarchy",
	"rules__required-sections",
	"rules__content-structure",
	"rules__uncategorized-content",
	"rules__dependency-table-format",
	"markdownlint__rules__heading-hierarchy",
	"markdownlint__rules__required-sections",
	"markdownlint__rules__content-structure",
	"markdownlint__rules__uncategorized-content",
	"markdownlint__rules__dependency-table-format",
	"api__linter",
];
for (const file of files) {
	globalThis.__currentFile = file;
	await import(`${SYSTEMS}/__test__/changesets/${file}.test.ts`);
	await drain();
}
const records = globalThis.__records.slice();
const { ChangesetLinter } = await import(`${SYSTEMS}/src/changesets/api/linter.ts`);
const { default: rules } = await import(`${SYSTEMS}/src/changesets/markdownlint/index.ts`);
const markdownlint = await import(`${SYSTEMS}/node_modules/markdownlint/lib/exports-sync.mjs`);
const { getVersion } = await import(`${SYSTEMS}/node_modules/markdownlint/lib/exports.mjs`);
const markdownVersion = (await import(`${SYSTEMS}/node_modules/@effected/markdown/package.json`, { with: { type: "json" } }))
	.default.version;

const byText = new Map();
for (const record of records) {
	const source = `${record.file} > ${record.test}`;
	const entry = byText.get(record.text);
	if (entry === undefined) byText.set(record.text, { markdown: record.text, sources: [source] });
	else if (!entry.sources.includes(source)) entry.sources.push(source);
}
const config = { default: false, CSH001: true, CSH002: true, CSH003: true, CSH004: true, CSH005: true };
const cases = [...byText.values()].map((entry, index) => ({
	id: index + 1,
	sources: entry.sources,
	markdown: entry.markdown,
	programmatic: ChangesetLinter.validateContent(entry.markdown).map(({ rule, line, column, message }) => ({
		rule,
		line,
		column,
		message,
	})),
	markdownlint: markdownlint.lint({ strings: { input: entry.markdown }, customRules: rules, config }).input.map(
		(result) => ({
			lineNumber: result.lineNumber,
			ruleNames: result.ruleNames,
			ruleDescription: result.ruleDescription,
			errorDetail: result.errorDetail,
			errorContext: result.errorContext,
			errorRange: result.errorRange,
			fixInfo: result.fixInfo,
		}),
	),
}));
const producedBy = { systemsCommit: process.env.SYSTEMS_COMMIT ?? "unknown", markdownlint: getVersion(), effectedMarkdown: markdownVersion };
writeFileSync(out, `${JSON.stringify({ producedBy, cases }, null, "\t")}\n`);
console.log(`${records.length} recorded lint inputs, ${cases.length} unique`);
